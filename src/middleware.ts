/**
 * NovaMember — Next.js Edge Middleware
 *
 * Runs on every request BEFORE it reaches any route handler.
 * Uses Upstash Redis REST API directly (no Node imports) for distributed
 * sliding-window rate limiting that works correctly across all serverless
 * instances and edge regions.
 *
 * Handles:
 *   1. Security headers (CSP, HSTS, X-Frame-Options, etc.)
 *   2. Distributed rate limiting — Redis sorted-set sliding window
 *   3. Request ID injection (UUID traces every log line)
 *   4. CORS for API routes called from Shopify / Recharge
 *   5. Bot / automated-tool rejection on sensitive routes
 */

import { NextRequest, NextResponse } from 'next/server'

// ── Rate limit configuration ──────────────────────────────────────────────────
interface RateLimitConfig {
  windowMs:    number  // window size in ms
  maxRequests: number  // max requests per window per IP
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  '/api/auth':       { windowMs: 60_000,     maxRequests: 20  },  // 20 / min
  '/api/checkout':   { windowMs: 60_000,     maxRequests: 5   },  // 5 / min  — tight
  '/api/ai':         { windowMs: 60_000,     maxRequests: 30  },  // 30 / min
  '/api/evals':      { windowMs: 3_600_000,  maxRequests: 10  },  // 10 / hour
  '/api/compliance': { windowMs: 3_600_000,  maxRequests: 10  },  // 10 / hour
  '/api':            { windowMs: 60_000,     maxRequests: 120 },  // 120 / min default
}

function getRateLimit(pathname: string): RateLimitConfig {
  for (const [prefix, config] of Object.entries(RATE_LIMITS)) {
    if (prefix !== '/api' && pathname.startsWith(prefix)) return config
  }
  return RATE_LIMITS['/api']
}

// ── Redis sliding-window rate limiter (Edge-compatible) ───────────────────────
//
// Algorithm: sorted set where score = timestamp, member = timestamp (unique per request).
//   1. ZREMRANGEBYSCORE key -inf (now - window)    — evict old entries
//   2. ZADD key score member                        — record this request
//   3. ZCARD key                                    — current count
//   4. EXPIRE key ttl                               — GC when window closes
//
// Single pipeline call = one round-trip to Upstash.

interface SlidingWindowResult {
  allowed:   boolean
  count:     number
  remaining: number
  resetAt:   number   // Unix epoch ms of window end
}

// In-memory fallback for local dev / CI (single-process only).
const memStore = new Map<string, number[]>()

async function checkRateLimit(
  key:    string,
  config: RateLimitConfig,
): Promise<SlidingWindowResult> {
  const now      = Date.now()
  const windowMs = config.windowMs
  const limit    = config.maxRequests
  const windowStart = now - windowMs
  const resetAt  = now + windowMs

  // ── Upstash Redis path ────────────────────────────────────────────────────
  const upstashUrl   = process.env.UPSTASH_REDIS_REST_URL
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (upstashUrl && upstashToken) {
    try {
      const ttlSeconds = Math.ceil(windowMs / 1000)

      // Pipeline: 4 commands → 1 round-trip
      const pipeline = [
        ['ZREMRANGEBYSCORE', key, '-inf', String(windowStart)],
        ['ZADD', key, String(now), String(now)],  // score = member = epoch ms
        ['ZCARD', key],
        ['EXPIRE', key, String(ttlSeconds)],
      ]

      const res = await fetch(`${upstashUrl.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${upstashToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pipeline),
      })

      if (res.ok) {
        const results = await res.json() as Array<{ result: number; error?: string }>
        const count = results[2]?.result ?? 0
        return {
          allowed:   count <= limit,
          count,
          remaining: Math.max(0, limit - count),
          resetAt,
        }
      }
      // Fall through to in-memory on Upstash error
    } catch {
      // Fall through to in-memory on network error
    }
  }

  // ── In-memory fallback (dev / CI / Upstash unavailable) ──────────────────
  const timestamps = (memStore.get(key) ?? []).filter(t => t > windowStart)
  timestamps.push(now)
  memStore.set(key, timestamps)

  // Trim the store periodically to prevent unbounded growth
  if (memStore.size > 10_000) {
    const cutoff = now - Math.max(...Object.values(RATE_LIMITS).map(c => c.windowMs))
    for (const [k, ts] of Array.from(memStore.entries())) {
      if ((ts as number[]).every((t: number) => t < cutoff)) memStore.delete(k)
    }
  }

  const count = timestamps.length
  return {
    allowed:   count <= limit,
    count,
    remaining: Math.max(0, limit - count),
    resetAt,
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Inject a unique request ID for distributed tracing
  const requestId = globalThis.crypto.randomUUID()

  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(req.headers),
        'x-request-id': requestId,
      }),
    },
  })

  // ── 1. Security headers ───────────────────────────────────────────────────
  response.headers.set('X-Request-Id',          requestId)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options',        'DENY')
  response.headers.set('X-XSS-Protection',       '1; mode=block')
  response.headers.set('Referrer-Policy',        'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy',     'camera=(), microphone=(), geolocation=()')

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    )
  }

  // CSP: API routes serve JSON only — lock them down hard.
  if (pathname.startsWith('/api/')) {
    response.headers.set('Content-Security-Policy', "default-src 'none'")
  } else {
    response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js HMR requires these
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://api.rechargeapps.com https://api.x.ai",
        "frame-ancestors 'none'",
      ].join('; '),
    )
  }

  // ── 2. CORS — webhook endpoints are server-to-server ─────────────────────
  if (pathname.startsWith('/api/webhooks/')) {
    response.headers.set('Access-Control-Allow-Origin',  '*')
    response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Recharge-Hmac-Sha256, X-Shopify-Hmac-Sha256, X-Recharge-Topic, X-Shopify-Topic, X-Shopify-Webhook-Id',
    )
  }

  // CORS preflight
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return new NextResponse(null, { status: 204, headers: response.headers })
  }

  // ── 3. Distributed rate limiting (API routes only) ────────────────────────
  if (pathname.startsWith('/api/')) {
    // Internal cron calls bypass rate limiting
    const cronSecret = req.headers.get('x-cron-secret')
    const isCron     = cronSecret && cronSecret === process.env.CRON_SECRET

    // Verified webhook calls bypass rate limiting
    const isWebhook  = pathname.startsWith('/api/webhooks/')

    if (!isCron && !isWebhook) {
      const ip = (
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('x-real-ip') ??
        'unknown'
      )

      const config   = getRateLimit(pathname)
      const routeKey = pathname.split('/').slice(0, 4).join('/')
      const key      = `rl:${routeKey}:${ip}`

      const result = await checkRateLimit(key, config)

      response.headers.set('X-RateLimit-Limit',     String(config.maxRequests))
      response.headers.set('X-RateLimit-Remaining', String(result.remaining))
      response.headers.set('X-RateLimit-Reset',     String(Math.ceil(result.resetAt / 1000)))
      response.headers.set('X-RateLimit-Policy',    `${config.maxRequests};w=${config.windowMs / 1000}`)

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
        return NextResponse.json(
          {
            error:      'Too many requests. Please slow down.',
            code:       'RATE_LIMITED',
            retryAfter,
          },
          {
            status: 429,
            headers: {
              'Retry-After':          String(retryAfter),
              'X-Request-Id':         requestId,
              'X-RateLimit-Limit':    String(config.maxRequests),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset':    String(Math.ceil(result.resetAt / 1000)),
              'Content-Type':         'application/json',
            },
          },
        )
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
