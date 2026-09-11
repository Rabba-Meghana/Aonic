'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      setSent(true)
      if (data.devResetUrl) setDevResetUrl(data.devResetUrl)
      setLoading(false)
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600" />
          <span className="text-lg font-bold text-white">NovaMember</span>
        </Link>

        <div className="glass rounded-2xl border border-white/10 p-8">
          <h1 className="text-xl font-bold text-white mb-1">Reset your password</h1>
          <p className="text-sm text-gray-500 mb-6">
            Enter the email on your account and we&apos;ll send you a link to reset your password.
          </p>

          {sent ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400">
                If an account exists for <strong>{email}</strong>, a reset link has been sent.
              </div>
              {devResetUrl && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 space-y-2">
                  <p className="font-semibold uppercase tracking-wide">Dev mode — email delivery not configured</p>
                  <p className="text-gray-300 break-all">
                    Real email sending (Resend) isn&apos;t wired up with an API key in this deployment yet, so
                    here&apos;s the actual reset link that would have been emailed:
                  </p>
                  <Link href={devResetUrl.replace(/^https?:\/\/[^/]+/, '')} className="text-blue-400 underline break-all">
                    {devResetUrl}
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/60 focus:bg-blue-500/5 transition-all"
                />
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-semibold hover:from-blue-500 hover:to-violet-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20">
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="text-center text-sm text-gray-500 mt-6">
            <Link href="/login" className="text-blue-400 hover:text-blue-300 underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
