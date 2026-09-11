'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Analytics {
  generatedAt: string
  kpis: {
    mrr: number
    activeSubscriptions: number
    activeMembers: number
    newMembersThisMonth: number
    churnRatePct: number
    arrRunRate: number
    arpu: number
  }
  revenueTrend: Array<{ month: string; revenue: number }>
  planDistribution: Array<{ plan: string; count: number; pct: number }>
  funnel: Array<{ stage: string; count: number; pct: number }>
  topMembersByLtv: Array<{ name: string; email: string; ltv: number; score: number; tier: string }>
  churnRiskMembers: Array<{ name: string; email: string; score: number }>
  webhookEvents: Array<{ source: string; topic: string; status: string; time: string; latencyMs: number | null }>
}

const tierConfig: Record<string, { bg: string; text: string }> = {
  CHAMPION: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  HOT: { bg: 'bg-red-500/20', text: 'text-red-400' },
  WARM: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  COLD: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
}

function BarChart({ data }: { data: Array<{ month: string; revenue: number }> }) {
  const max = Math.max(...data.map(d => d.revenue), 1)
  return (
    <div className="flex items-end gap-2 h-40 pt-4">
      {data.map((d, i) => (
        <div key={d.month} className="flex-1 flex flex-col items-center gap-1.5">
          <div
            className="w-full rounded-t-md transition-all duration-700"
            style={{
              height: `${Math.max((d.revenue / max) * 100, 2)}%`,
              background: i === data.length - 1
                ? 'linear-gradient(180deg, #60a5fa, #8b5cf6)'
                : `rgba(99,102,241,${0.25 + i * 0.08})`,
            }}
          />
          <span className="text-[9px] text-gray-600">{d.month}</span>
        </div>
      ))}
    </div>
  )
}

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('nm_token') : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'ai' | 'webhooks'>('overview')
  const [generatingReport, setGeneratingReport] = useState(false)
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/analytics', { headers: authHeaders() })
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Request failed: ${res.status}`)
        return json
      })
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const generateReport = async () => {
    setGeneratingReport(true)
    await new Promise(r => setTimeout(r, 1200))
    setGeneratingReport(false)
    alert('Not built yet — this would call the Grok API to summarize the real numbers below and email a PDF. Everything above this button is live from your database; this one button is the one piece still unbuilt.')
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <p className="text-red-400 mb-2">Couldn't load analytics</p>
          <p className="text-sm text-gray-500 mb-6">{error}</p>
          {error.toLowerCase().includes('forbidden') && (
            <div>
              <p className="text-xs text-gray-600 mb-2">This page requires an admin account. Sign in as a member with role ADMIN.</p>
              <Link href="/login" className="text-blue-400 underline text-sm">Sign in as a different account</Link>
            </div>
          )}
          {error.toLowerCase().includes('unauthorized') && (
            <Link href="/login" className="text-blue-400 underline text-sm">Sign in</Link>
          )}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
        <svg className="w-8 h-8 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  const { kpis } = data

  return (
    <div className="min-h-screen bg-[#0a0a0b]">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-[#0a0a0b]/95 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600" />
              <span className="font-bold text-sm">NovaMember</span>
            </Link>
            <span className="text-gray-700">/</span>
            <span className="text-sm text-gray-400">Analytics — live from your database</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
              Dashboard
            </Link>
            <button onClick={generateReport} disabled={generatingReport}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-medium hover:from-blue-500 hover:to-violet-500 disabled:opacity-60 transition-all">
              {generatingReport ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Working...
                </>
              ) : '🤖 AI Report'}
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {kpis.activeMembers === 0 && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
            No real members yet — every number below is a live query against your database, it's just empty until real checkouts happen.
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'MRR', value: `$${kpis.mrr.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: `${kpis.activeSubscriptions} active subs` },
            { label: 'Active Members', value: kpis.activeMembers.toLocaleString(), sub: `${kpis.newMembersThisMonth} new this month` },
            { label: 'Churn Rate (90d)', value: `${kpis.churnRatePct}%`, sub: 'cancelled / total' },
            { label: 'ARPU', value: `$${kpis.arpu}`, sub: `$${kpis.arrRunRate.toLocaleString()} ARR run rate` },
          ].map(({ label, value, sub }) => (
            <div key={label} className="metric-card">
              <p className="text-xs text-gray-500 mb-2">{label}</p>
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-xs text-gray-600 mt-1">{sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 glass rounded-xl w-fit border border-white/10">
          {(['overview', 'members', 'ai', 'webhooks'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}>
              {tab === 'ai' ? 'AI Insights' : tab === 'webhooks' ? 'Webhook Events' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 glass rounded-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-white">Revenue Collected (real charges)</h2>
                <span className="text-xs text-gray-600">Last 6 months</span>
              </div>
              <BarChart data={data.revenueTrend} />
            </div>

            <div className="glass rounded-2xl border border-white/10 p-6">
              <h2 className="font-semibold text-white mb-4">Plan Distribution</h2>
              {data.planDistribution.length === 0 ? (
                <p className="text-xs text-gray-600">No active subscriptions yet.</p>
              ) : data.planDistribution.map(({ plan, count, pct }) => (
                <div key={plan} className="mb-4">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-gray-400">{plan}</span>
                    <span className="text-gray-500">{count} · {pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-500 transition-all duration-1000"
                      style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}

              <div className="mt-6 border-t border-white/5 pt-5">
                <h3 className="text-sm text-gray-400 mb-3">Onboarding Funnel</h3>
                {data.funnel.map(({ stage, count, pct }) => (
                  <div key={stage} className="flex items-center gap-3 mb-2 text-xs">
                    <div className="w-28 text-gray-500 truncate">{stage}</div>
                    <div className="flex-1 h-1.5 rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-blue-500 transition-all duration-1000"
                        style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-gray-400 w-16 text-right">{count} · {pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Members tab */}
        {activeTab === 'members' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-white/5">
                <h2 className="font-semibold text-white">Top Members by LTV</h2>
              </div>
              {data.topMembersByLtv.length === 0 ? (
                <p className="p-6 text-xs text-gray-600">No successful charges yet.</p>
              ) : (
                <table className="data-table w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Member</th>
                      <th className="text-right">LTV</th>
                      <th className="text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topMembersByLtv.map(m => (
                      <tr key={m.email}>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white">
                              {m.name[0]}
                            </div>
                            <div>
                              <p className="text-sm text-white">{m.name}</p>
                              <p className="text-xs text-gray-600">{m.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-right"><span className="text-sm font-semibold text-emerald-400">${m.ltv.toFixed(2)}</span></td>
                        <td className="text-right">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierConfig[m.tier]?.bg} ${tierConfig[m.tier]?.text}`}>
                            {Math.round(m.score)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                <h2 className="font-semibold text-white">⚠️ Churn Risk (COLD tier)</h2>
                <span className="text-xs text-red-400 font-medium">{data.churnRiskMembers.length} at risk</span>
              </div>
              {data.churnRiskMembers.length === 0 ? (
                <p className="p-6 text-xs text-gray-600">No members currently flagged COLD.</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {data.churnRiskMembers.map(m => (
                    <div key={m.email} className="px-5 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center text-xs text-red-400">
                          {m.name[0]}
                        </div>
                        <div>
                          <p className="text-sm text-white">{m.name}</p>
                          <p className="text-xs text-gray-600">{m.email}</p>
                        </div>
                      </div>
                      <p className="text-xs text-red-400 font-bold">Score: {Math.round(m.score)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI tab */}
        {activeTab === 'ai' && (
          <div className="glass rounded-2xl border border-white/10 p-6">
            <h2 className="font-semibold text-white mb-1">Grok AI Scoring Engine</h2>
            <p className="text-xs text-gray-500 mb-5">Real-time engagement analysis via xAI grok-2-1212 — see /api/ai/score and /api/evals</p>
            <p className="text-sm text-gray-500">
              Per-run cost and latency are logged for every eval run (see <code className="text-blue-400">GET /api/evals</code>)
              rather than shown here as a static number — check that endpoint for the live figures from your most recent run.
            </p>
          </div>
        )}

        {/* Webhooks tab */}
        {activeTab === 'webhooks' && (
          <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="font-semibold text-white">Webhook Event Log</h2>
              <span className="text-xs text-gray-500">{data.webhookEvents.length} most recent</span>
            </div>
            {data.webhookEvents.length === 0 ? (
              <p className="p-6 text-xs text-gray-600">No webhooks received yet — this fills in the moment Shopify or Recharge sends a real event.</p>
            ) : (
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th className="text-left">Source</th>
                    <th className="text-left">Topic</th>
                    <th className="text-left">Status</th>
                    <th className="text-left">Timestamp</th>
                    <th className="text-right">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.webhookEvents.map((row, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          row.source === 'recharge' ? 'bg-violet-500/20 text-violet-400' : 'bg-green-500/20 text-green-400'
                        }`}>
                          {row.source}
                        </span>
                      </td>
                      <td><code className="text-xs text-blue-400 font-mono">{row.topic}</code></td>
                      <td>
                        <span className={`text-xs flex items-center gap-1 ${row.status === 'PROCESSED' ? 'text-emerald-400' : row.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full inline-block ${row.status === 'PROCESSED' ? 'bg-emerald-400' : row.status === 'FAILED' ? 'bg-red-400' : 'bg-amber-400'}`} />
                          {row.status}
                        </span>
                      </td>
                      <td><span className="text-xs text-gray-500">{new Date(row.time).toLocaleString()}</span></td>
                      <td className="text-right"><span className="text-xs text-gray-400 font-mono">{row.latencyMs !== null ? `${row.latencyMs}ms` : '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
