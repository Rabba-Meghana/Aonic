import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

// GET /api/onboarding — fetch member's onboarding status
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request)

    const tasks = await db.onboardingTask.findMany({
      where: { memberId: auth.sub },
      orderBy: { sortOrder: 'asc' },
    })

    const completed = tasks.filter(t => t.completedAt)
    const required = tasks.filter(t => t.isRequired)
    const completedRequired = required.filter(t => t.completedAt)

    return NextResponse.json({
      tasks,
      summary: {
        total: tasks.length,
        completed: completed.length,
        required: required.length,
        completedRequired: completedRequired.length,
        completionPct: tasks.length > 0
          ? Math.round((completed.length / tasks.length) * 100)
          : 0,
        isFullyOnboarded: completedRequired.length === required.length,
      },
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const CompleteTaskSchema = z.object({
  taskKey: z.string(),
  metadata: z.record(z.unknown()).optional(),
})

// PATCH /api/onboarding — complete a task
export async function PATCH(request: NextRequest) {
  try {
    const auth = requireAuth(request)

    const body = await request.json() as unknown
    const parsed = CompleteTaskSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
    }

    const { taskKey, metadata } = parsed.data

    const task = await db.onboardingTask.findUnique({
      where: { memberId_taskKey: { memberId: auth.sub, taskKey } },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.completedAt) {
      return NextResponse.json({ message: 'Task already completed', task })
    }

    const updated = await db.onboardingTask.update({
      where: { id: task.id },
      data: {
        completedAt: new Date(),
        metadata: (metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
    })

    // Log completion
    await db.activityEvent.create({
      data: {
        memberId: auth.sub,
        eventType: 'onboarding_task_completed',
        source: 'web',
        properties: { taskKey, completedAt: updated.completedAt },
      },
    })

    // Check if fully onboarded
    const allRequired = await db.onboardingTask.findMany({
      where: { memberId: auth.sub, isRequired: true },
    })

    const allDone = allRequired.every(t => t.id === task.id || t.completedAt)

    if (allDone) {
      await db.member.update({
        where: { id: auth.sub },
        data: { onboardingCompletedAt: new Date() },
      })
      logger.info('Member fully onboarded', { memberId: auth.sub })
    }

    logger.info('Onboarding task completed', { memberId: auth.sub, taskKey })

    return NextResponse.json({ task: updated, fullyOnboarded: allDone })
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('Task completion failed', { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
