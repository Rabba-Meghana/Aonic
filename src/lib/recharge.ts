/**
 * NovaMember — Recharge API Service
 *
 * Full Recharge API v1 integration for subscription lifecycle management:
 * customers, subscriptions, charges, and webhook verification.
 */

import crypto from 'crypto'
import { logger } from './logger'

const RECHARGE_API_BASE = 'https://api.rechargeapps.com'
const RECHARGE_API_KEY = process.env.RECHARGE_API_KEY ?? ''
const RECHARGE_WEBHOOK_SECRET = process.env.RECHARGE_WEBHOOK_SECRET ?? ''

// ── Types ─────────────────────────────────────────────────────────────────────
export interface RechargeCustomer {
  id: number
  email: string
  first_name: string
  last_name: string
  external_customer_id: { ecommerce: string }
  created_at: string
  updated_at: string
}

export interface RechargeSubscription {
  id: number
  customer_id: number
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED'
  product_title: string
  variant_title: string
  price: string
  quantity: number
  billing_policy: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
  }
  shipping_policy: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
  }
  next_charge_scheduled_at: string
  created_at: string
  updated_at: string
}

export interface RechargeCharge {
  id: number
  customer_id: number
  subscription_id: number
  status: 'SUCCESS' | 'ERROR' | 'QUEUED' | 'SKIPPED' | 'REFUNDED'
  total_price: string
  scheduled_at: string
  processed_at?: string
  created_at: string
}

export type RechargeWebhookTopic =
  | 'subscription/activated'
  | 'subscription/cancelled'
  | 'subscription/paused'
  | 'subscription/resumed'
  | 'charge/paid'
  | 'charge/failed'
  | 'charge/refunded'
  | 'customer/created'
  | 'customer/updated'

export interface RechargeWebhookPayload<T = unknown> {
  id: number
  topic: RechargeWebhookTopic
  address?: T
  subscription?: T
  charge?: T
  customer?: T
}

// ── HTTP client ───────────────────────────────────────────────────────────────
async function rechargeRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<T> {
  const url = `${RECHARGE_API_BASE}${path}`
  const options: RequestInit = {
    method,
    headers: {
      'X-Recharge-Access-Token': RECHARGE_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  }

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)

  if (!response.ok) {
    const errorBody = await response.text()
    logger.error('Recharge API error', { url, status: response.status, body: errorBody })
    throw new Error(`Recharge API error ${response.status}: ${errorBody}`)
  }

  return response.json() as Promise<T>
}

// ── Customer management ───────────────────────────────────────────────────────
export async function createRechargeCustomer(params: {
  email: string
  firstName: string
  lastName: string
  shopifyCustomerId: string
}): Promise<RechargeCustomer> {
  const data = await rechargeRequest<{ customer: RechargeCustomer }>(
    '/customers',
    'POST',
    {
      email: params.email,
      first_name: params.firstName,
      last_name: params.lastName,
      external_customer_id: { ecommerce: params.shopifyCustomerId },
    },
  )
  logger.info('Recharge customer created', { rechargeId: data.customer.id })
  return data.customer
}

export async function getRechargeCustomer(rechargeCustomerId: string): Promise<RechargeCustomer> {
  const data = await rechargeRequest<{ customer: RechargeCustomer }>(
    `/customers/${rechargeCustomerId}`,
  )
  return data.customer
}

// ── Subscription management ───────────────────────────────────────────────────
export async function createSubscription(params: {
  customerId: string
  shopifyVariantId: string
  quantity?: number
  intervalUnit: 'month' | 'week' | 'day'
  intervalFrequency: number
}): Promise<RechargeSubscription> {
  const data = await rechargeRequest<{ subscription: RechargeSubscription }>(
    '/subscriptions',
    'POST',
    {
      customer_id: params.customerId,
      external_variant_id: { ecommerce: params.shopifyVariantId },
      quantity: params.quantity ?? 1,
      billing_policy: {
        interval: params.intervalUnit,
        interval_count: params.intervalFrequency,
      },
      shipping_policy: {
        interval: params.intervalUnit,
        interval_count: params.intervalFrequency,
      },
    },
  )
  logger.info('Recharge subscription created', { subscriptionId: data.subscription.id })
  return data.subscription
}

export async function cancelSubscription(
  subscriptionId: string,
  reason?: string,
): Promise<RechargeSubscription> {
  const data = await rechargeRequest<{ subscription: RechargeSubscription }>(
    `/subscriptions/${subscriptionId}/cancel`,
    'POST',
    { cancellation_reason: reason ?? 'Customer requested' },
  )
  logger.info('Recharge subscription cancelled', { subscriptionId })
  return data.subscription
}

export async function pauseSubscription(subscriptionId: string): Promise<RechargeSubscription> {
  const data = await rechargeRequest<{ subscription: RechargeSubscription }>(
    `/subscriptions/${subscriptionId}/set_next_charge_date`,
    'PUT',
    { date: getNextMonthDate() },
  )
  return data.subscription
}

export async function listSubscriptions(customerId: string): Promise<RechargeSubscription[]> {
  const data = await rechargeRequest<{ subscriptions: RechargeSubscription[] }>(
    `/subscriptions?customer_id=${customerId}`,
  )
  return data.subscriptions
}

// ── Charge management ─────────────────────────────────────────────────────────
export async function listCharges(customerId: string): Promise<RechargeCharge[]> {
  const data = await rechargeRequest<{ charges: RechargeCharge[] }>(
    `/charges?customer_id=${customerId}&sort_by=scheduled_at-desc`,
  )
  return data.charges
}

// ── Webhook verification ──────────────────────────────────────────────────────
/**
 * Verifies the Recharge webhook HMAC signature.
 * Must be called before processing any webhook payload.
 *
 * @see https://developer.rechargepayments.com/#webhooks
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): boolean {
  if (!RECHARGE_WEBHOOK_SECRET) {
    logger.warn('RECHARGE_WEBHOOK_SECRET not set — skipping signature verification')
    return process.env.NODE_ENV !== 'production'
  }

  const digest = crypto
    .createHmac('sha256', RECHARGE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')

  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(digest, 'hex'),
    Buffer.from(signature, 'hex'),
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getNextMonthDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().split('T')[0]
}
