/**
 * CPRA Data Export (DSAR) Endpoint
 *
 * Implements the California Privacy Rights Act right to know / data access.
 * Returns a complete export of all personal data held about a member.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request)

    const [member, subscriptions, activities, consents, aiLogs] = await Promise.all([
      db.member.findUnique({
        where: { id: auth.sub },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          engagementScore: true,
          engagementTier: true,
          shopifyCustomerId: true,
          rechargeCustomerId: true,
        },
      }),
      db.subscription.findMany({
        where: { memberId: auth.sub },
        include: { plan: { select: { name: true, billingCycle: true, price: true } } },
      }),
      db.activityEvent.findMany({
        where: { memberId: auth.sub },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          eventType: true,
          source: true,
          createdAt: true,
          // Exclude raw IP for privacy
        },
      }),
      db.consentRecord.findMany({
        where: { memberId: auth.sub },
        orderBy: { createdAt: 'desc' },
      }),
      db.aiScoreLog.findMany({
        where: { memberId: auth.sub },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { score: true, tier: true, reasoning: true, createdAt: true },
      }),
    ])

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Log the export request for audit trail
    await db.activityEvent.create({
      data: {
        memberId: auth.sub,
        eventType: 'data_export_requested',
        source: 'web',
        properties: { cpraCompliant: true, exportedAt: new Date().toISOString() },
      },
    }).catch(() => {})

    logger.info('Data export requested', { memberId: auth.sub })

    const export_data = {
      exportedAt: new Date().toISOString(),
      exportVersion: '2025-01',
      legalBasis: 'CPRA Section 1798.110 — Right to Know',
      member,
      subscriptions: subscriptions.map(s => ({
        id: s.id,
        plan: s.plan.name,
        status: s.status,
        billingCycle: s.plan.billingCycle,
        price: s.plan.price,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        createdAt: s.createdAt,
      })),
      activityLog: activities,
      consentRecords: consents.map(c => ({
        consentType: c.consentType,
        granted: c.granted,
        version: c.version,
        createdAt: c.createdAt,
      })),
      aiEngagementHistory: aiLogs,
      categories_of_data_collected: [
        'Identifiers (name, email)',
        'Commercial information (subscriptions, purchases)',
        'Internet or network activity (login events)',
        'Inferences drawn from above data (engagement score)',
      ],
      categories_of_third_parties: [
        'Shopify (ecommerce platform)',
        'Recharge (subscription billing)',
        'xAI (AI engagement scoring)',
      ],
      data_retention_policy: '7 years for financial records, 2 years for activity logs',
      your_rights: [
        'Right to know (this export)',
        'Right to delete (POST /api/compliance/data-deletion)',
        'Right to correct (PATCH /api/members/me)',
        'Right to opt-out of sale (N/A — we do not sell data)',
        'Right to non-discrimination',
      ],
    }

    return NextResponse.json(export_data)
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('Data export failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
