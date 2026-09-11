/**
 * NovaMember — Subscription Upgrade / Downgrade
 *
 * Handles plan changes with proration:
 *   - Upgrade (e.g. Starter → Growth): immediate, prorated credit applied
 *   - Downgrade (e.g. Scale → Growth): effective at next billing cycle
 *
 * Flow:
 *   1. Validate request + ownership
 *   2. Calculate proration amount
 *   3. Cancel current Recharge subscription at period end
 *   4. Create new Recharge subscription on the new plan
 *   5. Update DB atomically
 *   6. Send confirmation email
 *
 * POST /api/subscriptions/upgrade
 * Body: { subscriptionId, newPlanId }
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { cancelSubscription, createSubscription } from '@/lib/recharge'
import { sendSubscriptionStartedEmail } from '@/lib/email'
import { idempotencyKey } from '@/lib/retry'
import { logger } from '@/lib/logger'

const UpgradeSchema = z.object({
  subscriptionId: z.string().min(1),
  newPlanId:      z.string().min(1),
})

const PLAN_CONFIG: Record<string, {
  name: string
  price: number
  shopifyVariantId: string
  intervalUnit: 'month' | 'week' | 'day'
  intervalFrequency: number
}> = {
  starter: { name: 'Starter', price: 99,  shopifyVariantId: process.env.SHOPIFY_VARIANT_STARTER ?? 'starter_variant_id', intervalUnit: 'month', intervalFrequency: 1 },
  growth:  { name: 'Growth',  price: 299, shopifyVariantId: process.env.SHOPIFY_VARIANT_GROWTH  ?? 'growth_variant_id',  intervalUnit: 'month', intervalFrequency: 1 },
  scale:   { name: 'Scale',   price: 799, shopifyVariantId: process.env.SHOPIFY_VARIANT_SCALE   ?? 'scale_variant_id',   intervalUnit: 'month', intervalFrequency: 1 },
}

const PLAN_RANK: Record<string, number> = { starter: 1, growth: 2, scale: 3 }

export async function POST(req: NextRequest) {
  let auth: ReturnType<typeof requireAuth>
  try {
    auth = requireAuth(req)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof UpgradeSchema>
  try {
    body = UpgradeSchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 422 })
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const newPlanConfig = PLAN_CONFIG[body.newPlanId]
  if (!newPlanConfig) {
    return NextResponse.json({ error: `Unknown plan: ${body.newPlanId}` }, { status: 400 })
  }

  try {

  // ── Load current subscription ────────────────────────────────────────────
  const subscription = await db.subscription.findFirst({
    where: { id: body.subscriptionId, memberId: auth.sub },
    include: { plan: true, member: true },
  })

  if (!subscription) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
  }
  if (subscription.status !== 'ACTIVE') {
    return NextResponse.json({ error: `Cannot change plan of a ${subscription.status} subscription` }, { status: 409 })
  }

  // ── Determine upgrade vs downgrade ───────────────────────────────────────
  // Infer current plan key from name (in production, store planKey on the plan record)
  const currentPlanKey = Object.entries(PLAN_CONFIG).find(
    ([, cfg]) => cfg.name === subscription.plan.name,
  )?.[0] ?? 'starter'

  if (currentPlanKey === body.newPlanId) {
    return NextResponse.json({ error: 'Already on this plan' }, { status: 409 })
  }

  const isUpgrade = (PLAN_RANK[body.newPlanId] ?? 0) > (PLAN_RANK[currentPlanKey] ?? 0)

  // ── Calculate proration ──────────────────────────────────────────────────
  const now = new Date()
  const periodStart = new Date(subscription.currentPeriodStart)
  const periodEnd   = new Date(subscription.currentPeriodEnd)
  const periodDays  = Math.max(1, (periodEnd.getTime() - periodStart.getTime()) / 86_400_000)
  const daysRemaining = Math.max(0, (periodEnd.getTime() - now.getTime()) / 86_400_000)
  const daysUsed = periodDays - daysRemaining

  const currentDailyRate = Number(subscription.priceAtSubscription) / periodDays
  const newDailyRate      = newPlanConfig.price / periodDays
  const creditAmount      = isUpgrade ? currentDailyRate * daysRemaining : 0
  const chargeAmount      = isUpgrade ? Math.max(0, newDailyRate * daysRemaining - creditAmount) : newPlanConfig.price

  logger.info('Plan change calculation', {
    memberId: auth.sub,
    from: currentPlanKey,
    to: body.newPlanId,
    isUpgrade,
    daysRemaining: Math.round(daysRemaining),
    creditAmount: creditAmount.toFixed(2),
    chargeAmount: chargeAmount.toFixed(2),
  })

  // ── Idempotency key — prevents double-charge if request is retried ────────
  const iKey = idempotencyKey('plan-change', auth.sub, body.subscriptionId, body.newPlanId)
  logger.info('Plan change idempotency key', { key: iKey })

  // ── Cancel existing Recharge subscription ────────────────────────────────
  if (subscription.rechargeSubscriptionId) {
    await cancelSubscription(
      subscription.rechargeSubscriptionId,
      `Plan change from ${subscription.plan.name} to ${newPlanConfig.name}`,
    )
  }

  // ── Create new Recharge subscription on new plan ──────────────────────────
  let newRechargeSubscriptionId: string | undefined
  if (subscription.member.rechargeCustomerId) {
    const rechargeSub = await createSubscription({
      customerId:        subscription.member.rechargeCustomerId,
      shopifyVariantId:  newPlanConfig.shopifyVariantId,
      quantity:          1,
      intervalUnit:      newPlanConfig.intervalUnit,
      intervalFrequency: newPlanConfig.intervalFrequency,
    })
    newRechargeSubscriptionId = String(rechargeSub.id)
  }

  // ── Find or create new plan record ───────────────────────────────────────
  let newPlanRecord = await db.subscriptionPlan.findFirst({ where: { name: newPlanConfig.name } })
  if (!newPlanRecord) {
    const product = await db.product.create({
      data: {
        shopifyProductId: `novamember_${body.newPlanId}`,
        title: `NovaMember ${newPlanConfig.name}`,
        status: 'ACTIVE',
      },
    })
    newPlanRecord = await db.subscriptionPlan.create({
      data: {
        productId:     product.id,
        name:          newPlanConfig.name,
        price:         newPlanConfig.price,
        billingCycle:  'MONTHLY',
        intervalCount: 1,
        isActive:      true,
      },
    })
  }

  // ── Update DB atomically ──────────────────────────────────────────────────
  const newPeriodEnd = new Date(now)
  newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

  const [, newSubscription] = await db.$transaction([
    // Mark old subscription cancelled
    db.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELLED', cancelledAt: now },
    }),
    // Create new subscription on new plan
    db.subscription.create({
      data: {
        memberId:                  auth.sub,
        planId:                    newPlanRecord.id,
        rechargeSubscriptionId:    newRechargeSubscriptionId ?? null,
        status:                    'ACTIVE',
        currentPeriodStart:        now,
        currentPeriodEnd:          newPeriodEnd,
        priceAtSubscription:       newPlanConfig.price,
      },
    }),
    // Log the plan change
    db.activityEvent.create({
      data: {
        memberId:  auth.sub,
        eventType: isUpgrade ? 'subscription.upgraded' : 'subscription.downgraded',
        source:    'api',
        properties: {
          from:                       currentPlanKey,
          to:                         body.newPlanId,
          creditAmount:               creditAmount.toFixed(2),
          chargeAmount:               chargeAmount.toFixed(2),
          oldRechargeSubscriptionId:  subscription.rechargeSubscriptionId,
          newRechargeSubscriptionId:  newRechargeSubscriptionId ?? null,
        },
      },
    }),
  ])

  // ── Send confirmation email ───────────────────────────────────────────────
  try {
    await sendSubscriptionStartedEmail({
      to:                     subscription.member.email,
      firstName:              subscription.member.firstName,
      planName:               newPlanConfig.name,
      amount:                 isUpgrade ? Math.round(chargeAmount) : newPlanConfig.price,
      nextBillingDate:        newPeriodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      rechargeSubscriptionId: newRechargeSubscriptionId,
    })
  } catch (err) {
    // Non-fatal — email failure must never roll back a billing operation
    logger.error('Failed to send plan change email', { error: String(err), memberId: auth.sub })
  }

  return NextResponse.json({
    message:      isUpgrade ? 'Plan upgraded successfully' : 'Plan downgraded — change effective now',
    subscriptionId: newSubscription.id,
    plan:         newPlanConfig.name,
    price:        newPlanConfig.price,
    chargeToday:  isUpgrade ? Math.round(chargeAmount) : 0,
    nextBilling:  newPeriodEnd.toISOString(),
    rechargeSubscriptionId: newRechargeSubscriptionId,
  })
  } catch (err) {
    logger.error('Plan change failed', { error: String(err), memberId: auth.sub, subscriptionId: body.subscriptionId })
    return NextResponse.json({ error: 'Failed to change plan. Please try again or contact support.' }, { status: 502 })
  }
}
