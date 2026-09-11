import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, signToken, LoginSchema } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as unknown
    const parsed = LoginSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { email, password } = parsed.data

    const member = await db.member.findUnique({ where: { email } })

    // Constant-time comparison (prevent timing attacks)
    const passwordValid = member
      ? await verifyPassword(password, member.passwordHash)
      : await verifyPassword(password, '$2b$12$invalidhashtopreventtimingattack')

    if (!member || !passwordValid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (member.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Account is not active' }, { status: 403 })
    }

    // Log login event
    await db.activityEvent.create({
      data: {
        memberId: member.id,
        eventType: 'login',
        source: 'web',
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    }).catch(() => {}) // Non-critical

    const token = signToken({ sub: member.id, email: member.email, role: member.role })

    logger.info('Member logged in', { memberId: member.id })

    return NextResponse.json({
      token,
      member: {
        id: member.id,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
        engagementScore: member.engagementScore,
        engagementTier: member.engagementTier,
      },
    })
  } catch (err) {
    logger.error('Login failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
