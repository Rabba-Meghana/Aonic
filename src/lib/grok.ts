/**
 * NovaMember — AI Engagement Scoring Service
 *
 * Uses xAI Grok to analyze member behavioral signals and
 * compute a 0-100 engagement score with churn prediction.
 *
 * Grok API is OpenAI-compatible — same SDK, different baseURL + model.
 */

import OpenAI from 'openai'
import { logger } from './logger'
import { db } from './db'
import { toInputJson } from './json'

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY ?? '',
  baseURL: 'https://api.x.ai/v1',
})

export const MODEL = 'grok-2-1212'

// Verify against xAI's current published pricing (console.x.ai) before relying
// on this for real cost reporting — rates change and this is not fetched live.
export const PRICING_USD_PER_MILLION_TOKENS = { input: 2, output: 10 }

export interface MemberSignals {
  memberId: string
  loginCount7d: number
  loginCount30d: number
  purchaseCount30d: number
  purchaseValue30d: number
  emailOpenRate: number
  emailClickRate: number
  supportTickets30d: number
  supportSentimentScore: number   // -1 to 1
  subscriptionAgeMonths: number
  daysSinceLastLogin: number
  daysSinceLastPurchase: number
  onboardingCompletionPct: number
  referralCount: number
  featureAdoptionScore: number    // 0-100
  cartAbandonments7d: number
}

export interface EngagementResult {
  score: number                   // 0-100
  tier: 'COLD' | 'WARM' | 'HOT' | 'CHAMPION'
  churnProbability30d: number     // 0-1
  reasoning: string
  recommendations: string[]
  modelVersion: string
  promptTokens: number
  outputTokens: number
}

const TIER_THRESHOLDS = {
  CHAMPION: 80,
  HOT: 60,
  WARM: 35,
  COLD: 0,
} as const

export function scoreToTier(score: number): EngagementResult['tier'] {
  if (score >= TIER_THRESHOLDS.CHAMPION) return 'CHAMPION'
  if (score >= TIER_THRESHOLDS.HOT) return 'HOT'
  if (score >= TIER_THRESHOLDS.WARM) return 'WARM'
  return 'COLD'
}

function buildPrompt(signals: MemberSignals): string {
  return `You are NovaMember's AI engagement scoring engine. Analyze the following member behavioral signals and compute an engagement score.

Member Signals (last 30 days):
- Logins (7d / 30d): ${signals.loginCount7d} / ${signals.loginCount30d}
- Days since last login: ${signals.daysSinceLastLogin}
- Purchases (30d): ${signals.purchaseCount30d} totaling $${signals.purchaseValue30d.toFixed(2)}
- Days since last purchase: ${signals.daysSinceLastPurchase}
- Email open rate: ${(signals.emailOpenRate * 100).toFixed(1)}%
- Email click rate: ${(signals.emailClickRate * 100).toFixed(1)}%
- Support tickets (30d): ${signals.supportTickets30d}
- Support sentiment: ${signals.supportSentimentScore.toFixed(2)} (-1=negative, 1=positive)
- Subscription age: ${signals.subscriptionAgeMonths} months
- Onboarding completion: ${signals.onboardingCompletionPct.toFixed(1)}%
- Referrals made: ${signals.referralCount}
- Feature adoption score: ${signals.featureAdoptionScore}/100
- Cart abandonments (7d): ${signals.cartAbandonments7d}

Respond with valid JSON only (no markdown):
{
  "score": <integer 0-100>,
  "churnProbability30d": <float 0-1>,
  "reasoning": "<2-3 sentences explaining the score>",
  "recommendations": ["<actionable recommendation 1>", "<actionable recommendation 2>", "<actionable recommendation 3>"]
}`
}

export async function scoreEngagement(signals: MemberSignals): Promise<EngagementResult> {
  const startTime = Date.now()

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: buildPrompt(signals),
        },
      ],
    })

    const content = completion.choices[0]?.message?.content
    if (!content) throw new Error('Unexpected Grok response: no content')

    let parsed: {
      score: number
      churnProbability30d: number
      reasoning: string
      recommendations: string[]
    }

    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error(`Failed to parse Grok response: ${content}`)
    }

    const score = Math.max(0, Math.min(100, Math.round(parsed.score)))
    const tier = scoreToTier(score)
    const promptTokens = completion.usage?.prompt_tokens ?? 0
    const outputTokens = completion.usage?.completion_tokens ?? 0

    const result: EngagementResult = {
      score,
      tier,
      churnProbability30d: parsed.churnProbability30d,
      reasoning: parsed.reasoning,
      recommendations: parsed.recommendations,
      modelVersion: MODEL,
      promptTokens,
      outputTokens,
    }

    // Persist score
    await Promise.all([
      db.member.update({
        where: { id: signals.memberId },
        data: { engagementScore: score, engagementTier: tier, lastScoredAt: new Date() },
      }),
      db.aiScoreLog.create({
        data: {
          memberId: signals.memberId,
          score,
          tier,
          signals: toInputJson(signals),
          reasoning: parsed.reasoning,
          modelVersion: MODEL,
          promptTokens,
          outputTokens,
        },
      }),
    ])

    logger.info('Engagement score computed', {
      memberId: signals.memberId,
      score,
      tier,
      latencyMs: Date.now() - startTime,
      tokens: promptTokens + outputTokens,
    })

    return result
  } catch (err) {
    logger.error('Engagement scoring failed', { memberId: signals.memberId, error: err })
    throw err
  }
}

// ── Batch scoring ─────────────────────────────────────────────────────────────
/**
 * Score a batch of members.
 * Accepts either plain member IDs (string[]) or objects with { memberId, signals }.
 * Returns a PromiseSettledResult array so callers can see which members failed.
 */
export async function batchScoreMembers(
  input: string[] | Array<{ memberId: string; signals: MemberSignals | null }>,
): Promise<Array<PromiseSettledResult<{ memberId: string; score: EngagementResult & { signals?: MemberSignals; usage?: { input_tokens: number; output_tokens: number } } }>>> {
  const items: Array<{ memberId: string; signals: MemberSignals | null }> =
    Array.isArray(input) && typeof input[0] === 'string'
      ? (input as string[]).map(id => ({ memberId: id, signals: null }))
      : input as Array<{ memberId: string; signals: MemberSignals | null }>

  const CHUNK_SIZE = 10
  const allResults: Array<PromiseSettledResult<{ memberId: string; score: EngagementResult & { signals?: MemberSignals; usage?: { input_tokens: number; output_tokens: number } } }>> = []

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE)
    const chunkResults = await Promise.allSettled(
      chunk.map(async ({ memberId, signals: providedSignals }) => {
        const signals = providedSignals ?? await buildSignalsForMember(memberId)
        if (!signals) throw new Error(`No signals for member ${memberId}`)
        const result = await scoreEngagement(signals)
        return {
          memberId,
          score: {
            ...result,
            signals,
            usage: { input_tokens: result.promptTokens, output_tokens: result.outputTokens },
          },
        }
      }),
    )
    allResults.push(...chunkResults)

    if (i + CHUNK_SIZE < items.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return allResults
}

// ── Build signals from DB ─────────────────────────────────────────────────────
async function buildSignalsForMember(memberId: string): Promise<MemberSignals | null> {
  const now = new Date()
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [member, events30d, events7d, tasks] = await Promise.all([
    db.member.findUnique({ where: { id: memberId } }),
    db.activityEvent.findMany({ where: { memberId, createdAt: { gte: day30 } } }),
    db.activityEvent.findMany({ where: { memberId, createdAt: { gte: day7 } } }),
    db.onboardingTask.findMany({ where: { memberId } }),
  ])

  if (!member) return null

  const loginEvents30d = events30d.filter(e => e.eventType === 'login')
  const loginEvents7d = events7d.filter(e => e.eventType === 'login')
  const lastLogin = loginEvents30d[0]?.createdAt
  const completedTasks = tasks.filter(t => t.completedAt)

  return {
    memberId,
    loginCount7d: loginEvents7d.length,
    loginCount30d: loginEvents30d.length,
    purchaseCount30d: 0,
    purchaseValue30d: 0,
    emailOpenRate: 0.35,     // Would come from email provider
    emailClickRate: 0.08,
    supportTickets30d: 0,
    supportSentimentScore: 0.5,
    subscriptionAgeMonths: Math.floor(
      (now.getTime() - member.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000)
    ),
    daysSinceLastLogin: lastLogin
      ? Math.floor((now.getTime() - lastLogin.getTime()) / (24 * 60 * 60 * 1000))
      : 999,
    daysSinceLastPurchase: 999,
    onboardingCompletionPct: tasks.length > 0
      ? (completedTasks.length / tasks.length) * 100
      : 0,
    referralCount: 0,
    featureAdoptionScore: 50,
    cartAbandonments7d: 0,
  }
}
