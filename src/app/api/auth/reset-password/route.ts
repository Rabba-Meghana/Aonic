import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPasswordResetToken, hashPassword } from '@/lib/auth'
import { logger } from '@/lib/logger'

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as unknown
    const parsed = ResetPasswordSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { token, password } = parsed.data

    let payload
    try {
      payload = verifyPasswordResetToken(token)
    } catch {
      return NextResponse.json(
        { error: 'This reset link is invalid or has expired. Please request a new one.' },
        { status: 400 },
      )
    }

    const member = await db.member.findUnique({ where: { id: payload.sub } })
    if (!member || member.email !== payload.email) {
      return NextResponse.json(
        { error: 'This reset link is invalid or has expired. Please request a new one.' },
        { status: 400 },
      )
    }

    const passwordHash = await hashPassword(password)
    await db.member.update({
      where: { id: member.id },
      data: { passwordHash },
    })

    await db.activityEvent.create({
      data: {
        memberId: member.id,
        eventType: 'password_reset',
        source: 'web',
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    }).catch(() => {}) // Non-critical

    logger.info('Password reset completed', { memberId: member.id })

    return NextResponse.json({ message: 'Password updated. You can now sign in with your new password.' })
  } catch (err) {
    logger.error('Reset password failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
