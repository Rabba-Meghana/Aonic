/**
 * NovaMember — Admin Analytics API
 *
 * GET /api/admin/analytics
 * Authorization: Bearer <admin token>
 *
 * Every number here is a real aggregate query against the same tables the
 * rest of the app writes to (subscriptions, charges, members, webhook_events).
 * On a fresh database with no real subscribers yet, this correctly returns
 * mostly zeros — that's the honest state, not a bug. It fills in as real
 * checkouts and webhooks happen.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request)

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    // ── Core counts ────────────────────────────────────────────────────────
    const [totalMembers, activeMembers, newMembersThisMonth, membersWithShopify] = await Promise.all([
      db.member.count(),
      db.member.count({ where: { status: 'ACTIVE' } }),
      db.member.count({ where: { createdAt: { gte: startOfMonth } } }),
      db.member.count({ where: { shopifyCustomerId: { not: null } } }),
    ])

    // ── MRR: sum of priceAtSubscription across currently-active subscriptions
    const mrrAgg = await db.subscription.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { priceAtSubscription: true },
      _count: true,
    })
    const mrr = Number(mrrAgg._sum.priceAtSubscription ?? 0)

    const [activeSubCount, cancelledLast90dCount] = await Promise.all([
      db.subscription.count({ where: { status: 'ACTIVE' } }),
      db.subscription.count({ where: { status: 'CANCELLED', cancelledAt: { gte: ninetyDaysAgo } } }),
    ])
    const churnRate = activeSubCount + cancelledLast90dCount > 0
      ? (cancelledLast90dCount / (activeSubCount + cancelledLast90dCount)) * 100
      : 0

    // ── Onboarding funnel — real counts, not a demo curve ────────────────────
    const membersWithAnySubscription = await db.subscription.findMany({
      select: { memberId: true },
      distinct: ['memberId'],
    })

    const requiredTasks = await db.onboardingTask.findMany({
      where: { isRequired: true },
      select: { memberId: true, completedAt: true },
    })
    const requiredByMember = new Map<string, boolean>()
    for (const t of requiredTasks) {
      const allDoneSoFar = requiredByMember.get(t.memberId) ?? true
      requiredByMember.set(t.memberId, allDoneSoFar && t.completedAt !== null)
    }
    const fullyOnboardedCount = Array.from(requiredByMember.values()).filter(Boolean).length

    const funnel = [
      { stage: 'Signed up', count: totalMembers },
      { stage: 'Added payment', count: membersWithAnySubscription.length },
      { stage: 'Connected Shopify', count: membersWithShopify },
      { stage: 'Fully onboarded', count: fullyOnboardedCount },
    ].map(s => ({ ...s, pct: totalMembers > 0 ? Math.round((s.count / totalMembers) * 1000) / 10 : 0 }))

    // ── Revenue collected per month (last 6 months) from real charges ───────
    const recentCharges = await db.charge.findMany({
      where: { status: 'SUCCESS', processedAt: { gte: sixMonthsAgo } },
      select: { amount: true, processedAt: true },
    })
    const monthBuckets: Record<string, number> = {}
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthBuckets[d.toLocaleString('en-US', { month: 'short' })] = 0
    }
    for (const c of recentCharges) {
      if (!c.processedAt) continue
      const key = c.processedAt.toLocaleString('en-US', { month: 'short' })
      if (key in monthBuckets) monthBuckets[key] += Number(c.amount)
    }
    const revenueTrend = Object.entries(monthBuckets).map(([month, revenue]) => ({ month, revenue }))

    // ── Plan distribution among active subscriptions ────────────────────────
    const activeSubs = await db.subscription.findMany({
      where: { status: 'ACTIVE' },
      select: { plan: { select: { name: true } } },
    })
    const planCounts: Record<string, number> = {}
    for (const s of activeSubs) planCounts[s.plan.name] = (planCounts[s.plan.name] ?? 0) + 1
    const planDistribution = Object.entries(planCounts).map(([plan, count]) => ({
      plan, count, pct: activeSubs.length > 0 ? Math.round((count / activeSubs.length) * 1000) / 10 : 0,
    }))

    // ── Top members by real lifetime value (sum of successful charges) ──────
    const successCharges = await db.charge.findMany({
      where: { status: 'SUCCESS' },
      select: {
        amount: true,
        subscription: { select: { member: { select: { id: true, firstName: true, lastName: true, email: true, engagementScore: true, engagementTier: true } } } },
      },
    })
    const ltvByMember = new Map<string, { name: string; email: string; ltv: number; score: number; tier: string }>()
    for (const c of successCharges) {
      const m = c.subscription.member
      const existing = ltvByMember.get(m.id)
      const ltv = (existing?.ltv ?? 0) + Number(c.amount)
      ltvByMember.set(m.id, { name: `${m.firstName} ${m.lastName[0]}.`, email: m.email, ltv, score: m.engagementScore, tier: m.engagementTier })
    }
    const topMembersByLtv = Array.from(ltvByMember.values()).sort((a, b) => b.ltv - a.ltv).slice(0, 5)

    // ── Churn risk: active members already flagged COLD by the eval pipeline ─
    const churnRiskMembers = await db.member.findMany({
      where: { status: 'ACTIVE', engagementTier: 'COLD' },
      orderBy: { engagementScore: 'asc' },
      take: 5,
      select: { id: true, firstName: true, lastName: true, email: true, engagementScore: true },
    })

    // ── Recent webhook events with real latency ──────────────────────────────
    const webhookEvents = await db.webhookEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { source: true, topic: true, status: true, createdAt: true, processedAt: true },
    })

    return NextResponse.json({
      generatedAt: now.toISOString(),
      kpis: {
        mrr,
        activeSubscriptions: activeSubCount,
        activeMembers,
        newMembersThisMonth,
        churnRatePct: Math.round(churnRate * 10) / 10,
        arrRunRate: mrr * 12,
        arpu: activeMembers > 0 ? Math.round((mrr / activeMembers) * 100) / 100 : 0,
      },
      revenueTrend,
      planDistribution,
      funnel,
      topMembersByLtv,
      churnRiskMembers: churnRiskMembers.map(m => ({
        name: `${m.firstName} ${m.lastName[0]}.`, email: m.email, score: m.engagementScore,
      })),
      webhookEvents: webhookEvents.map(w => ({
        source: w.source,
        topic: w.topic,
        status: w.status,
        time: w.createdAt.toISOString(),
        latencyMs: w.processedAt ? w.processedAt.getTime() - w.createdAt.getTime() : null,
      })),
    })
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (err.message === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
    }
    logger.error('Admin analytics query failed', { error: String(err) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
