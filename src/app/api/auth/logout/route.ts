/**
 * NovaMember — Logout
 *
 * POST /api/auth/logout
 *
 * Revokes the presented refresh token (and its entire family) in Redis.
 * The access token remains technically valid until it expires (15 min),
 * which is the standard JWT trade-off. Clients must discard it immediately.
 *
 * Idempotent: logging out with an already-expired/invalid token returns 200.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { revokeRefreshToken } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { withErrorHandler } from '@/lib/errors'

const LogoutSchema = z.object({
  refreshToken: z.string().optional(),
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  let refreshToken: string | undefined

  try {
    const body   = await req.json()
    const parsed = LogoutSchema.parse(body)
    refreshToken = parsed.refreshToken
  } catch {
    // Ignore parse errors — logout is always "successful" from the client's perspective
  }

  if (refreshToken) {
    try {
      await revokeRefreshToken(refreshToken)
    } catch (err) {
      // Non-fatal: token may already be expired
      logger.warn('Logout: could not revoke refresh token', { error: String(err) })
    }
  }

  const requestId = req.headers.get('x-request-id') ?? 'unknown'
  logger.info('Logout', { requestId })

  return NextResponse.json({ success: true, message: 'Logged out successfully' })
})
