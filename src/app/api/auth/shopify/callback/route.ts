/**
 * NovaMember — Shopify OAuth: Step 2 — Callback
 *
 * Shopify redirects the merchant back here after they approve the app install.
 * We:
 *  1. Validate the HMAC signature on the query params (prevents forgery)
 *  2. Verify the nonce matches what we generated in Step 1 (prevents CSRF)
 *  3. Exchange the one-time code for a permanent access token
 *  4. Register webhooks on the merchant's store
 *  5. Create / update the member record linked to the Shopify store
 *  6. Redirect the merchant into the NovaMember dashboard
 *
 * GET /api/auth/shopify/callback?code=&hmac=&shop=&state=&timestamp=
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  validateOAuthCallback,
  exchangeCodeForToken,
  registerWebhooks,
  createShopifyCustomer,
} from '@/lib/shopify'
import { signToken } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const shop    = params.get('shop')    ?? ''
  const state   = params.get('state')   ?? ''
  const code    = params.get('code')    ?? ''

  try {
    // ── 1. HMAC validation ────────────────────────────────────────────────────
    const isValid = validateOAuthCallback(params)
    if (!isValid) {
      logger.warn('Shopify OAuth callback HMAC mismatch', { shop })
      return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 })
    }

    // ── 2. Nonce (state) validation ───────────────────────────────────────────
    const nonceRecord = await db.webhookEvent.findFirst({
      where: {
        source: 'shopify_oauth',
        topic: 'oauth/nonce',
        externalId: state,
        status: 'PENDING',
      },
    })

    if (!nonceRecord) {
      logger.warn('Shopify OAuth callback: unknown or replayed state', { shop, state })
      return NextResponse.json({ error: 'Invalid state parameter' }, { status: 401 })
    }

    // Consume the nonce — mark it processed so it can't be replayed
    await db.webhookEvent.update({
      where: { id: nonceRecord.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    })

    // ── 3. Exchange code for access token ─────────────────────────────────────
    const accessToken = await exchangeCodeForToken(shop, code)

    // ── 4. Register webhooks on the merchant's store ──────────────────────────
    await registerWebhooks(shop, accessToken)

    // ── 5. Upsert the member record linked to this Shopify store ─────────────
    // In a real install flow the shop becomes the merchant's identity.
    // We derive a synthetic email from the shop domain for the member record.
    const shopEmail = `shopify+${shop.replace('.myshopify.com', '')}@novamember.internal`

    let member = await db.member.findUnique({ where: { email: shopEmail } })

    if (!member) {
      // First-time install — create the merchant member record
      const shopifyCustomer = await createShopifyCustomer(shop, accessToken, {
        email: shopEmail,
        firstName: shop.split('.')[0],
        lastName: '(Shopify merchant)',
      })

      member = await db.member.create({
        data: {
          email: shopEmail,
          passwordHash: 'oauth_shopify_no_password',   // OAuth-only account
          firstName: shopifyCustomer.first_name,
          lastName: shopifyCustomer.last_name,
          shopifyCustomerId: shopifyCustomer.id,
          role: 'ADMIN',
        },
      })

      // Record the OAuth install as an activity event
      await db.activityEvent.create({
        data: {
          memberId: member.id,
          eventType: 'shopify.oauth.installed',
          source: 'shopify',
          properties: { shop, webhooksRegistered: true },
        },
      })
    } else {
      // Re-install — update the Shopify customer ID in case it changed
      await db.member.update({
        where: { id: member.id },
        data: { updatedAt: new Date() },
      })
    }

    logger.info('Shopify OAuth complete', { shop, memberId: member.id })

    // ── 6. Issue a JWT and redirect into the dashboard ────────────────────────
    const token = signToken({ sub: member.id, email: member.email, role: member.role })
    const dashboardUrl = new URL('/dashboard', process.env.NEXTAUTH_URL ?? 'http://localhost:3000')
    dashboardUrl.searchParams.set('token', token)
    dashboardUrl.searchParams.set('shop', shop)

    return NextResponse.redirect(dashboardUrl.toString())
  } catch (err) {
    logger.error('Shopify OAuth callback error', { shop, error: String(err) })
    return NextResponse.json({ error: 'OAuth flow failed' }, { status: 500 })
  }
}
