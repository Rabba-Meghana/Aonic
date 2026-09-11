/**
 * NovaMember — Subscriptions API
 *
 * Manages the full subscription lifecycle for authenticated members:
 *   GET    /api/subscriptions          — list the member's subscriptions + upcoming charges
 *   DELETE /api/subscriptions/:id      — cancel a subscription (via Recharge + DB)
 *   PATCH  /api/subscriptions/:id/pause — pause a subscription
 *   PATCH  /api/subscriptions/:id/resume — resume a paused subscription
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import {
  cancelSubscription,
  pauseSubscription,
  listSubscriptions,
  listCharges,
} from '@/lib/recharge'
import { logger } from '@/lib/logger'

// ── GET /api/subscriptions ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  let auth: ReturnType<typeof requireAuth>
  try {
    auth = requireAuth(req)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Fetch from our DB
    const subscriptions = await db.subscription.findMany({
      where:   { memberId: auth.sub },
      include: { plan: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    })

    // If the member has a Recharge customer ID, also pull live Recharge data
    const member = await db.member.findUnique({ where: { id: auth.sub } })
    let rechargeSubscriptions: unknown[] = []
    let rechargeCharges: unknown[] = []

    if (member?.rechargeCustomerId) {
      try {
        rechargeSubscriptions = await listSubscriptions(member.rechargeCustomerId)
        rechargeCharges       = await listCharges(member.rechargeCustomerId)
      } catch (err) {
        // Non-fatal: Recharge may be temporarily unavailable
        logger.warn('Failed to fetch Recharge data', { memberId: auth.sub, error: String(err) })
      }
    }

    return NextResponse.json({
      subscriptions: subscriptions.map(sub => ({
        id:                     sub.id,
        planName:               sub.plan.name,
        planPrice:              sub.priceAtSubscription,
        billingCycle:           sub.plan.billingCycle,
        status:                 sub.status,
        currentPeriodStart:     sub.currentPeriodStart,
        currentPeriodEnd:       sub.currentPeriodEnd,
        cancelAtPeriodEnd:      sub.cancelAtPeriodEnd,
        pausedAt:               sub.pausedAt,
        resumesAt:              sub.resumesAt,
        rechargeSubscriptionId: sub.rechargeSubscriptionId,
      })),
      rechargeSubscriptions,  // live data direct from Recharge
      upcomingCharges: rechargeCharges.filter(c => (c as { status: string }).status === 'QUEUED'),
      chargeHistory:   rechargeCharges.filter(c => (c as { status: string }).status !== 'QUEUED'),
    })
  } catch (err) {
    logger.error('Failed to list subscriptions', { memberId: auth.sub, error: String(err) })
    return NextResponse.json({ error: 'Failed to load subscriptions' }, { status: 500 })
  }
}

// ── DELETE /api/subscriptions  (body: { subscriptionId, reason? }) ─────────
const CancelSchema = z.object({
  subscriptionId: z.string().min(1),
  reason:         z.string().max(500).optional(),
})

export async function DELETE(req: NextRequest) {
  let auth: ReturnType<typeof requireAuth>
  try {
    auth = requireAuth(req)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof CancelSchema>
  try {
    body = CancelSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    // Verify the subscription belongs to this member
    const subscription = await db.subscription.findFirst({
      where: { id: body.subscriptionId, memberId: auth.sub },
    })
    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }
    if (subscription.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Subscription is already cancelled' }, { status: 409 })
    }

    // Cancel on Recharge first (source of truth for billing)
    if (subscription.rechargeSubscriptionId) {
      await cancelSubscription(subscription.rechargeSubscriptionId, body.reason)
    }

    // Mark cancelled in our DB
    const updated = await db.subscription.update({
      where: { id: subscription.id },
      data: {
        status:            'CANCELLED',
        cancelAtPeriodEnd: false,
        cancelledAt:       new Date(),
      },
    })

    // Log the cancellation
    await db.activityEvent.create({
      data: {
        memberId:  auth.sub,
        eventType: 'subscription.cancelled',
        source:    'api',
        properties: {
          subscriptionId:         subscription.id,
          rechargeSubscriptionId: subscription.rechargeSubscriptionId,
          reason:                 body.reason ?? null,
        },
      },
    })

    logger.info('Subscription cancelled', { subscriptionId: subscription.id, memberId: auth.sub })

    return NextResponse.json({
      id:          updated.id,
      status:      updated.status,
      cancelledAt: updated.cancelledAt,
    })
  } catch (err) {
    logger.error('Cancel subscription failed', { error: String(err), memberId: auth.sub })
    return NextResponse.json({ error: 'Failed to cancel subscription' }, { status: 500 })
  }
}

// ── PATCH /api/subscriptions  (body: { subscriptionId, action: 'pause'|'resume' })
const PatchSchema = z.object({
  subscriptionId: z.string().min(1),
  action:         z.enum(['pause', 'resume']),
})

export async function PATCH(req: NextRequest) {
  let auth: ReturnType<typeof requireAuth>
  try {
    auth = requireAuth(req)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof PatchSchema>
  try {
    body = PatchSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const subscription = await db.subscription.findFirst({
      where: { id: body.subscriptionId, memberId: auth.sub },
    })
    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    if (body.action === 'pause') {
      if (subscription.rechargeSubscriptionId) {
        await pauseSubscription(subscription.rechargeSubscriptionId)
      }

      const resumesAt = new Date()
      resumesAt.setMonth(resumesAt.getMonth() + 1)

      const updated = await db.subscription.update({
        where: { id: subscription.id },
        data: {
          status:    'PAUSED',
          pausedAt:  new Date(),
          resumesAt,
        },
      })

      await db.activityEvent.create({
        data: {
          memberId:  auth.sub,
          eventType: 'subscription.paused',
          source:    'api',
          properties: { subscriptionId: subscription.id, resumesAt: resumesAt.toISOString() },
        },
      })

      return NextResponse.json({ id: updated.id, status: updated.status, resumesAt: updated.resumesAt })
    }

    // resume
    const updated = await db.subscription.update({
      where: { id: subscription.id },
      data: {
        status:    'ACTIVE',
        pausedAt:  null,
        resumesAt: null,
      },
    })

    await db.activityEvent.create({
      data: {
        memberId:  auth.sub,
        eventType: 'subscription.resumed',
        source:    'api',
        properties: { subscriptionId: subscription.id },
      },
    })

    return NextResponse.json({ id: updated.id, status: updated.status })
  } catch (err) {
    logger.error('Patch subscription failed', { error: String(err), memberId: auth.sub })
    return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 })
  }
}
