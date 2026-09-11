'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 99,
    interval: 'monthly',
    features: ['500 members', 'Shopify sync', 'Basic analytics'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 299,
    interval: 'monthly',
    popular: true,
    features: ['5,000 members', 'Grok AI scoring', 'CPRA tools', 'Smart onboarding'],
  },
  {
    id: 'scale',
    name: 'Scale',
    price: 799,
    interval: 'monthly',
    features: ['Unlimited members', 'Custom AI', 'White-label', 'SLA'],
  },
]

type StepKey = 'plan' | 'account' | 'confirm'

function CheckoutForm() {
  const searchParams = useSearchParams()

  // Catalog mode: arrived here from /products via "Subscribe & Save" / "Add
  // to Cart" on a specific Shopify item — checkout should reflect THAT item,
  // not silently fall back to the unrelated platform Starter plan.
  const productId = searchParams.get('productId')
  const catalogTitle = searchParams.get('title')
  const catalogPrice = searchParams.get('price')
  const catalogMode = !!productId

  const catalogPlan = {
    id: productId ?? '',
    name: catalogTitle || 'Selected product',
    price: catalogPrice ? Number(catalogPrice) : 0,
    interval: 'monthly',
    features: [] as string[],
  }

  const STEPS: { key: StepKey; label: string }[] = catalogMode
    ? [{ key: 'account', label: 'Account' }, { key: 'confirm', label: 'Confirm' }]
    : [{ key: 'plan', label: 'Plan' }, { key: 'account', label: 'Account' }, { key: 'confirm', label: 'Confirm' }]

  const [step, setStep] = useState<StepKey>(catalogMode ? 'account' : 'plan')
  const [selectedPlan, setSelectedPlan] = useState('starter')
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '',
    company: '',
    agreeMarketing: false,
    cpraConsent: false,
  })
  const [loading, setLoading] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const plan = catalogMode ? catalogPlan : PLANS.find(p => p.id === selectedPlan)!
  const stepIndex = STEPS.findIndex(s => s.key === step)

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName:       form.firstName,
          lastName:        form.lastName,
          email:           form.email,
          password:        form.password,
          ...(catalogMode ? { productId } : { planId: selectedPlan }),
          cpraConsent:     form.cpraConsent,
          marketingConsent: form.agreeMarketing,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Checkout failed. Please try again.')
        setLoading(false)
        return
      }

      // Account is created; persist JWT so the dashboard works once the
      // member comes back. The subscription itself is NOT active yet — that
      // only becomes true once Recharge confirms real payment via webhook.
      if (typeof window !== 'undefined' && data.token) {
        localStorage.setItem('nm_token', data.token)
      }

      if (!data.checkoutUrl) {
        setError('Checkout could not be started — no Shopify checkout URL was returned. Check that SHOPIFY_STORE_DOMAIN and SHOPIFY_VARIANT_* are configured.')
        setLoading(false)
        return
      }

      // Redirect to Shopify's real, PCI-compliant hosted checkout. Card entry
      // happens there, not on this site.
      setRedirecting(true)
      window.location.href = data.checkoutUrl
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(false)
    }
  }

  if (redirecting) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <svg className="w-10 h-10 animate-spin text-blue-400 mx-auto mb-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <h1 className="text-xl font-bold text-white mb-2">Redirecting to secure checkout…</h1>
          <p className="text-sm text-gray-500">
            Your account is created. Payment is handled entirely by Shopify's hosted checkout — we never see or store your card details.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b]">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-[#0a0a0b]/95 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600" />
            <span className="font-bold">NovaMember</span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            Payment handled by Shopify checkout
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-12">
        {catalogMode && (
          <div className="max-w-3xl mx-auto mb-8 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 text-sm text-blue-300 text-center">
            Checking out <strong>{catalogPlan.name}</strong> from the Shopify catalog — not a NovaMember platform plan.
          </div>
        )}

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-12">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className={`flex items-center gap-2 ${i <= stepIndex ? 'text-white' : 'text-gray-600'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border transition-all ${
                  i < stepIndex ? 'bg-emerald-600 border-emerald-600 text-white' :
                  i === stepIndex ? 'bg-blue-600 border-blue-600 text-white' :
                  'border-gray-700 text-gray-600'
                }`}>
                  {i < stepIndex ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : i + 1}
                </div>
                <span className="text-sm font-medium hidden sm:block">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-16 sm:w-24 h-px mx-3 ${i < stepIndex ? 'bg-emerald-600' : 'bg-gray-800'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main */}
          <div className="lg:col-span-2">
            {/* Plan selection — platform plans only, skipped entirely in catalog mode */}
            {!catalogMode && step === 'plan' && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-6">Choose your plan</h2>
                <div className="space-y-4">
                  {PLANS.map(p => (
                    <button key={p.id} onClick={() => setSelectedPlan(p.id)}
                      className={`w-full text-left p-5 rounded-2xl border transition-all ${
                        selectedPlan === p.id
                          ? 'border-blue-500/60 bg-blue-500/10 shadow-lg shadow-blue-500/10'
                          : 'border-white/10 glass hover:border-white/20'
                      }`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selectedPlan === p.id ? 'border-blue-500 bg-blue-500' : 'border-gray-600'
                          }`}>
                            {selectedPlan === p.id && <div className="w-2 h-2 rounded-full bg-white" />}
                          </div>
                          <span className="font-semibold text-white">{p.name}</span>
                          {p.popular && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                              POPULAR
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-xl font-bold text-white">${p.price}</span>
                          <span className="text-gray-500 text-sm">/mo</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pl-8">
                        {p.features.map(f => (
                          <span key={f} className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-md">{f}</span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
                <button onClick={() => setStep('account')}
                  className="mt-6 w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-semibold hover:from-blue-500 hover:to-violet-500 transition-all shadow-lg shadow-blue-500/20">
                  Continue →
                </button>
              </div>
            )}

            {/* Account */}
            {step === 'account' && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-6">Create your account</h2>
                {catalogMode && (
                  <p className="text-sm text-gray-500 mb-6">
                    You're subscribing to <strong className="text-white">{catalogPlan.name}</strong> — ${catalogPlan.price.toFixed(2)}/month via Recharge.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'firstName', label: 'First name', type: 'text', placeholder: 'Alex', col: 1 },
                    { key: 'lastName', label: 'Last name', type: 'text', placeholder: 'Johnson', col: 1 },
                    { key: 'email', label: 'Email address', type: 'email', placeholder: 'alex@company.com', col: 2 },
                    { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••', col: 2 },
                    { key: 'company', label: 'Company (optional)', type: 'text', placeholder: 'Aonic Inc.', col: 2 },
                  ].map(({ key, label, type, placeholder, col }) => (
                    <div key={key} className={col === 2 ? 'col-span-2' : ''}>
                      <label className="block text-sm text-gray-400 mb-1.5">{label}</label>
                      <input type={type} placeholder={placeholder}
                        value={form[key as keyof typeof form] as string}
                        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/60 focus:bg-blue-500/5 transition-all" />
                    </div>
                  ))}
                </div>

                {/* CPRA consent */}
                <div className="mt-6 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">CPRA Consent</p>
                  <label className="flex items-start gap-3 cursor-pointer mb-3">
                    <input type="checkbox" checked={form.cpraConsent}
                      onChange={e => setForm(prev => ({ ...prev, cpraConsent: e.target.checked }))}
                      className="mt-0.5 rounded" />
                    <span className="text-xs text-gray-400 leading-relaxed">
                      I consent to NovaMember processing my personal data to provide subscription services,
                      generate engagement scores, and send service communications. I understand my rights under
                      the California Privacy Rights Act (CPRA) including the right to access, delete, and opt-out
                      of sale of my data. <a href="/privacy" className="text-blue-400 underline">Privacy Policy</a>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.agreeMarketing}
                      onChange={e => setForm(prev => ({ ...prev, agreeMarketing: e.target.checked }))}
                      className="mt-0.5 rounded" />
                    <span className="text-xs text-gray-400">
                      I agree to receive marketing emails (optional — unsubscribe anytime)
                    </span>
                  </label>
                </div>

                <div className="flex gap-3 mt-6">
                  {!catalogMode && (
                    <button onClick={() => setStep('plan')}
                      className="flex-1 py-3 rounded-xl glass border border-white/10 text-gray-400 font-medium hover:text-white transition-colors">
                      Back
                    </button>
                  )}
                  <button onClick={() => setStep('confirm')}
                    disabled={!form.cpraConsent || !form.email || form.password.length < 8}
                    className="flex-[2] py-3 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-semibold hover:from-blue-500 hover:to-violet-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20">
                    Continue →
                  </button>
                </div>
                {(!form.cpraConsent || !form.email || form.password.length < 8) && (
                  <ul className="mt-3 space-y-1 text-xs text-amber-400/90">
                    {!form.email && <li>• Enter your email address</li>}
                    {form.password.length < 8 && <li>• Password must be at least 8 characters (currently {form.password.length})</li>}
                    {!form.cpraConsent && <li>• You must accept the CPRA consent checkbox to continue</li>}
                  </ul>
                )}
              </div>
            )}

            {/* Confirm → redirects to real Shopify checkout */}
            {step === 'confirm' && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-6">Confirm your order</h2>
                <div className="glass rounded-2xl border border-white/10 divide-y divide-white/5">
                  {[
                    { label: catalogMode ? 'Product' : 'Plan', value: plan.name },
                    { label: 'Billing', value: `$${plan.price}/month via Recharge` },
                    { label: 'Email', value: form.email || 'Not provided' },
                    { label: 'CPRA consent', value: form.cpraConsent ? '✓ Recorded' : '✗ Missing' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center px-5 py-4">
                      <span className="text-sm text-gray-400">{label}</span>
                      <span className="text-sm text-white font-medium">{value}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 p-4 rounded-xl glass border border-white/10 text-xs text-gray-500">
                  You'll enter your card on Shopify's secure hosted checkout next — we never see or store it here.
                  Shopify processes the payment itself; Recharge then manages the recurring billing schedule and
                  auto-renews monthly until you cancel from your dashboard.
                </div>

                {error && (
                  <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                    {error}
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <button onClick={() => setStep('account')}
                    className="flex-1 py-3 rounded-xl glass border border-white/10 text-gray-400 font-medium hover:text-white transition-colors">
                    Back
                  </button>
                  <button onClick={handleSubmit} disabled={loading}
                    className="flex-[2] py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 text-white font-semibold hover:from-emerald-500 hover:to-blue-500 transition-all disabled:opacity-70 shadow-lg shadow-emerald-500/20">
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Creating account...
                      </span>
                    ) : `Continue to secure checkout · $${plan.price}/mo`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Order summary sidebar */}
          <div className="hidden lg:block">
            <div className="glass rounded-2xl border border-white/10 p-6 sticky top-24">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">Order Summary</h3>
              <div className="mb-4">
                <p className="font-semibold text-white">{plan.name}{catalogMode ? '' : ' Plan'}</p>
                <p className="text-sm text-gray-500">Monthly subscription via Recharge</p>
              </div>
              {plan.features.length > 0 && (
                <div className="space-y-2 mb-4 text-sm">
                  {plan.features.map(f => (
                    <div key={f} className="flex items-center gap-2 text-gray-400">
                      <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {f}
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-white/10 pt-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-white">${plan.price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm mb-3">
                  <span className="text-gray-500">Tax</span>
                  <span className="text-white">$0.00</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-white">Total today</span>
                  <span className="text-white text-lg">${plan.price.toFixed(2)}</span>
                </div>
              </div>
              <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                🔒 Card entry happens on Shopify's hosted checkout
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading checkout…</p>
      </div>
    }>
      <CheckoutForm />
    </Suspense>
  )
}
