/**
 * NovaMember — Recharge Webhook Handler
 *
 * Processes all Recharge subscription lifecycle events.
 * Every request is HMAC-verified before any processing.
 * Webhooks are deduplicated — replayed events are safely ignored.
 *
 * Handled topics:
 *   subscription/activated   — mark active, extend billing period
 *   subscription/cancelled   — mark cancelled, send cancellation email
 *   charge/paid              — record charge, recover from dunning, send receipt
 *   charge/failed            — dunning: increment retry, send failure email, trigger at-risk score
 *
 * POST /api/webhooks/recharge
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyWebhookSignature, RechargeWebhookPayload, getRechargeCustomer } from '@/lib/recharge'
import { toInputJson } from '@/lib/json'
import {
  sendChargeFailed,
  sendChargeRecovered,
  sendSubscriptionCancelledEmail,
  sendSubscriptionStartedEmail,
  sendAtRiskOutreach,
} from '@/lib/email'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const topic     = request.headers.get('X-Recharge-Topic')      ?? ''
  const signature = request.headers.get('X-Recharge-Hmac-Sha256') ?? ''
  const requestId = request.headers.get('x-request-id') ?? 'unknown'

  const rawBody = await request.text()

  // ── 1. HMAC verification ──────────────────────────────────────────────────
  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn('Recharge webhook HMAC invalid', { topic, requestId })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: RechargeWebhookPayload
  try {
    payload = JSON.parse(rawBody) as RechargeWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const externalId = String(payload.id)

  // ── 2. Idempotency check — ignore replayed webhooks ───────────────────────
  const existing = await db.webhookEvent.findFirst({
    where: { source: 'recharge', topic, externalId, status: 'PROCESSED' },
  })
  if (existing) {
    logger.info('Recharge webhook already processed — skipping', { topic, externalId })
    return NextResponse.json({ received: true, duplicate: true })
  }

  // ── 3. Persist for audit / retry ──────────────────────────────────────────
  const webhookEvent = await db.webhookEvent.create({
    data: {
      source:     'recharge',
      topic,
      externalId,
      payload:    toInputJson(payload as unknown as Record<string, unknown>),
      status:     'PENDING',
    },
  })

  try {
    await handleRechargeEvent(topic, payload)

    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data:  { status: 'PROCESSED', processedAt: new Date() },
    })

    return NextResponse.json({ received: true })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status:       'FAILED',
        errorMessage,
        retryCount:   { increment: 1 },
      },
    })

    logger.error('Recharge webhook processing failed', { topic, externalId, error: errorMessage })
    // Return 200 to prevent Recharge from its own retry — we handle retries
    return NextResponse.json({ received: true, processingError: true })
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────
async function handleRechargeEvent(
  topic: string,
  payload: RechargeWebhookPayload,
): Promise<void> {
  logger.info('Processing Recharge webhook', { topic, id: payload.id })

  switch (topic) {
    // ── subscription/activated ─────────────────────────────────────────────
    // This is the event that actually confirms a real payment method was
    // attached and a real subscription was created on Recharge's side — it's
    // the source of truth, not the checkout POST that started the flow.
    case 'subscription/activated': {
      const sub = payload.subscription as {
        id: number
        customer_id: number
        status: string
        next_charge_scheduled_at: string
        price: string
        product_title: string
        variant_title?: string
      }

      // Try the fast path first: a member we've already linked to this
      // Recharge customer (e.g. from a previous subscription event).
      let member = await db.member.findFirst({
        where: { rechargeCustomerId: String(sub.customer_id) },
      })

      // First-time link: look up the Recharge customer to get the Shopify
      // customer id it's tied to, and match our member by that instead.
      if (!member) {
        try {
          const rechargeCustomer = await getRechargeCustomer(String(sub.customer_id))
          const shopifyCustomerId = rechargeCustomer.external_customer_id?.ecommerce

          member = shopifyCustomerId
            ? await db.member.findFirst({ where: { shopifyCustomerId } })
            : await db.member.findUnique({ where: { email: rechargeCustomer.email } })

          if (member && !member.rechargeCustomerId) {
            member = await db.member.update({
              where: { id: member.id },
              data:  { rechargeCustomerId: String(sub.customer_id) },
            })
          }
        } catch (err) {
          logger.error('subscription/activated: failed to resolve Recharge customer', {
            error: String(err), rechargeCustomerId: sub.customer_id,
          })
        }
      }

      if (!member) {
        logger.warn('subscription/activated: no member found for Recharge customer — cannot link subscription', {
          customerId: sub.customer_id,
        })
        break
      }

      const periodEnd = new Date(sub.next_charge_scheduled_at)

      // Find or seed the plan this subscription belongs to (matched by price,
      // since Recharge's product_title is merchant-set copy, not a stable key).
      const price = parseFloat(sub.price)
      let subPlan = await db.subscriptionPlan.findFirst({ where: { price } })
      if (!subPlan) {
        const product = await db.product.upsert({
          where:  { shopifyProductId: `recharge_${sub.id}` },
          update: {},
          create: {
            shopifyProductId: `recharge_${sub.id}`,
            title:            sub.product_title,
            status:           'ACTIVE',
          },
        })
        subPlan = await db.subscriptionPlan.create({
          data: {
            productId:     product.id,
            name:          sub.product_title,
            price,
            billingCycle:  'MONTHLY',
            intervalCount: 1,
            isActive:      true,
          },
        })
      }

      // Create (or update, if this is a re-activation) the subscription record.
      const existingSub = await db.subscription.findFirst({
        where: { rechargeSubscriptionId: String(sub.id) },
      })

      if (existingSub) {
        await db.subscription.update({
          where: { id: existingSub.id },
          data:  { status: 'ACTIVE', currentPeriodEnd: periodEnd },
        })
      } else {
        await db.subscription.create({
          data: {
            memberId:                member.id,
            planId:                  subPlan.id,
            rechargeSubscriptionId:  String(sub.id),
            status:                  'ACTIVE',
            currentPeriodStart:      new Date(),
            currentPeriodEnd:        periodEnd,
            priceAtSubscription:     price,
          },
        })

        sendSubscriptionStartedEmail({
          to:                     member.email,
          firstName:               member.firstName,
          planName:                sub.product_title,
          amount:                  price,
          nextBillingDate:         periodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          rechargeSubscriptionId:  String(sub.id),
        }).catch(err => logger.error('Failed to send subscription-started email', { error: String(err), memberId: member!.id }))
      }

      await db.activityEvent.create({
        data: {
          memberId:  member.id,
          eventType: 'subscription.activated',
          source:    'recharge_webhook',
          properties: {
            rechargeSubscriptionId: sub.id,
            productTitle:           sub.product_title,
            nextChargeAt:           sub.next_charge_scheduled_at,
          },
        },
      })
      break
    }

    // ── subscription/cancelled ─────────────────────────────────────────────
    case 'subscription/cancelled': {
      const sub = payload.subscription as {
        id: number
        customer_id: number
        cancelled_at: string
        cancellation_reason?: string
        next_charge_scheduled_at?: string
      }

      const member = await db.member.findFirst({
        where: { rechargeCustomerId: String(sub.customer_id) },
      })
      if (!member) return

      const subscription = await db.subscription.findFirst({
        where: {
          memberId:               member.id,
          rechargeSubscriptionId: String(sub.id),
        },
        include: { plan: true },
      })

      await db.subscription.updateMany({
        where: {
          memberId:               member.id,
          rechargeSubscriptionId: String(sub.id),
        },
        data: { status: 'CANCELLED', cancelledAt: new Date(sub.cancelled_at) },
      })

      await db.activityEvent.create({
        data: {
          memberId:  member.id,
          eventType: 'subscription.cancelled',
          source:    'recharge_webhook',
          properties: {
            rechargeSubscriptionId: sub.id,
            reason:                 sub.cancellation_reason ?? null,
          },
        },
      })

      // Send cancellation email
      if (subscription) {
        const accessEndsAt = sub.next_charge_scheduled_at
          ? new Date(sub.next_charge_scheduled_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : 'the end of your billing period'

        await sendSubscriptionCancelledEmail({
          to:           member.email,
          firstName:    member.firstName,
          planName:     subscription.plan.name,
          accessEndsAt,
        }).catch(err => logger.error('Failed to send cancellation email', { error: String(err) }))
      }
      break
    }

    // ── charge/paid ────────────────────────────────────────────────────────
    case 'charge/paid': {
      const charge = payload.charge as {
        id: number
        customer_id: number
        subscription_id: number
        total_price: string
        processed_at: string
        scheduled_at: string
      }

      const member = await db.member.findFirst({
        where: { rechargeCustomerId: String(charge.customer_id) },
      })
      if (!member) return

      // Find our subscription record
      const subscription = await db.subscription.findFirst({
        where: {
          memberId:               member.id,
          rechargeSubscriptionId: String(charge.subscription_id),
        },
        include: { plan: true },
      })

      if (subscription) {
        // Upsert the charge record (idempotent on rechargeChargeId)
        await db.charge.upsert({
          where:  { rechargeChargeId: String(charge.id) },
          create: {
            rechargeChargeId: String(charge.id),
            subscriptionId:   subscription.id,
            amount:           parseFloat(charge.total_price),
            currency:         'USD',
            status:           'SUCCESS',
            scheduledAt:      new Date(charge.scheduled_at),
            processedAt:      new Date(charge.processed_at),
          },
          update: {
            status:      'SUCCESS',
            processedAt: new Date(charge.processed_at),
          },
        })

        // Extend subscription period
        const newPeriodEnd = new Date(charge.scheduled_at)
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

        await db.subscription.update({
          where: { id: subscription.id },
          data: {
            status:           'ACTIVE',
            currentPeriodEnd: newPeriodEnd,
          },
        })

        // Check if this was a dunning recovery (was PAST_DUE before)
        const wasDelinquent = subscription.status === 'PAST_DUE'
        if (wasDelinquent) {
          await sendChargeRecovered({
            to:        member.email,
            firstName: member.firstName,
            amount:    parseFloat(charge.total_price),
          }).catch(err => logger.error('Failed to send recovery email', { error: String(err) }))
        }
      }

      await db.activityEvent.create({
        data: {
          memberId:  member.id,
          eventType: 'charge.paid',
          source:    'recharge_webhook',
          properties: {
            amount:           charge.total_price,
            rechargeChargeId: charge.id,
          },
        },
      })

      logger.info('Charge paid', { memberId: member.id, amount: charge.total_price })
      break
    }

    // ── charge/failed ─────────────────────────────────────────────────────
    case 'charge/failed': {
      const charge = payload.charge as {
        id: number
        customer_id: number
        subscription_id: number
        total_price: string
        error?: string
        error_type?: string
        next_attempt?: string
      }

      const member = await db.member.findFirst({
        where: { rechargeCustomerId: String(charge.customer_id) },
      })
      if (!member) return

      const subscription = await db.subscription.findFirst({
        where: {
          memberId:               member.id,
          rechargeSubscriptionId: String(charge.subscription_id),
        },
      })

      if (subscription) {
        // Mark subscription past due
        await db.subscription.update({
          where: { id: subscription.id },
          data:  { status: 'PAST_DUE' },
        })

        // Upsert failed charge record
        await db.charge.upsert({
          where:  { rechargeChargeId: String(charge.id) },
          create: {
            rechargeChargeId: String(charge.id),
            subscriptionId:   subscription.id,
            amount:           parseFloat(charge.total_price),
            currency:         'USD',
            status:           'ERROR',
            scheduledAt:      new Date(),
            failureReason:    charge.error ?? charge.error_type ?? 'Unknown',
          },
          update: {
            status:        'ERROR',
            failureReason: charge.error ?? charge.error_type ?? 'Unknown',
            retryCount:    { increment: 1 },
          },
        })
      }

      // Send dunning email
      await sendChargeFailed({
        to:           member.email,
        firstName:    member.firstName,
        amount:       parseFloat(charge.total_price),
        failureReason: charge.error ?? charge.error_type,
        retryDate:    charge.next_attempt
          ? new Date(charge.next_attempt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
          : undefined,
      }).catch(err => logger.error('Failed to send dunning email', { error: String(err) }))

      await db.activityEvent.create({
        data: {
          memberId:  member.id,
          eventType: 'charge.failed',
          source:    'recharge_webhook',
          properties: {
            rechargeChargeId: charge.id,
            amount:           charge.total_price,
            reason:           charge.error ?? charge.error_type ?? null,
          },
        },
      })

      // Trigger an immediate engagement re-score — failed payment is a strong churn signal
      await db.member.update({
        where: { id: member.id },
        data:  { lastScoredAt: null },   // forces re-score on next eval run
      })

      logger.warn('Charge failed — dunning triggered', {
        memberId:     member.id,
        chargeId:     charge.id,
        amount:       charge.total_price,
        reason:       charge.error,
      })
      break
    }

    default:
      logger.info('Unhandled Recharge topic', { topic })
  }
}
