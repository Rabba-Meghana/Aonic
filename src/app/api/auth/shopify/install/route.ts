/**
 * NovaMember — Shopify OAuth: Step 1 — Install / Authorize
 *
 * Merchant visits /api/auth/shopify/install?shop=mystore.myshopify.com
 * We validate the shop domain, generate a nonce (state), persist it,
 * then redirect to Shopify's OAuth authorization screen.
 *
 * GET /api/auth/shopify/install?shop=<shop>
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { buildOAuthUrl } from '@/lib/shopify'
import { logger } from '@/lib/logger'

// Basic Shopify myshopify domain validation
const SHOP_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/

export async function GET(req: NextRequest) {
  try {
    const shop = req.nextUrl.searchParams.get('shop')

    if (!shop || !SHOP_REGEX.test(shop)) {
      return NextResponse.json(
        { error: 'Missing or invalid shop parameter' },
        { status: 400 },
      )
    }

    // Generate a cryptographically random nonce to prevent CSRF
    const state = crypto.randomBytes(16).toString('hex')

    // Persist the nonce so we can verify it on callback
    // We store it as a webhook event record keyed by state (lightweight, reuses existing table)
    await db.webhookEvent.create({
      data: {
        source: 'shopify_oauth',
        topic: 'oauth/nonce',
        externalId: state,
        payload: { shop, state, createdAt: new Date().toISOString() },
        status: 'PENDING',
      },
    })

    const authUrl = buildOAuthUrl(shop, state)
    logger.info('Shopify OAuth initiated', { shop, state })

    // Redirect merchant to Shopify to approve the app install
    return NextResponse.redirect(authUrl)
  } catch (err) {
    logger.error('Shopify install error', { error: String(err) })
    return NextResponse.json({ error: 'Failed to initiate OAuth' }, { status: 500 })
  }
}
