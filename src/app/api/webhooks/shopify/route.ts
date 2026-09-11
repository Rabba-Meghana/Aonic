/**
 * NovaMember — Shopify Webhook Handler
 *
 * Receives and processes webhook events from Shopify.
 * All webhooks are HMAC-verified before any processing.
 *
 * Handled topics:
 *   orders/paid          — sync order to member charge record
 *   customers/create     — link new Shopify customer to NovaMember member
 *   customers/update     — sync customer details to member profile
 *   products/update      — sync product changes to local DB
 *
 * POST /api/webhooks/shopify
 * Headers: X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Shop-Domain
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyShopifyWebhook } from '@/lib/shopify'
import { logger } from '@/lib/logger'
import { toInputJson } from '@/lib/json'

export async function POST(req: NextRequest) {
  // ── HMAC verification — must happen before reading payload ────────────────
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256') ?? ''
  const topic      = req.headers.get('x-shopify-topic')       ?? ''
  const shop       = req.headers.get('x-shopify-shop-domain') ?? ''

  const rawBody = await req.text()

  const isValid = verifyShopifyWebhook(rawBody, hmacHeader)
  if (!isValid) {
    logger.warn('Shopify webhook HMAC verification failed', { topic, shop })
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // Persist the raw webhook for audit / retry
  const webhookEvent = await db.webhookEvent.create({
    data: {
      source:   'shopify',
      topic,
      externalId: String((payload as { id?: unknown }).id ?? ''),
      payload:  toInputJson(payload),
      status:   'PENDING',
    },
  })

  try {
    switch (topic) {
      // ── orders/paid ─────────────────────────────────────────────────────
      case 'orders/paid': {
        const order = payload as {
          id: number
          email: string
          customer?: { id: number }
          total_price: string
          created_at: string
        }

        // Find the member by email or Shopify customer ID
        const member = await db.member.findFirst({
          where: {
            OR: [
              { email: order.email },
              { shopifyCustomerId: order.customer ? String(order.customer.id) : undefined },
            ],
          },
          include: { subscriptions: { take: 1, orderBy: { createdAt: 'desc' } } },
        })

        if (member?.subscriptions[0]) {
          await db.charge.create({
            data: {
              subscriptionId: member.subscriptions[0].id,
              amount:         parseFloat(order.total_price),
              currency:       'USD',
              status:         'SUCCESS',
              scheduledAt:    new Date(order.created_at),
              processedAt:    new Date(order.created_at),
            },
          })

          await db.activityEvent.create({
            data: {
              memberId:  member.id,
              eventType: 'shopify.order.paid',
              source:    'shopify',
              properties: { shopifyOrderId: order.id, amount: order.total_price },
            },
          })
        }
        break
      }

      // ── customers/create ─────────────────────────────────────────────────
      case 'customers/create': {
        const customer = payload as {
          id: number
          email: string
          first_name: string
          last_name: string
        }

        // Link the Shopify customer ID to an existing NovaMember member
        const member = await db.member.findUnique({ where: { email: customer.email } })
        if (member && !member.shopifyCustomerId) {
          await db.member.update({
            where: { id: member.id },
            data: { shopifyCustomerId: String(customer.id) },
          })
          logger.info('Linked Shopify customer to member', {
            memberId: member.id,
            shopifyCustomerId: customer.id,
          })
        }
        break
      }

      // ── customers/update ─────────────────────────────────────────────────
      case 'customers/update': {
        const customer = payload as {
          id: number
          email: string
          first_name: string
          last_name: string
        }

        const member = await db.member.findFirst({
          where: { shopifyCustomerId: String(customer.id) },
        })
        if (member) {
          await db.member.update({
            where: { id: member.id },
            data: {
              firstName: customer.first_name || member.firstName,
              lastName:  customer.last_name  || member.lastName,
            },
          })
        }
        break
      }

      // ── products/update ──────────────────────────────────────────────────
      case 'products/update': {
        const product = payload as {
          id: number
          title: string
          status: string
          vendor: string
          product_type: string
          tags: string
          images?: Array<{ src: string }>
        }

        await db.product.upsert({
          where:  { shopifyProductId: String(product.id) },
          update: {
            title:       product.title,
            status:      product.status?.toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED',
            vendor:      product.vendor,
            productType: product.product_type,
            tags:        product.tags?.split(', ').filter(Boolean) ?? [],
            imageUrl:    product.images?.[0]?.src ?? null,
          },
          create: {
            shopifyProductId: String(product.id),
            title:            product.title,
            status:           product.status?.toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED',
            vendor:           product.vendor,
            productType:      product.product_type,
            tags:             product.tags?.split(', ').filter(Boolean) ?? [],
            imageUrl:         product.images?.[0]?.src ?? null,
          },
        })
        break
      }

      default:
        logger.info('Unhandled Shopify webhook topic', { topic, shop })
    }

    // Mark processed
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    })

    return NextResponse.json({ received: true })
  } catch (err) {
    const message = String(err)
    logger.error('Shopify webhook processing failed', { topic, shop, error: message })

    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'FAILED', errorMessage: message },
    })

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
