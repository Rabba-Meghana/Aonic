'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ── Types (match the real API responses) ───────────────────────────────────────
interface Member {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  status: string
  engagementScore: number
  engagementTier: 'COLD' | 'WARM' | 'HOT' | 'CHAMPION'
  createdAt: string
}

interface Task {
  id: string
  taskKey: string
  title: string
  description: string | null
  isRequired: boolean
  completedAt: string | null
  skippedAt: string | null
}

interface Subscription {
  id: string
  planName: string
  planPrice: string
  billingCycle: string
  status: string
  currentPeriodEnd: string
}

interface AiScoreResult {
  score: number
  tier: string
  churnProbability30d: number
  reasoning: string
  recommendations: string[]
}

// XP is a pure UI gamification layer — not stored in the DB — mapped onto
// whichever real onboarding tasks come back from /api/onboarding.
const TASK_META: Record<string, { icon: string; xp: number }> = {
  complete_profile:    { icon: '👤', xp: 100 },
  connect_shopify:     { icon: '🛍️', xp: 250 },
  configure_recharge:  { icon: '🔄', xp: 250 },
  import_products:     { icon: '📦', xp: 200 },
  invite_team:         { icon: '👥', xp: 150 },
  launch_subscription: { icon: '🚀', xp: 300 },
  review_analytics:    { icon: '📊', xp: 150 },
}

const NAV_ITEMS = [
  { icon: '⬡', label: 'Overview', href: '/dashboard', active: true },
  { icon: '📦', label: 'Products', href: '/products' },
  { icon: '📊', label: 'Analytics', href: '/admin' },
  { icon: '⚙️', label: 'Settings', href: '/dashboard#settings' },
]

function EngagementRing({ score, tier }: { score: number; tier: string }) {
  const tierColors: Record<string, { stroke: string; glow: string; label: string }> = {
    CHAMPION: { stroke: '#f59e0b', glow: 'rgba(245,158,11,0.4)', label: '🏆 Champion' },
    HOT: { stroke: '#ef4444', glow: 'rgba(239,68,68,0.4)', label: '🔥 Hot' },
    WARM: { stroke: '#f97316', glow: 'rgba(249,115,22,0.4)', label: '⚡ Warm' },
    COLD: { stroke: '#3b82f6', glow: 'rgba(59,130,246,0.4)', label: '❄️ Cold' },
  }
  const { stroke, glow, label } = tierColors[tier] || tierColors.COLD
  const circumference = 2 * Math.PI * 40
  const offset = circumference * (1 - score / 100)

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28" style={{ filter: `drop-shadow(0 0 12px ${glow})` }}>
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle cx="50" cy="50" r="40" fill="none" stroke={stroke} strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1.5s ease-out' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-extrabold text-white">{Math.round(score)}</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-semibold px-3 py-1 rounded-full"
        style={{ background: `${glow}`, color: stroke, border: `1px solid ${stroke}40` }}>
        {label}
      </span>
    </div>
  )
}

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('nm_token') : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function DashboardPage() {
  const router = useRouter()
  const [hasToken, setHasToken] = useState<boolean | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<AiScoreResult | null>(null)
  const [greeting, setGreeting] = useState('Good morning')

  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
  }, [])

  const loadAll = useCallback(async () => {
    const token = localStorage.getItem('nm_token')
    if (!token) {
      setHasToken(false)
      setLoading(false)
      return
    }
    setHasToken(true)
    setLoading(true)
    setError(null)
    try {
      const [meRes, tasksRes, subsRes] = await Promise.all([
        fetch('/api/auth/me', { headers: authHeaders() }),
        fetch('/api/onboarding', { headers: authHeaders() }),
        fetch('/api/subscriptions', { headers: authHeaders() }),
      ])

      if (meRes.status === 401) {
        localStorage.removeItem('nm_token')
        setHasToken(false)
        setLoading(false)
        return
      }

      const me = await meRes.json()
      const taskData = await tasksRes.json()
      const subsData = await subsRes.json()

      if (!meRes.ok) throw new Error(me.error ?? 'Failed to load profile')

      setMember(me.member)
      setTasks(taskData.tasks ?? [])
      setSubscriptions(subsData.subscriptions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const signOut = () => {
    localStorage.removeItem('nm_token')
    router.push('/')
  }

  const completeTask = async (taskKey: string) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.taskKey === taskKey && !t.completedAt
      ? { ...t, completedAt: new Date().toISOString() } : t))

    const res = await fetch('/api/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ taskKey }),
    })
    if (!res.ok) {
      // Revert on failure and re-sync from the server
      loadAll()
    }
  }

  const [exporting, setExporting] = useState(false)
  const exportData = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/compliance/data-export', { headers: authHeaders() })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'novamember-data-export.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // no-op — button just stays enabled for retry
    } finally {
      setExporting(false)
    }
  }

  const fetchAiInsight = async () => {
    setAiLoading(true)
    setAiResult(null)
    try {
      const res = await fetch('/api/ai/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}), // no signals → server derives them from real activity data
      })
      const data = await res.json()
      if (res.ok) {
        setAiResult(data)
        setMember(prev => prev ? { ...prev, engagementScore: data.score, engagementTier: data.tier } : prev)
      }
    } finally {
      setAiLoading(false)
    }
  }

  const completedTasks = tasks.filter(t => t.completedAt)
  const totalTasks = tasks.length
  const completionPct = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0
  const totalXP = completedTasks.reduce((sum, t) => sum + (TASK_META[t.taskKey]?.xp ?? 100), 0)
  const maxXP = tasks.reduce((sum, t) => sum + (TASK_META[t.taskKey]?.xp ?? 100), 0) || 1

  const activeSub = subscriptions.find(s => s.status === 'ACTIVE')

  // ── Not signed in ──────────────────────────────────────────────────────────
  if (hasToken === false) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-white mb-3">You're not signed in</h1>
          <p className="text-gray-500 mb-8">Create an account through checkout to see your real dashboard — there's no demo data here.</p>
          <Link href="/checkout"
            className="block w-full py-3 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-semibold text-center hover:from-blue-500 hover:to-violet-500 transition-all">
            Go to checkout →
          </Link>
        </div>
      </div>
    )
  }

  if (loading || hasToken === null) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
        <svg className="w-8 h-8 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  if (error || !member) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <p className="text-red-400 mb-2">Couldn't load your dashboard</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-[#0d0d0f] border-r border-white/5 fixed h-full z-40">
        <div className="p-4 border-b border-white/5">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600" />
            <span className="font-bold text-sm">NovaMember</span>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ icon, label, href, active }) => (
            <Link key={label} href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                active
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20'
                  : 'text-gray-500 hover:text-white hover:bg-white/5'
              }`}>
              <span className="text-base">{icon}</span>
              {label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-white/5 space-y-2">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg glass">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-sm font-bold text-white">
              {member.firstName[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{member.firstName} {member.lastName}</p>
              <p className="text-[10px] text-gray-500 truncate">{activeSub?.planName ?? 'No active plan'}</p>
            </div>
            <div className={`status-dot ${activeSub ? 'status-dot-green' : 'status-dot-amber'}`} />
          </div>
          <button onClick={signOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-white/5 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 lg:ml-56 p-6">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {greeting}, {member.firstName}! 👋
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Member ID: <span className="font-mono text-gray-400">{member.id}</span>
              &nbsp;·&nbsp; Subscription:{' '}
              <span className={activeSub ? 'text-emerald-400' : 'text-amber-400'}>
                {activeSub ? 'Active' : 'None yet'}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin"
              className="px-4 py-2 rounded-lg glass border border-white/10 text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2">
              <span>📊</span> Analytics
            </Link>
            <Link href="/products"
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-medium flex items-center gap-2 hover:from-blue-500 hover:to-violet-500 transition-all">
              <span>🛍️</span> Shop
            </Link>
          </div>
        </div>

        {!activeSub && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
            You don't have an active subscription yet. <Link href="/checkout" className="underline">Subscribe to a plan</Link> to unlock billing, Recharge sync, and full onboarding.
          </div>
        )}

        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Current Plan', value: activeSub?.planName ?? '—', sub: activeSub ? 'via Recharge' : 'No plan yet', color: 'text-violet-400' },
            { label: 'Next Billing', value: activeSub ? `$${parseFloat(activeSub.planPrice).toFixed(0)}` : '—', sub: activeSub ? new Date(activeSub.currentPeriodEnd).toLocaleDateString() : '—', color: 'text-blue-400' },
            { label: 'Member Since', value: new Date(member.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), sub: 'account created', color: 'text-emerald-400' },
            { label: 'XP Earned', value: totalXP.toLocaleString(), sub: 'onboarding points', color: 'text-amber-400' },
          ].map(({ label, value, sub, color }) => (
            <div key={label} className="metric-card">
              <p className="text-xs text-gray-500 mb-3">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-600 mt-1">{sub}</p>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {/* Onboarding checklist */}
            {tasks.length > 0 && (
              <div className="glass rounded-2xl border border-white/10 p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      🚀 Getting Started
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        {completedTasks.length}/{totalTasks} complete
                      </span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">Complete all steps to unlock your full dashboard</p>
                  </div>
                </div>

                <div className="progress-bar mb-5">
                  <div className="progress-bar-fill" style={{ width: `${completionPct}%` }} />
                </div>

                <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
                  <span className="text-2xl">⭐</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-amber-400">Onboarding XP</span>
                      <span className="text-xs text-gray-500">{totalXP} / {maxXP} XP</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-amber-400 transition-all duration-1000"
                        style={{ width: `${(totalXP / maxXP) * 100}%` }} />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {tasks.map(task => {
                    const done = !!task.completedAt
                    const meta = TASK_META[task.taskKey] ?? { icon: '✅', xp: 100 }
                    return (
                      <div key={task.id}
                        className={`flex items-center gap-4 p-4 rounded-xl transition-all cursor-pointer border ${
                          done ? 'border-emerald-500/20 bg-emerald-500/5' :
                          'border-white/8 bg-white/2 hover:border-white/15 hover:bg-white/4'
                        }`}
                        onClick={() => !done && completeTask(task.taskKey)}>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          done ? 'border-emerald-500 bg-emerald-500' : 'border-gray-600 hover:border-blue-500'
                        }`}>
                          {done && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="text-xl flex-shrink-0">{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${done ? 'text-gray-500 line-through' : 'text-white'}`}>
                            {task.title}
                            {task.isRequired && !done && (
                              <span className="ml-2 text-[10px] text-red-400 font-semibold uppercase tracking-wide">required</span>
                            )}
                          </p>
                          {task.description && <p className="text-xs text-gray-600 mt-0.5 truncate">{task.description}</p>}
                        </div>
                        <div className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                          done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-600'
                        }`}>
                          +{meta.xp} XP
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Subscription status */}
            <div className="glass rounded-2xl border border-white/10 p-6 mb-6">
              <h2 className="font-semibold text-white mb-4">Subscription (via Recharge)</h2>
              {activeSub ? (
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Status', value: activeSub.status, color: 'text-emerald-400' },
                    { label: 'Next charge', value: new Date(activeSub.currentPeriodEnd).toLocaleDateString(), color: 'text-white' },
                    { label: 'Amount', value: `$${parseFloat(activeSub.planPrice).toFixed(0)}`, color: 'text-white' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="text-center p-3 rounded-xl bg-white/3">
                      <p className="text-xs text-gray-500 mb-1">{label}</p>
                      <p className={`font-semibold text-sm ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No subscription on file yet. Once you complete checkout on a real Shopify store, Recharge's webhook activates it here automatically.</p>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Engagement score */}
            <div className="glass rounded-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-white text-sm">AI Engagement Score</h2>
                <span className="text-[10px] text-gray-600 px-2 py-0.5 rounded-full bg-white/5">Grok API</span>
              </div>
              <div className="flex justify-center mb-4">
                <EngagementRing score={member.engagementScore} tier={member.engagementTier} />
              </div>

              <button onClick={fetchAiInsight} disabled={aiLoading}
                className="mt-2 w-full py-2.5 px-4 rounded-xl border border-violet-500/30 text-violet-400 text-xs font-medium hover:bg-violet-500/10 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {aiLoading ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Asking Grok...
                  </>
                ) : '🤖 Get AI recommendation'}
              </button>

              {aiResult && (
                <div className="mt-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/15 text-xs text-gray-400 leading-relaxed">
                  <p className="text-violet-400 font-medium mb-1">Grok says:</p>
                  <p className="mb-2">{aiResult.reasoning}</p>
                  {aiResult.recommendations?.length > 0 && (
                    <ul className="list-disc list-inside space-y-0.5">
                      {aiResult.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                  <p className="mt-2 text-gray-600">Churn probability (30d): {(aiResult.churnProbability30d * 100).toFixed(1)}%</p>
                </div>
              )}
            </div>

            {/* CPRA compliance */}
            <div className="glass rounded-2xl border border-white/10 p-6">
              <h2 className="font-semibold text-white text-sm mb-4">CPRA Compliance</h2>
              <div className="space-y-3">
                {[
                  { label: 'Data processing consent', status: 'Granted', color: 'text-emerald-400', icon: '✓' },
                  { label: 'Right to delete', status: 'Available', color: 'text-blue-400', icon: '→' },
                  { label: 'Data export (DSAR)', status: 'Available', color: 'text-blue-400', icon: '→' },
                ].map(({ label, status, color, icon }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{label}</span>
                    <span className={`${color} font-medium`}>{icon} {status}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-white/5 flex gap-2">
                <button onClick={exportData} disabled={exporting}
                  className="flex-1 text-center py-2 text-xs rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-60">
                  {exporting ? 'Exporting…' : 'Export data'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
