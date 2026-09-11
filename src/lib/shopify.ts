/**
 * NovaMember — Shopify Integration
 *
 * Full Shopify OAuth flow + Storefront API + Admin API integration.
 * Handles product sync, customer creation, and order webhooks.
 */

import crypto from 'crypto'
import { logger } from './logger'

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY ?? ''
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET ?? ''
const SHOPIFY_SCOPES = [
  'read_products',
  'write_products',
  'read_customers',
  'write_customers',
  'read_orders',
  'write_orders',
].join(',')

export interface ShopifyProduct {
  id: string
  title: string
  handle: string
  description: string
  vendor: string
  product_type: string
  tags: string
  status: 'active' | 'archived' | 'draft'
  images: Array<{ id: string; src: string; alt?: string }>
  variants: ShopifyVariant[]
  created_at: string
  updated_at: string
}

export interface ShopifyVariant {
  id: string
  product_id: string
  title: string
  sku: string
  price: string
  compare_at_price?: string
  inventory_quantity: number
  requires_shipping: boolean
}

export interface ShopifyCustomer {
  id: string
  email: string
  first_name: string
  last_name: string
  phone?: string
  accepts_marketing: boolean
  verified_email: boolean
  created_at: string
  updated_at: string
}

export interface ShopifyOrder {
  id: string
  name: string
  email: string
  customer: ShopifyCustomer
  line_items: Array<{
    id: string
    variant_id: string
    title: string
    quantity: number
    price: string
  }>
  total_price: string
  financial_status: 'pending' | 'authorized' | 'partially_paid' | 'paid' | 'partially_refunded' | 'refunded' | 'voided'
  fulfillment_status?: 'fulfilled' | 'partial' | 'restocked' | null
  created_at: string
}

// ── OAuth ─────────────────────────────────────────────────────────────────────
/**
 * Generates the Shopify OAuth authorization URL.
 * Step 1 of the OAuth flow — redirect merchant here.
 */
export function buildOAuthUrl(shop: string, state: string): string {
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/shopify/callback`
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
    'grant_options[]': 'per-user',
  })
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`
}

/**
 * Exchanges the OAuth code for an access token.
 * Step 2 of the OAuth flow.
 */
export async function exchangeCodeForToken(shop: string, code: string): Promise<string> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Shopify token exchange failed: ${body}`)
  }

  const data = await response.json() as { access_token: string }
  logger.info('Shopify OAuth token obtained', { shop })
  return data.access_token
}

/**
 * Validates HMAC signature on OAuth callback to prevent CSRF.
 */
export function validateOAuthCallback(params: URLSearchParams): boolean {
  const hmac = params.get('hmac') ?? ''
  const queryParams = new URLSearchParams(params)
  queryParams.delete('hmac')

  const message = Array.from(queryParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const digest = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex')

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))
}

// ── Admin API ─────────────────────────────────────────────────────────────────
async function shopifyRequest<T>(
  shop: string,
  accessToken: string,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<T> {
  const url = `https://${shop}/admin/api/2024-10${path}`
  const response = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    logger.error('Shopify API error', { shop, path, status: response.status })
    throw new Error(`Shopify API ${response.status}: ${errorBody}`)
  }

  return response.json() as Promise<T>
}

// ── Products ──────────────────────────────────────────────────────────────────
export async function fetchProducts(
  shop: string,
  accessToken: string,
  options: { limit?: number; status?: 'active' | 'archived' | 'draft' } = {},
): Promise<ShopifyProduct[]> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 50),
    status: options.status ?? 'active',
  })
  const data = await shopifyRequest<{ products: ShopifyProduct[] }>(
    shop, accessToken, `/products.json?${params}`,
  )
  return data.products
}

export async function fetchProduct(
  shop: string,
  accessToken: string,
  productId: string,
): Promise<ShopifyProduct> {
  const data = await shopifyRequest<{ product: ShopifyProduct }>(
    shop, accessToken, `/products/${productId}.json`,
  )
  return data.product
}

// ── Customers ─────────────────────────────────────────────────────────────────
export async function createShopifyCustomer(
  shop: string,
  accessToken: string,
  params: { email: string; firstName: string; lastName: string },
): Promise<ShopifyCustomer> {
  const data = await shopifyRequest<{ customer: ShopifyCustomer }>(
    shop, accessToken, '/customers.json', 'POST',
    {
      customer: {
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        verified_email: true,
        marketing_opt_in_level: null,
      },
    },
  )
  return data.customer
}

// ── Checkout ──────────────────────────────────────────────────────────────────
/**
 * Builds a real, PCI-compliant Shopify checkout URL for a subscription.
 *
 * Why this exists instead of a custom card form: Recharge's real API will not
 * accept a raw card number (correctly — that would require us to be PCI
 * compliant ourselves). The actual Shopify+Recharge pattern is that Shopify's
 * own hosted checkout collects payment, with a Recharge "selling plan"
 * attached to the line item; Recharge listens to the resulting order and
 * creates its own customer + subscription, then notifies us via the
 * `subscription/activated` webhook (see src/app/api/webhooks/recharge/route.ts).
 *
 * Uses Shopify's classic cart permalink format:
 *   https://{shop}/cart/{variant_id}:{quantity}?selling_plan={selling_plan_id}
 * which redirects straight into checkout. `note_attributes` carries our
 * internal member id through checkout so we can match it back up even before
 * Recharge/Shopify webhooks fire.
 */
export function buildSubscriptionCheckoutUrl(params: {
  shop: string
  variantId: string
  sellingPlanId?: string
  quantity?: number
  email?: string
  memberId: string
  returnTo?: string
}): string {
  const qty = params.quantity ?? 1
  const search = new URLSearchParams()
  if (params.sellingPlanId) search.set('selling_plan', params.sellingPlanId)
  if (params.email) search.set('checkout[email]', params.email)
  search.set('checkout[custom][novamember_member_id]', params.memberId)
  search.set('attributes[novamember_member_id]', params.memberId)
  if (params.returnTo) search.set('return_to', params.returnTo)

  return `https://${params.shop}/cart/${params.variantId}:${qty}?${search.toString()}`
}

// ── Webhooks ──────────────────────────────────────────────────────────────────
export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string,
  apiSecret: string = SHOPIFY_API_SECRET,
): boolean {
  const digest = crypto
    .createHmac('sha256', apiSecret)
    .update(rawBody)
    .digest('base64')

  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(hmacHeader),
  )
}

export async function registerWebhooks(shop: string, accessToken: string): Promise<void> {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://your-domain.com'
  const topics = [
    'orders/paid',
    'customers/create',
    'customers/update',
    'products/update',
  ]

  await Promise.all(
    topics.map(topic =>
      shopifyRequest(shop, accessToken, '/webhooks.json', 'POST', {
        webhook: {
          topic,
          address: `${baseUrl}/api/webhooks/shopify`,
          format: 'json',
        },
      }),
    ),
  )

  logger.info('Shopify webhooks registered', { shop, topics })
}
