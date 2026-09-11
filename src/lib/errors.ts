/**
 * NovaMember — Typed Error Hierarchy
 *
 * Every error thrown inside a route handler is one of these.
 * Route handlers catch AppError and return the correct HTTP status
 * without needing ad-hoc status code logic scattered through the code.
 *
 * Usage:
 *   throw new NotFoundError('Subscription not found')
 *   throw new ValidationError('Invalid plan ID', { planId: 'unknown' })
 *   throw new ExternalServiceError('Recharge', 'subscription creation failed')
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'PAYMENT_REQUIRED'
  | 'INTERNAL_ERROR'

export class AppError extends Error {
  readonly statusCode: number
  readonly code:       ErrorCode
  readonly details?:   unknown
  readonly isOperational: boolean   // false = programmer error (5xx), true = user error (4xx)

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    details?: unknown,
    isOperational = true,
  ) {
    super(message)
    this.name         = this.constructor.name
    this.statusCode   = statusCode
    this.code         = code
    this.details      = details
    this.isOperational = isOperational
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON() {
    return {
      error:   this.message,
      code:    this.code,
      details: this.details,
    }
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details)
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN')
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND')
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT')
  }
}

export class RateLimitError extends AppError {
  readonly retryAfter: number

  constructor(retryAfter: number) {
    super('Too many requests. Please slow down.', 429, 'RATE_LIMITED', { retryAfter })
    this.retryAfter = retryAfter
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, detail: string) {
    super(
      `${service} service error: ${detail}`,
      502,
      'EXTERNAL_SERVICE_ERROR',
      { service },
      false,
    )
  }
}

export class PaymentError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 402, 'PAYMENT_REQUIRED', details)
  }
}

// ── Error handler for route handlers ─────────────────────────────────────────
import { NextResponse } from 'next/server'
import { logger } from './logger'

/**
 * Wraps a route handler so any thrown AppError is converted to
 * the correct JSON response automatically.
 *
 * @example
 * export const POST = withErrorHandler(async (req) => {
 *   const member = await db.member.findUnique(...)
 *   if (!member) throw new NotFoundError('Member')
 *   return NextResponse.json({ member })
 * })
 */
export function withErrorHandler<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
): (...args: T) => Promise<NextResponse> {
  return async (...args: T): Promise<NextResponse> => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof AppError) {
        if (!err.isOperational) {
          logger.error('Non-operational error', {
            code:    err.code,
            message: err.message,
            stack:   err.stack,
          })
        }

        const headers: Record<string, string> = {}
        if (err instanceof RateLimitError) {
          headers['Retry-After'] = String(err.retryAfter)
        }

        return NextResponse.json(err.toJSON(), {
          status:  err.statusCode,
          headers,
        })
      }

      // Unexpected programmer error
      logger.error('Unhandled route error', {
        message: err instanceof Error ? err.message : String(err),
        stack:   err instanceof Error ? err.stack : undefined,
      })

      return NextResponse.json(
        { error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' },
        { status: 500 },
      )
    }
  }
}
