/**
 * NovaMember — Checkout API
 *
 * Starts a real, PCI-compliant subscription checkout:
 *  1. Validate + create the NovaMember member account (with CPRA consent records)
 *  2. Create a Shopify customer via Admin API (best-effort, non-fatal)
 *  3. Return a real Shopify hosted-checkout URL for the chosen plan's variant,
 *     with the Recharge selling plan attached
 *
 * Payment itself happens on Shopify's own checkout — never on this server.
 * Recharge listens to that checkout, creates its own customer + subscription,
 * and notifies us via the `subscription/activated` webhook
 * (see src/app/api/webhooks/recharge/route.ts), which is what actually marks
 * the member's subscription ACTIVE. Until that webhook fires, this member
 * has an account but no subscription — there is no fake "subscription active"
 * response returned from here, because nothing has been paid for yet.
 *
 * POST /api/checkout
 * Body: CheckoutSchema
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, signToken } from '@/lib/auth'
import { createShopifyCustomer, buildSubscriptionCheckoutUrl } from '@/lib/shopify'
import { sendWelcomeEmail } from '@/lib/email'
import { logger } from '@/lib/logger'

// ── Validation schema ─────────────────────────────────────────────────────────
// Two ways to start a checkout:
//  - planId: one of NovaMember's own platform plans (Starter/Growth/Scale),
//    priced and mapped via PLAN_CONFIG below.
//  - productId (+ variantId): a specific item from the synced Shopify catalog
//    (/products), so the checkout actually reflects what the member clicked
//    "Subscribe" on instead of always defaulting to the Starter platform plan.
// Exactly one of the two must be present.
const CheckoutSchema = z.object({
  firstName:       z.string().min(1).max(100),
  lastName:        z.string().min(1).max(100),
  email:           z.string().email(),
  password:        z.string().min(8),
  company:         z.string().max(200).optional(),
  planId:          z.string().min(1).optional(),
  productId:       z.string().min(1).optional(),
  purchaseType:    z.enum(['subscription', 'one_time']).default('subscription'),
  cpraConsent:     z.literal(true, {
    errorMap: () => ({ message: 'CPRA consent is required to create an account' }),
  }),
  marketingConsent: z.boolean().default(false),
}).refine(data => !!data.planId !== !!data.productId, {
  message: 'Provide exactly one of planId (platform plan) or productId (catalog product)',
})

type CheckoutBody = z.infer<typeof CheckoutSchema>

// Plan → Shopify variant / Recharge selling plan mapping.
// The selling plan is created by Recharge's own Shopify app when you attach a
// subscription to a product — it is NOT something we can generate ourselves.
const PLAN_CONFIG: Record<string, {
  name: string
  price: number
  shopifyVariantId: string
  sellingPlanId?: string
}> = {
  starter: {
    name: 'Starter',
    price: 99,
    shopifyVariantId: process.env.SHOPIFY_VARIANT_STARTER ?? '',
    sellingPlanId: process.env.SHOPIFY_SELLING_PLAN_STARTER,
  },
  growth: {
    name: 'Growth',
    price: 299,
    shopifyVariantId: process.env.SHOPIFY_VARIANT_GROWTH ?? '',
    sellingPlanId: process.env.SHOPIFY_SELLING_PLAN_GROWTH,
  },
  scale: {
    name: 'Scale',
    price: 799,
    shopifyVariantId: process.env.SHOPIFY_VARIANT_SCALE ?? '',
    sellingPlanId: process.env.SHOPIFY_SELLING_PLAN_SCALE,
  },
}

const ONBOARDING_TASKS = [
  { taskKey: 'complete_profile',   title: 'Complete your profile',          sortOrder: 0, isRequired: true },
  { taskKey: 'connect_shopify',    title: 'Connect your Shopify store',     sortOrder: 1, isRequired: true },
  { taskKey: 'configure_recharge', title: 'Configure Recharge settings',    sortOrder: 2, isRequired: true },
  { taskKey: 'import_products',    title: 'Import your first products',     sortOrder: 3, isRequired: true },
  { taskKey: 'invite_team',        title: 'Invite a team member',           sortOrder: 4, isRequired: false },
  { taskKey: 'launch_subscription', title: 'Launch your first subscription', sortOrder: 5, isRequired: true },
  { taskKey: 'review_analytics',   title: 'Review your analytics dashboard', sortOrder: 6, isRequired: false },
]

export async function POST(req: NextRequest) {
  let body: CheckoutBody

  try {
    const raw = await req.json()
    body = CheckoutSchema.parse(raw)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 422 })
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Resolve what's actually being purchased — either a platform plan
  // (Starter/Growth/Scale) or a real catalog product from /products.
  let plan: { name: string; price: number; shopifyVariantId: string; sellingPlanId?: string }
  let checkoutSource: 'plan' | 'product'
  let checkoutPlanId: string

  if (body.productId) {
    const product = await db.product.findUnique({
      where: { id: body.productId },
      include: {
        variants: true,
        subscriptionPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    })
    const variant = product?.variants[0]
    // Only look at a subscription plan (and thus a Recharge selling plan) for
    // subscription purchases. A one-time purchase must NOT carry a selling
    // plan into the Shopify checkout URL — attaching one is what turns a
    // one-time cart line into a recurring subscription on Shopify's side,
    // which was the actual bug: both purchase types built an identical URL.
    const subPlan = body.purchaseType === 'subscription' ? product?.subscriptionPlans[0] : undefined

    if (!product || !variant) {
      return NextResponse.json({ error: `Unknown or unsynced product: ${body.productId}` }, { status: 400 })
    }

    plan = {
      name: product.title,
      price: Number(subPlan?.price ?? variant.price),
      shopifyVariantId: variant.shopifyVariantId,
      sellingPlanId: subPlan?.rechargeId ?? undefined,
    }
    checkoutSource = 'product'
    checkoutPlanId = product.id
  } else {
    const platformPlan = PLAN_CONFIG[body.planId!]
    if (!platformPlan) {
      return NextResponse.json({ error: `Unknown plan: ${body.planId}` }, { status: 400 })
    }
    plan = platformPlan
    checkoutSource = 'plan'
    checkoutPlanId = body.planId!
  }

  if (!plan.shopifyVariantId) {
    logger.error('Checkout attempted with no Shopify variant configured', { checkoutSource, checkoutPlanId })
    return NextResponse.json(
      { error: 'This item is not connected to a live Shopify variant yet.' },
      { status: 503 },
    )
  }

  // ── Check for existing account ────────────────────────────────────────────
  const existing = await db.member.findUnique({ where: { email: body.email } })
  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists. Please log in instead.' },
      { status: 409 },
    )
  }

  // ── Create Shopify customer (best-effort — checkout works without it) ────
  let shopifyCustomerId: string | undefined
  const shopDomain = process.env.SHOPIFY_STORE_DOMAIN
  const shopToken  = process.env.SHOPIFY_STORE_ACCESS_TOKEN

  if (shopDomain && shopToken) {
    try {
      const shopifyCustomer = await createShopifyCustomer(shopDomain, shopToken, {
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
      })
      shopifyCustomerId = String(shopifyCustomer.id)
      logger.info('Shopify customer created', { shopifyCustomerId })
    } catch (err) {
      // Non-fatal: Shopify's own checkout will create/match the customer by
      // email anyway if this call fails.
      logger.error('Failed to pre-create Shopify customer', { error: String(err), email: body.email })
    }
  } else {
    logger.warn('SHOPIFY_STORE_DOMAIN or SHOPIFY_STORE_ACCESS_TOKEN not set — skipping Shopify customer pre-create')
  }

  // ── Create the NovaMember account (no subscription yet — nothing paid for) ─
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? undefined
  const userAgent = req.headers.get('user-agent') ?? undefined

  const member = await db.$transaction(async (tx) => {
    const newMember = await tx.member.create({
      data: {
        email:             body.email,
        passwordHash:      await hashPassword(body.password),
        firstName:         body.firstName,
        lastName:          body.lastName,
        shopifyCustomerId: shopifyCustomerId ?? null,
        role:              'MEMBER',
        status:            'ACTIVE', // account is active; subscription activates separately via webhook
      },
    })

    await tx.consentRecord.createMany({
      data: [
        {
          memberId:    newMember.id,
          consentType: 'data_processing',
          granted:     true,
          ipAddress:   ip,
          userAgent:   userAgent,
          version:     '2024-01',
        },
        {
          memberId:    newMember.id,
          consentType: 'marketing',
          granted:     body.marketingConsent,
          ipAddress:   ip,
          userAgent:   userAgent,
          version:     '2024-01',
        },
      ],
    })

    await tx.onboardingTask.createMany({
      data: ONBOARDING_TASKS.map(t => ({
        memberId: newMember.id,
        ...t,
        description: null,
      })),
    })

    await tx.activityEvent.create({
      data: {
        memberId:  newMember.id,
        eventType: 'member.signup',
        source:    'checkout',
        ipAddress: ip,
        userAgent: userAgent,
        properties: {
          plan:          checkoutPlanId,
          checkoutSource,
          purchaseType:  checkoutSource === 'product' ? body.purchaseType : 'subscription',
          company:       body.company ?? null,
          shopifyLinked: !!shopifyCustomerId,
        },
      },
    })

    return newMember
  })

  const token = signToken({ sub: member.id, email: member.email, role: member.role })

  sendWelcomeEmail({
    to:        member.email,
    firstName: member.firstName,
    planName:  plan.name,
  }).catch(err => logger.error('Failed to send welcome email', { error: String(err), memberId: member.id }))

  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const checkoutUrl = buildSubscriptionCheckoutUrl({
    shop:          shopDomain ?? '',
    variantId:     plan.shopifyVariantId,
    sellingPlanId: plan.sellingPlanId,
    email:         body.email,
    memberId:      member.id,
    returnTo:      `${appUrl}/dashboard?checkout=complete`,
  })

  logger.info('Checkout started — redirecting to Shopify hosted checkout', {
    memberId: member.id,
    checkoutSource,
    checkoutPlanId,
    purchaseType: checkoutSource === 'product' ? body.purchaseType : 'subscription',
    hasSellingPlan: !!plan.sellingPlanId,
    shopifyCustomerId,
  })

  return NextResponse.json({
    token,
    member: {
      id:        member.id,
      email:     member.email,
      firstName: member.firstName,
      lastName:  member.lastName,
      role:      member.role,
    },
    plan: {
      id: checkoutPlanId,
      name: plan.name,
      price: plan.price,
      purchaseType: checkoutSource === 'product' ? body.purchaseType : 'subscription',
    },
    checkoutUrl,
    subscriptionActive: false, // becomes true only after the Recharge webhook confirms payment
  }, { status: 201 })
}
