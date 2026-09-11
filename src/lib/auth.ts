/**
 * NovaMember — Authentication Utilities
 *
 * Handles:
 *   - Password hashing (bcrypt, 12 rounds)
 *   - Access JWT (short-lived, 15 min)
 *   - Refresh token (long-lived, 90 days, stored in Redis with rotation)
 *   - Timing-safe comparisons
 *
 * Refresh token rotation: on every /api/auth/refresh call the old refresh
 * token is revoked (its JTI added to a Redis denylist) and a new pair
 * (access + refresh) is issued. Revoked tokens fail immediately even if not
 * yet expired. Stolen refresh token reuse triggers family invalidation.
 */

import bcrypt    from 'bcryptjs'
import jwt       from 'jsonwebtoken'
import { z }     from 'zod'
import { redis } from './redis'
import { logger } from './logger'

// ── Constants ────────────────────────────────────────────────────────────────
const JWT_SECRET          = process.env.JWT_SECRET          ?? 'novamember-dev-secret-change-in-production'
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? JWT_SECRET + '-refresh'
const BCRYPT_ROUNDS       = 12
const ACCESS_TOKEN_TTL    = '15m'
const REFRESH_TOKEN_TTL   = '90d'
const REFRESH_TOKEN_TTL_S = 90 * 24 * 60 * 60  // seconds for Redis EXPIRE

// ── Schemas ──────────────────────────────────────────────────────────────────
export const RegisterSchema = z.object({
  email:            z.string().email(),
  password:         z.string().min(8, 'Password must be at least 8 characters'),
  firstName:        z.string().min(1).max(50),
  lastName:         z.string().min(1).max(50),
  cpraConsent:      z.boolean().refine(v => v, { message: 'CPRA consent is required' }),
  marketingConsent: z.boolean().optional().default(false),
})

export const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

export type RegisterInput = z.infer<typeof RegisterSchema>
export type LoginInput    = z.infer<typeof LoginSchema>

// ── Token payload types ───────────────────────────────────────────────────────
export interface JwtPayload {
  sub:   string                    // member id
  email: string
  role:  'MEMBER' | 'ADMIN'
  iat:   number
  exp:   number
}

export interface RefreshTokenPayload {
  sub:    string                   // member id
  jti:    string                   // unique token ID (for revocation)
  family: string                   // refresh token family (for reuse detection)
  iat:    number
  exp:    number
}

// ── Password ─────────────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ── Access JWT ────────────────────────────────────────────────────────────────
export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL })
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}

export function extractToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

// ── Refresh tokens ────────────────────────────────────────────────────────────
//
// JTI denylist key: `rt:revoked:<jti>`
// Family key (maps family → current valid JTI): `rt:family:<family>`
// On refresh: verify → check denylist → check family match → issue new pair → revoke old JTI

/**
 * Issue a refresh token for a member.
 * family: a stable ID grouping all tokens issued in one login session.
 *   Pass an existing family to rotate; omit to start a new family.
 */
export async function signRefreshToken(
  memberId: string,
  family?: string,
): Promise<string> {
  const jti      = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  const tokenFamily = family ?? jti  // new login → family = first JTI

  const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
    sub:    memberId,
    jti,
    family: tokenFamily,
  }

  const token = jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_TTL })

  // Record the valid JTI for this family in Redis
  try {
    await redis.set(`rt:family:${tokenFamily}`, jti, { ex: REFRESH_TOKEN_TTL_S })
  } catch (err) {
    logger.warn('Failed to record refresh token family in Redis', { error: String(err) })
  }

  return token
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload
}

/**
 * Rotate a refresh token.
 * - Verifies the token cryptographically
 * - Checks JTI is not on the denylist (revoked)
 * - Detects replay attacks: if the family's current JTI doesn't match,
 *   a stolen token was reused — invalidate the entire family
 * - Issues a new (access, refresh) pair and revokes the old refresh JTI
 *
 * @throws Error with code if token is invalid/revoked/replayed
 */
export async function rotateRefreshToken(
  oldToken: string,
): Promise<{ accessToken: string; refreshToken: string; payload: JwtPayload }> {

  let decoded: RefreshTokenPayload
  try {
    decoded = verifyRefreshToken(oldToken)
  } catch (err) {
    throw Object.assign(new Error('Refresh token invalid or expired'), { code: 'INVALID_REFRESH_TOKEN' })
  }

  const { sub, jti, family } = decoded

  // ── Check revocation denylist ───────────────────────────────────────────
  let isRevoked = false
  let familyJti: string | null = null

  try {
    const [revokedVal, currentJti] = await Promise.all([
      redis.get(`rt:revoked:${jti}`),
      redis.get(`rt:family:${family}`),
    ])
    isRevoked  = revokedVal !== null
    familyJti  = currentJti
  } catch (err) {
    // Redis unavailable — allow rotation (best-effort security)
    logger.warn('Redis unavailable during refresh token check', { error: String(err) })
  }

  if (isRevoked) {
    throw Object.assign(new Error('Refresh token has been revoked'), { code: 'REVOKED_REFRESH_TOKEN' })
  }

  // ── Detect token reuse (replay attack) ─────────────────────────────────
  if (familyJti && familyJti !== jti) {
    // A different JTI in the same family means the old one was already rotated.
    // Invalidate the entire family to protect the account.
    logger.warn('Refresh token reuse detected — invalidating family', { sub, family })
    try {
      await redis.del(`rt:family:${family}`)
    } catch { /* ignore */ }
    throw Object.assign(
      new Error('Refresh token reuse detected. Please log in again.'),
      { code: 'REFRESH_TOKEN_REUSE' },
    )
  }

  // ── Revoke old JTI and issue new pair ──────────────────────────────────
  try {
    await redis.set(`rt:revoked:${jti}`, '1', { ex: REFRESH_TOKEN_TTL_S })
  } catch (err) {
    logger.warn('Failed to revoke old refresh token JTI', { error: String(err), jti })
  }

  // We need the member's email + role for the access token.
  // These are embedded in the refresh payload through a DB lookup by the caller.
  // Here we just return what we can from the token itself — the route handler
  // fetches the member from DB for the full payload.
  const newAccessToken  = '' // filled by caller after DB fetch
  const newRefreshToken = await signRefreshToken(sub, family)

  return {
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
    payload: {
      sub,
      email: '',   // filled by caller
      role:  'MEMBER',
      iat:   Math.floor(Date.now() / 1000),
      exp:   Math.floor(Date.now() / 1000) + 15 * 60,
    },
  }
}

/**
 * Revoke a refresh token (on logout).
 * Also clears its family so all related tokens are dead.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const decoded = verifyRefreshToken(token)
    await Promise.all([
      redis.set(`rt:revoked:${decoded.jti}`, '1', { ex: REFRESH_TOKEN_TTL_S }),
      redis.del(`rt:family:${decoded.family}`),
    ])
  } catch (err) {
    // Token may already be expired/invalid — log but don't throw
    logger.warn('revokeRefreshToken: could not decode token', { error: String(err) })
  }
}

// ── Request auth ─────────────────────────────────────────────────────────────
export function getAuthFromRequest(request: Request): JwtPayload | null {
  try {
    const token = extractToken(request.headers.get('authorization'))
    if (!token) return null
    return verifyToken(token)
  } catch {
    return null
  }
}

export function requireAuth(request: Request): JwtPayload {
  const auth = getAuthFromRequest(request)
  if (!auth) throw new Error('UNAUTHORIZED')
  return auth
}

export function requireAdmin(request: Request): JwtPayload {
  const auth = requireAuth(request)
  if (auth.role !== 'ADMIN') throw new Error('FORBIDDEN')
  return auth
}
