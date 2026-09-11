/**
 * NovaMember — AI Evaluation Pipeline
 *
 * Runs unattended scoring evaluations against the full member base.
 * Called by a cron job / scheduler (e.g. Vercel Cron, GitHub Actions, pg_cron).
 *
 * What it does on each run:
 *  1. Selects members due for re-scoring (not scored in the last 24h, or never scored)
 *  2. Fans out to batchScoreMembers() which calls Grok for each in parallel
 *  3. Persists each score to ai_score_logs + updates the member's engagement fields
 *  4. Identifies members who dropped into COLD tier — flags them for outreach
 *  5. Returns a structured eval report (pass/fail counts, cost, tier distribution)
 *
 * Security: protected by CRON_SECRET header (set in Vercel dashboard / env).
 *
 * GET  /api/evals          — retrieve the last eval run summary
 * POST /api/evals          — trigger an eval run (cron or manual)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { batchScoreMembers, scoreToTier, MODEL, PRICING_USD_PER_MILLION_TOKENS } from '@/lib/grok'
import { logger } from '@/lib/logger'
import { toInputJson } from '@/lib/json'

const CRON_SECRET   = process.env.CRON_SECRET ?? ''
const BATCH_SIZE    = 50    // members per eval run
const RESCORE_HOURS = 24    // re-score every 24 hours

function authorizeCron(req: NextRequest): boolean {
  // Vercel Cron sends this header; manual triggers use the same secret
  const secret = req.headers.get('x-cron-secret')
    ?? req.headers.get('authorization')?.replace('Bearer ', '')
  return CRON_SECRET ? secret === CRON_SECRET : process.env.NODE_ENV !== 'production'
}

// ── GET /api/evals — last run summary ────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const lastRun = await db.webhookEvent.findFirst({
      where: { source: 'eval_pipeline', topic: 'eval/completed' },
      orderBy: { createdAt: 'desc' },
    })

    const tierDistribution = await db.member.groupBy({
      by: ['engagementTier'],
      _count: { id: true },
    })

    const coldMembers = await db.member.count({
      where: { engagementTier: 'COLD', status: 'ACTIVE' },
    })

    return NextResponse.json({
      lastRun: lastRun
        ? { at: lastRun.createdAt, summary: lastRun.payload }
        : null,
      tierDistribution: tierDistribution.reduce((acc, row) => {
        acc[row.engagementTier] = row._count.id
        return acc
      }, {} as Record<string, number>),
      coldMembersRequiringOutreach: coldMembers,
    })
  } catch (err) {
    logger.error('Eval GET failed', { error: String(err) })
    return NextResponse.json({ error: 'Failed to load eval summary' }, { status: 500 })
  }
}

// ── POST /api/evals — run evaluations ────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runStartedAt = new Date()
  logger.info('Eval run started', { at: runStartedAt.toISOString() })

  try {
    // Select members due for re-scoring
    const cutoff = new Date()
    cutoff.setHours(cutoff.getHours() - RESCORE_HOURS)

    const members = await db.member.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { lastScoredAt: null },
          { lastScoredAt: { lt: cutoff } },
        ],
      },
      take: BATCH_SIZE,
      orderBy: { lastScoredAt: 'asc' },   // score least-recently-scored first
    })

    if (members.length === 0) {
      logger.info('Eval run: no members due for re-scoring')
      return NextResponse.json({ scored: 0, message: 'No members due for re-scoring' })
    }

    logger.info('Eval run: scoring members', { count: members.length })

    // Fan out to Grok — batchScoreMembers handles concurrency + rate limiting
    const results = await batchScoreMembers(
      members.map(m => ({ memberId: m.id, signals: null })),
    )

    // Persist results and identify tier changes
    const tierChanges: Array<{ memberId: string; from: string; to: string }> = []
    let totalPromptTokens = 0
    let totalOutputTokens = 0
    let successCount = 0
    let failCount = 0

    for (const result of results) {
      if (result.status === 'rejected' || !result.value) {
        failCount++
        continue
      }

      const { memberId, score } = result.value
      const member = members.find(m => m.id === memberId)
      if (!member) continue

      const newTier = scoreToTier(score.score)
      const prevTier = member.engagementTier

      // Persist to ai_score_logs
      await db.aiScoreLog.create({
        data: {
          memberId:     memberId,
          score:        score.score,
          tier:         newTier,
          signals:      score.signals ? toInputJson(score.signals) : {},
          reasoning:    score.reasoning,
          modelVersion: MODEL,
          promptTokens: score.usage?.input_tokens ?? 0,
          outputTokens: score.usage?.output_tokens ?? 0,
        },
      })

      // Update the member's live score
      await db.member.update({
        where: { id: memberId },
        data: {
          engagementScore: score.score,
          engagementTier:  newTier,
          lastScoredAt:    new Date(),
        },
      })

      if (prevTier !== newTier) {
        tierChanges.push({ memberId, from: prevTier, to: newTier })

        await db.activityEvent.create({
          data: {
            memberId,
            eventType: 'engagement.tier_changed',
            source:    'eval_pipeline',
            properties: { from: prevTier, to: newTier, score: score.score },
          },
        })
      }

      totalPromptTokens += score.usage?.input_tokens ?? 0
      totalOutputTokens += score.usage?.output_tokens ?? 0
      successCount++
    }

    // Members who dropped to COLD get flagged for outreach
    const newColdMembers = tierChanges.filter(c => c.to === 'COLD')
    for (const { memberId } of newColdMembers) {
      await db.activityEvent.create({
        data: {
          memberId,
          eventType: 'engagement.outreach_needed',
          source:    'eval_pipeline',
          properties: { triggeredBy: 'cold_tier_drop', evalRunAt: runStartedAt.toISOString() },
        },
      })
    }

    const summary = {
      runAt:             runStartedAt.toISOString(),
      durationMs:        Date.now() - runStartedAt.getTime(),
      membersEvaluated:  members.length,
      succeeded:         successCount,
      failed:            failCount,
      tierChanges:       tierChanges.length,
      newColdOutreaches: newColdMembers.length,
      tokenUsage: {
        promptTokens: totalPromptTokens,
        outputTokens: totalOutputTokens,
        totalTokens:  totalPromptTokens + totalOutputTokens,
        // Approximate cost — see PRICING_USD_PER_MILLION_TOKENS comment for the caveat
        estimatedCostUsd:
          (totalPromptTokens / 1_000_000) * PRICING_USD_PER_MILLION_TOKENS.input +
          (totalOutputTokens / 1_000_000) * PRICING_USD_PER_MILLION_TOKENS.output,
      },
    }

    // Persist the run summary for GET /api/evals
    await db.webhookEvent.create({
      data: {
        source:  'eval_pipeline',
        topic:   'eval/completed',
        payload: toInputJson(summary),
        status:  'PROCESSED',
        processedAt: new Date(),
      },
    })

    logger.info('Eval run complete', summary)

    return NextResponse.json(summary)
  } catch (err) {
    const message = String(err)
    logger.error('Eval run failed', { error: message })
    return NextResponse.json({ error: 'Eval run failed', detail: message }, { status: 500 })
  }
}
