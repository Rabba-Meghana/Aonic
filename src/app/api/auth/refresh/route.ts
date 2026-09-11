/**
 * NovaMember — Refresh Token Rotation
 *
 * POST /api/auth/refresh
 *
 * Exchanges a valid refresh token for a fresh (access, refresh) pair.
 * The old refresh token is immediately revoked (added to Redis denylist).
 * Replay detection: if a refresh token from an expired rotation is presented,
 * the entire token family is invalidated and the user must log in again.
 *
 * Flow:
 *   Client sends refresh token → we verify + rotate → return new pair
 *   Client stores new refresh token (httpOnly cookie or secure storage)
 *   Access token (15 min) is kept in memory only — never persisted client-side
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { signToken, verifyRefreshToken, revokeRefreshToken, signRefreshToken } from '@/lib/auth'
import { redis } from '@/lib/redis'
import { logger } from '@/lib/logger'
import { withErrorHandler, AuthError, ValidationError, AppError } from '@/lib/errors'

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  let refreshToken: string

  try {
    const body = await req.json()
    const parsed = RefreshSchema.parse(body)
    refreshToken = parsed.refreshToken
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ValidationError('refreshToken is required', err.issues)
    }
    throw new ValidationError('Invalid request body')
  }

  // ── Verify the refresh token cryptographically ──────────────────────────
  let decoded: ReturnType<typeof verifyRefreshToken>
  try {
    decoded = verifyRefreshToken(refreshToken)
  } catch {
    throw new AuthError('Refresh token is invalid or expired. Please log in again.')
  }

  const { sub: memberId, jti, family } = decoded

  // ── Check Redis denylist ────────────────────────────────────────────────
  let isRevoked   = false
  let familyJti: string | null = null

  try {
    const [revokedVal, currentJti] = await Promise.all([
      redis.get(`rt:revoked:${jti}`),
      redis.get(`rt:family:${family}`),
    ])
    isRevoked = revokedVal !== null
    familyJti = currentJti
  } catch (err) {
    // Redis unavailable — continue with cryptographic validation only
    logger.warn('Redis unavailable during token refresh', {
      error: String(err),
      memberId,
    })
  }

  if (isRevoked) {
    logger.warn('Revoked refresh token presented', { memberId, jti })
    throw new AuthError('Refresh token has been revoked. Please log in again.')
  }

  // ── Replay / theft detection ────────────────────────────────────────────
  if (familyJti !== null && familyJti !== jti) {
    // Token reuse: someone presented an already-rotated token.
    // This means either: (a) client bug re-sending old token, or (b) token theft.
    // Invalidate the entire family to protect the account in case of (b).
    logger.warn('Refresh token reuse detected — invalidating family', {
      memberId,
      family,
      presentedJti: jti,
      currentJti:   familyJti,
    })

    try {
      await Promise.all([
        redis.del(`rt:family:${family}`),
        redis.set(`rt:revoked:${familyJti}`, '1', { ex: 90 * 24 * 60 * 60 }),
      ])
    } catch { /* log already written */ }

    throw new AuthError(
      'Token reuse detected — your session has been invalidated for security. Please log in again.',
    )
  }

  // ── Fetch member from DB ────────────────────────────────────────────────
  const member = await db.member.findUnique({
    where: { id: memberId },
    select: { id: true, email: true, role: true, status: true },
  })

  if (!member || member.status !== 'ACTIVE') {
    // Account deleted or suspended — revoke family silently
    try { await redis.del(`rt:family:${family}`) } catch { /* ignore */ }
    throw new AuthError('Account not found or inactive. Please log in again.')
  }

  // ── Revoke old JTI ──────────────────────────────────────────────────────
  try {
    await redis.set(`rt:revoked:${jti}`, '1', { ex: 90 * 24 * 60 * 60 })
  } catch (err) {
    logger.warn('Failed to revoke old refresh token JTI', { error: String(err), jti })
    // Continue — the new token is still valid; revocation is best-effort
  }

  // ── Issue new pair ──────────────────────────────────────────────────────
  const accessToken  = signToken({ sub: member.id, email: member.email, role: member.role })
  const newRefreshToken = await signRefreshToken(member.id, family)

  logger.info('Refresh token rotated', { memberId: member.id })

  return NextResponse.json(
    {
      token:        accessToken,
      refreshToken: newRefreshToken,
      expiresIn:    15 * 60,          // seconds
      tokenType:    'Bearer',
    },
    { status: 200 },
  )
})
