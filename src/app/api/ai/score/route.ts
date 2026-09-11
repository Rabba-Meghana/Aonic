import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { scoreEngagement, MemberSignals } from '@/lib/grok'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

const ScoreRequestSchema = z.object({
  memberId: z.string().optional(),
  signals: z.object({
    loginCount7d: z.number().min(0),
    loginCount30d: z.number().min(0),
    purchaseCount30d: z.number().min(0),
    purchaseValue30d: z.number().min(0),
    emailOpenRate: z.number().min(0).max(1),
    emailClickRate: z.number().min(0).max(1),
    supportTickets30d: z.number().min(0),
    supportSentimentScore: z.number().min(-1).max(1),
    subscriptionAgeMonths: z.number().min(0),
    daysSinceLastLogin: z.number().min(0),
    daysSinceLastPurchase: z.number().min(0),
    onboardingCompletionPct: z.number().min(0).max(100),
    referralCount: z.number().min(0),
    featureAdoptionScore: z.number().min(0).max(100),
    cartAbandonments7d: z.number().min(0),
  }).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request)

    const body = await request.json() as unknown
    const parsed = ScoreRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const targetMemberId = parsed.data.memberId ?? auth.sub

    // Only admins can score other members
    if (targetMemberId !== auth.sub && auth.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check member exists
    const member = await db.member.findUnique({
      where: { id: targetMemberId },
      include: {
        activityEvents: {
          take: 100,
          orderBy: { createdAt: 'desc' },
        },
        onboardingTasks: true,
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Use provided signals or build from DB
    const signals: MemberSignals = parsed.data.signals
      ? { memberId: targetMemberId, ...parsed.data.signals }
      : buildSignalsFromMember(member)

    const result = await scoreEngagement(signals)

    logger.info('AI score requested', {
      requesterId: auth.sub,
      targetMemberId,
      score: result.score,
      tier: result.tier,
    })

    return NextResponse.json({
      memberId: targetMemberId,
      ...result,
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('AI scoring endpoint failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

type MemberWithRelations = {
  id: string
  createdAt: Date
  activityEvents: Array<{ eventType: string; createdAt: Date }>
  onboardingTasks: Array<{ completedAt: Date | null }>
}

function buildSignalsFromMember(member: MemberWithRelations): MemberSignals {
  const now = new Date()
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const events = member.activityEvents
  const logins7d = events.filter(e => e.eventType === 'login' && e.createdAt >= day7)
  const logins30d = events.filter(e => e.eventType === 'login' && e.createdAt >= day30)
  const lastLogin = events.find(e => e.eventType === 'login')?.createdAt

  const completedTasks = member.onboardingTasks.filter(t => t.completedAt)

  return {
    memberId: member.id,
    loginCount7d: logins7d.length,
    loginCount30d: logins30d.length,
    purchaseCount30d: 0,
    purchaseValue30d: 0,
    emailOpenRate: 0.3,
    emailClickRate: 0.05,
    supportTickets30d: 0,
    supportSentimentScore: 0.5,
    subscriptionAgeMonths: Math.floor(
      (now.getTime() - member.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000),
    ),
    daysSinceLastLogin: lastLogin
      ? Math.floor((now.getTime() - lastLogin.getTime()) / (24 * 60 * 60 * 1000))
      : 999,
    daysSinceLastPurchase: 999,
    onboardingCompletionPct: member.onboardingTasks.length > 0
      ? (completedTasks.length / member.onboardingTasks.length) * 100
      : 0,
    referralCount: 0,
    featureAdoptionScore: 50,
    cartAbandonments7d: 0,
  }
}
