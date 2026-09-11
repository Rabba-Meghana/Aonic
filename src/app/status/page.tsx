'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  version: string
  uptime: number
  timestamp: string
}

export default function StatusPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(setHealth)
      .catch(() => setError('Could not reach the health check endpoint.'))
  }, [])

  const ok = health?.status === 'healthy'

  return (
    <div className="min-h-screen bg-[#0a0a0b] px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300 mb-8 inline-block">← Back to NovaMember</Link>
        <h1 className="text-3xl font-bold text-white mb-2">System Status</h1>
        <p className="text-sm text-gray-500 mb-8">
          This reads live from <code className="text-blue-400">/api/health</code> — a real check against
          the production database, not a static page.
        </p>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400 mb-6">
            {error}
          </div>
        )}

        {!health && !error && (
          <p className="text-sm text-gray-500">Checking live status…</p>
        )}

        {health && (
          <div className="glass rounded-2xl border border-white/10 p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-white font-medium">Overall status</span>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
              }`}>
                {ok ? 'Operational' : health.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-1">Uptime (this deployment)</p>
                <p className="text-white">{health.uptime}s</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Version</p>
                <p className="text-white">{health.version}</p>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-4">
              Last checked: {new Date(health.timestamp).toLocaleString()}
            </p>
            <p className="text-xs text-gray-600 mt-2">
              Per-service checks (Shopify, Recharge, Grok) are available via the verbose health check,
              gated behind a cron secret for internal monitoring use.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
