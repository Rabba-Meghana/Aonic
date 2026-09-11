import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, signToken, RegisterSchema } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as unknown
    const parsed = RegisterSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { email, password, firstName, lastName, cpraConsent, marketingConsent } = parsed.data

    // Check existing member
    const existing = await db.member.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409 },
      )
    }

    const passwordHash = await hashPassword(password)

    // Create member + onboarding tasks + CPRA consent record atomically
    const member = await db.$transaction(async (tx) => {
      const m = await tx.member.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
        },
      })

      // Create default onboarding tasks
      const defaultTasks = [
        { taskKey: 'complete_profile', title: 'Complete your profile', description: 'Add company details and a profile photo', isRequired: true, sortOrder: 1 },
        { taskKey: 'connect_shopify', title: 'Connect your Shopify store', description: 'Authorize NovaMember to sync products and orders', isRequired: true, sortOrder: 2 },
        { taskKey: 'configure_recharge', title: 'Set up Recharge subscriptions', description: 'Configure billing cycles and subscription rules', isRequired: true, sortOrder: 3 },
        { taskKey: 'setup_cpra', title: 'Review CPRA settings', description: 'Configure consent management and data deletion workflows', isRequired: true, sortOrder: 4 },
        { taskKey: 'add_products', title: 'Add your first products', description: 'Import or create products for your subscription boxes', isRequired: true, sortOrder: 5 },
        { taskKey: 'invite_team', title: 'Invite your team', description: 'Add teammates so they can access the dashboard', isRequired: false, sortOrder: 6 },
        { taskKey: 'launch_campaign', title: 'Launch your first campaign', description: 'Send a welcome email to your member list', isRequired: false, sortOrder: 7 },
      ]

      await tx.onboardingTask.createMany({
        data: defaultTasks.map(t => ({ ...t, memberId: m.id })),
      })

      // Record CPRA consent
      await tx.consentRecord.createMany({
        data: [
          {
            memberId: m.id,
            consentType: 'data_processing',
            granted: cpraConsent,
            version: '2025-01',
            ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? undefined,
            userAgent: request.headers.get('user-agent') ?? undefined,
          },
          {
            memberId: m.id,
            consentType: 'marketing',
            granted: marketingConsent ?? false,
            version: '2025-01',
          },
        ],
      })

      // Log signup event
      await tx.activityEvent.create({
        data: {
          memberId: m.id,
          eventType: 'signup',
          source: 'web',
          properties: { email, cpraConsent },
        },
      })

      return m
    })

    const token = signToken({ sub: member.id, email: member.email, role: member.role })

    logger.info('Member registered', { memberId: member.id, email })

    return NextResponse.json({
      token,
      member: {
        id: member.id,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
      },
    }, { status: 201 })
  } catch (err) {
    logger.error('Registration failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
