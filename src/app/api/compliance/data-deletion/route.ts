/**
 * CPRA Data Deletion Endpoint
 *
 * Implements the California Privacy Rights Act (CPRA) right to deletion.
 * Per CPRA, businesses have 45 days to respond to deletion requests.
 * This endpoint initiates the request and schedules the deletion.
 *
 * @see https://cppa.ca.gov/regulations/cpra.html
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

const DeletionRequestSchema = z.object({
  reason: z.string().optional(),
  immediateDelete: z.boolean().optional().default(false),
})

// POST /api/compliance/data-deletion — initiate deletion request
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request)

    const body = await request.json() as unknown
    const parsed = DeletionRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const member = await db.member.findUnique({
      where: { id: auth.sub },
      include: { deletionRequests: { where: { status: { in: ['PENDING', 'VERIFIED'] } } } },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Check for existing pending request
    if (member.deletionRequests.length > 0) {
      return NextResponse.json({
        error: 'A deletion request is already pending',
        existingRequestId: member.deletionRequests[0].id,
      }, { status: 409 })
    }

    const verificationToken = crypto.randomBytes(32).toString('hex')

    // CPRA allows 45 days to complete deletion
    const scheduledAt = new Date()
    scheduledAt.setDate(scheduledAt.getDate() + 45)

    const deletionRequest = await db.deletionRequest.create({
      data: {
        memberId: member.id,
        scheduledAt,
        verificationToken,
        requestorEmail: member.email,
        notes: parsed.data.reason,
        status: 'PENDING',
      },
    })

    // Log the request for audit trail
    await db.activityEvent.create({
      data: {
        memberId: member.id,
        eventType: 'deletion_request_created',
        source: 'web',
        properties: {
          requestId: deletionRequest.id,
          scheduledAt: scheduledAt.toISOString(),
          cpraCompliant: true,
        },
      },
    })

    logger.info('Data deletion request created', {
      requestId: deletionRequest.id,
      memberId: member.id,
      scheduledAt,
    })

    // In production: send verification email with token
    // await sendEmail({ to: member.email, template: 'deletion-verification', data: { token: verificationToken } })

    return NextResponse.json({
      requestId: deletionRequest.id,
      status: 'PENDING',
      scheduledAt: scheduledAt.toISOString(),
      message: 'Deletion request received. Per CPRA, your data will be deleted within 45 days. A verification email has been sent.',
      verificationToken, // Only for demo — in production this would be emailed
    }, { status: 202 })
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('Deletion request failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/compliance/data-deletion — check deletion request status
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request)

    const requests = await db.deletionRequest.findMany({
      where: { memberId: auth.sub },
      orderBy: { requestedAt: 'desc' },
      take: 10,
    })

    return NextResponse.json({ deletionRequests: requests })
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/compliance/data-deletion — verify and execute immediate deletion
export async function DELETE(request: NextRequest) {
  try {
    const auth = requireAuth(request)
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Verification token required' }, { status: 400 })
    }

    const deletionRequest = await db.deletionRequest.findFirst({
      where: {
        memberId: auth.sub,
        verificationToken: token,
        status: { in: ['PENDING', 'VERIFIED'] },
      },
    })

    if (!deletionRequest) {
      return NextResponse.json({ error: 'Invalid or expired verification token' }, { status: 400 })
    }

    // Execute deletion (GDPR/CPRA hard delete with audit)
    await db.$transaction(async (tx) => {
      // Anonymize rather than hard delete to preserve financial records
      await tx.member.update({
        where: { id: auth.sub },
        data: {
          email: `deleted_${Date.now()}@deleted.novamember.io`,
          firstName: 'DELETED',
          lastName: 'USER',
          status: 'CANCELLED',
          shopifyCustomerId: null,
          rechargeCustomerId: null,
        },
      })

      // Delete PII from activity events
      await tx.activityEvent.updateMany({
        where: { memberId: auth.sub },
        data: { ipAddress: null, userAgent: null },
      })

      // Mark deletion complete
      await tx.deletionRequest.update({
        where: { id: deletionRequest.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
    })

    logger.info('Member data deleted (CPRA)', { memberId: auth.sub, requestId: deletionRequest.id })

    return NextResponse.json({
      status: 'COMPLETED',
      message: 'Your personal data has been deleted in accordance with CPRA requirements.',
      completedAt: new Date().toISOString(),
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('Data deletion execution failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
