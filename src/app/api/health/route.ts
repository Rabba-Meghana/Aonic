/**
 * NovaMember — Health Check Endpoint
 *
 * Used by load balancers, Vercel, and uptime monitors.
 * Returns 200 when all systems are operational, 503 when degraded.
 *
 * GET /api/health
 * GET /api/health?verbose=true   — full service check (requires CRON_SECRET)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

interface ServiceStatus {
  status: 'ok' | 'degraded' | 'down'
  latencyMs?: number
  error?: string
}

interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy'
  version: string
  uptime: number
  timestamp: string
  services?: Record<string, ServiceStatus>
}

const START_TIME = Date.now()
const VERSION = process.env.npm_package_version ?? '1.0.0'

async function checkDatabase(): Promise<ServiceStatus> {
  const t = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return { status: 'ok', latencyMs: Date.now() - t }
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - t, error: String(err) }
  }
}

async function checkRecharge(): Promise<ServiceStatus> {
  const t = Date.now()
  try {
    const res = await fetch('https://api.rechargeapps.com/shop', {
      method: 'GET',
      headers: {
        'X-Recharge-Access-Token': process.env.RECHARGE_API_KEY ?? '',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })
    const latencyMs = Date.now() - t
    if (res.status === 401) {
      // 401 means Recharge is reachable but credentials are wrong — still "reachable"
      return { status: 'ok', latencyMs }
    }
    return res.ok
      ? { status: 'ok', latencyMs }
      : { status: 'degraded', latencyMs, error: `HTTP ${res.status}` }
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - t, error: String(err) }
  }
}

async function checkShopify(): Promise<ServiceStatus> {
  const t = Date.now()
  const shop = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_STORE_ACCESS_TOKEN

  if (!shop || !token) {
    return { status: 'degraded', error: 'SHOPIFY_STORE_DOMAIN or SHOPIFY_STORE_ACCESS_TOKEN not configured' }
  }

  try {
    const res = await fetch(`https://${shop}/admin/api/2024-10/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token },
      signal: AbortSignal.timeout(5000),
    })
    const latencyMs = Date.now() - t
    return res.ok
      ? { status: 'ok', latencyMs }
      : { status: 'degraded', latencyMs, error: `HTTP ${res.status}` }
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - t, error: String(err) }
  }
}

async function checkGrok(): Promise<ServiceStatus> {
  const t = Date.now()
  try {
    const res = await fetch('https://api.x.ai/v1/models', {
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY ?? ''}`,
      },
      signal: AbortSignal.timeout(5000),
    })
    const latencyMs = Date.now() - t
    return res.ok || res.status === 401
      ? { status: 'ok', latencyMs }
      : { status: 'degraded', latencyMs, error: `HTTP ${res.status}` }
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - t, error: String(err) }
  }
}

export async function GET(req: NextRequest) {
  const verbose = req.nextUrl.searchParams.get('verbose') === 'true'
  const cronSecret = req.headers.get('x-cron-secret')
  const allowVerbose = !process.env.CRON_SECRET || cronSecret === process.env.CRON_SECRET

  // Fast path — just DB check for load balancer probes
  if (!verbose || !allowVerbose) {
    const db_status = await checkDatabase()
    const isHealthy = db_status.status === 'ok'

    const report: HealthReport = {
      status:    isHealthy ? 'healthy' : 'unhealthy',
      version:   VERSION,
      uptime:    Math.round((Date.now() - START_TIME) / 1000),
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(report, {
      status: isHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache',
        'Content-Type': 'application/json',
      },
    })
  }

  // Verbose path — check all external services in parallel
  const [database, recharge, shopify, grok] = await Promise.all([
    checkDatabase(),
    checkRecharge(),
    checkShopify(),
    checkGrok(),
  ])

  const services = { database, recharge, shopify, grok }
  const anyDown  = Object.values(services).some(s => s.status === 'down')
  const anyDegraded = Object.values(services).some(s => s.status === 'degraded')

  const overallStatus: HealthReport['status'] = anyDown
    ? 'unhealthy'
    : anyDegraded
    ? 'degraded'
    : 'healthy'

  const report: HealthReport = {
    status:    overallStatus,
    version:   VERSION,
    uptime:    Math.round((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    services,
  }

  logger.info('Health check', { status: overallStatus, services })

  return NextResponse.json(report, {
    status: anyDown ? 503 : 200,
    headers: {
      'Cache-Control': 'no-store, no-cache',
      'Content-Type': 'application/json',
    },
  })
}
