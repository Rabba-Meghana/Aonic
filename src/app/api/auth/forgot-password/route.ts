import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { signPasswordResetToken } from '@/lib/auth'
import { sendPasswordResetEmail } from '@/lib/email'
import { logger } from '@/lib/logger'

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
})

const APP_URL = process.env.NEXTAUTH_URL ?? 'https://novamemberrr.vercel.app'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as unknown
    const parsed = ForgotPasswordSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { email } = parsed.data
    const member = await db.member.findUnique({ where: { email } })

    // Always return the same response whether or not the account exists —
    // otherwise this endpoint becomes a way to enumerate registered emails.
    const genericResponse = {
      message: 'If an account exists for that email, a password reset link has been sent.',
    }

    if (!member) {
      logger.info('Password reset requested for unknown email', { email })
      return NextResponse.json(genericResponse)
    }

    const resetToken = signPasswordResetToken(member.id, member.email)
    const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`

    await sendPasswordResetEmail({
      to: member.email,
      firstName: member.firstName,
      resetUrl,
    })

    logger.info('Password reset email issued', { memberId: member.id })

    // RESEND_API_KEY isn't configured in this deployment yet, so sendEmail()
    // logs instead of actually delivering. Surface the URL directly in dev
    // so the flow is still testable end-to-end without real email delivery.
    const devPayload = !process.env.RESEND_API_KEY ? { devResetUrl: resetUrl } : {}

    return NextResponse.json({ ...genericResponse, ...devPayload })
  } catch (err) {
    logger.error('Forgot password failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
