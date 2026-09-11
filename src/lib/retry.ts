/**
 * NovaMember — Retry Utility
 *
 * Exponential backoff with jitter for external API calls.
 * Retries on network errors and 429/5xx responses.
 * Never retries on 4xx (client errors) — those are caller mistakes.
 */

import { logger } from './logger'

export interface RetryOptions {
  maxAttempts?: number       // default 3
  baseDelayMs?: number       // default 500ms
  maxDelayMs?:  number       // default 10_000ms
  onRetry?:     (attempt: number, error: Error, delayMs: number) => void
}

/**
 * Wraps an async operation with exponential backoff retry.
 *
 * @example
 * const data = await withRetry(() => rechargeRequest('/subscriptions'), {
 *   maxAttempts: 3,
 *   onRetry: (attempt, err) => logger.warn('Retrying Recharge', { attempt, error: err.message }),
 * })
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs  = 10_000,
    onRetry,
  } = options

  let lastError: Error = new Error('No attempts made')

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Don't retry client errors — they won't self-heal
      if (isClientError(lastError)) throw lastError

      if (attempt === maxAttempts) break

      // Exponential backoff with ±25% jitter
      const exponential = baseDelayMs * Math.pow(2, attempt - 1)
      const jitter       = exponential * 0.25 * (Math.random() * 2 - 1)
      const delayMs      = Math.min(exponential + jitter, maxDelayMs)

      onRetry?.(attempt, lastError, delayMs)
      logger.warn('Retrying after error', {
        attempt,
        maxAttempts,
        delayMs: Math.round(delayMs),
        error: lastError.message,
      })

      await sleep(delayMs)
    }
  }

  throw lastError
}

function isClientError(err: Error): boolean {
  // HTTP 4xx errors are client errors — retrying won't help
  return /\b4[0-9]{2}\b/.test(err.message) && !/\b429\b/.test(err.message)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Idempotency key generator.
 * Combines a namespace with content-derived hash so the same logical
 * operation always produces the same key, preventing duplicate charges.
 *
 * @example
 * const key = idempotencyKey('recharge-sub', memberId, planId)
 * // → "recharge-sub:a3f2c1..." (stable across retries)
 */
export function idempotencyKey(...parts: string[]): string {
  const crypto = require('crypto') as typeof import('crypto')
  const hash = crypto
    .createHash('sha256')
    .update(parts.join(':'))
    .digest('hex')
    .slice(0, 32)
  return `${parts[0]}:${hash}`
}
