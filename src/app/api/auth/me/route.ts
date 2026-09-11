/**
 * NovaMember — Current Member Profile
 *
 * GET /api/auth/me
 * Authorization: Bearer <token>
 *
 * Returns the authenticated member's own profile. Used by the dashboard so
 * it shows the real signed-in member instead of a hardcoded demo record.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request)

    const member = await db.member.findUnique({
      where: { id: auth.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        shopifyCustomerId: true,
        rechargeCustomerId: true,
        engagementScore: true,
        engagementTier: true,
        createdAt: true,
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    return NextResponse.json({ member })
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('GET /api/auth/me failed', { error: String(err) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
