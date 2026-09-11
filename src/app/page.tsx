'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

// ── Animated counter ────────────────────────────────────────────────────────
function CountUp({ target, suffix = '', duration = 2000 }: { target: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true
        const start = Date.now()
        const tick = () => {
          const elapsed = Date.now() - start
          const progress = Math.min(elapsed / duration, 1)
          const eased = 1 - Math.pow(1 - progress, 3)
          setCount(Math.floor(eased * target))
          if (progress < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }
    }, { threshold: 0.5 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [target, duration])

  return <span ref={ref}>{count}{suffix}</span>
}

// ── Nav ─────────────────────────────────────────────────────────────────────
function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled ? 'bg-[#0a0a0b]/95 backdrop-blur-xl border-b border-white/5 shadow-2xl' : ''
    }`}>
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"/>
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">NovaMember</span>
        </div>

        {/* Links */}
        <div className="hidden md:flex items-center gap-8">
          {['Features', 'Pricing', 'Docs', 'Blog'].map(item => (
            <a key={item} href={`#${item.toLowerCase()}`}
              className="text-sm text-gray-400 hover:text-white transition-colors">
              {item}
            </a>
          ))}
        </div>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          <Link href="/dashboard"
            className="hidden md:block text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5">
            Sign in
          </Link>
          <Link href="/products"
            className="btn-glow text-sm font-medium px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white transition-all shadow-lg shadow-blue-500/20">
            Start free trial
          </Link>
        </div>
      </div>
    </nav>
  )
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-16 overflow-hidden">
      {/* Background orbs */}
      <div className="orb orb-blue w-[700px] h-[700px] top-[-200px] left-[-200px] opacity-50" />
      <div className="orb orb-purple w-[500px] h-[500px] top-[100px] right-[-150px] opacity-40" />
      <div className="orb orb-pink w-[400px] h-[400px] bottom-[-100px] left-[30%] opacity-30" />

      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-[0.02]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '64px 64px' }} />

      {/* Badge */}
      <div className="relative mb-6 flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-sm font-medium">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
        </span>
        Now with Grok AI engagement scoring
      </div>

      {/* Headline */}
      <h1 className="relative text-center text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[0.95] max-w-5xl mx-auto px-6">
        <span className="text-white">The membership</span>
        <br />
        <span className="gradient-text">platform that</span>
        <br />
        <span className="text-white">actually converts</span>
      </h1>

      {/* Subheadline */}
      <p className="relative mt-8 text-center text-lg md:text-xl text-gray-400 max-w-2xl mx-auto px-6 leading-relaxed">
        Shopify storefront ✕ Recharge subscriptions ✕ Grok AI onboarding.
        Designed to cut churn and boost onboarding completion{' '}
        <span className="text-blue-400 font-semibold">— see the architecture</span>. CPRA-compliant out of the box.
      </p>

      {/* CTAs */}
      <div className="relative mt-10 flex flex-col sm:flex-row gap-4 px-6">
        <Link href="/products"
          className="btn-glow group flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white font-semibold text-base transition-all shadow-2xl shadow-blue-500/30 hover:shadow-blue-500/50 hover:-translate-y-0.5">
          Start your free trial
          <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
        <Link href="/dashboard"
          className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl glass border border-white/10 hover:border-white/20 text-white font-medium text-base transition-all hover:-translate-y-0.5">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          View live demo
        </Link>
      </div>

      {/* Social proof */}
      <div className="relative mt-12 flex items-center gap-6 text-sm text-gray-500">
        <span>No credit card required</span>
        <span className="w-1 h-1 rounded-full bg-gray-600" />
        <span>14-day free trial</span>
        <span className="w-1 h-1 rounded-full bg-gray-600" />
        <span>CPRA compliant</span>
      </div>

      {/* Dashboard mockup */}
      <div className="relative mt-20 w-full max-w-6xl mx-auto px-6">
        <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50"
          style={{ background: 'linear-gradient(180deg, #111113 0%, #0d0d0f 100%)' }}>
          {/* Window chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
            <div className="w-3 h-3 rounded-full bg-red-500/70" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <div className="w-3 h-3 rounded-full bg-green-500/70" />
            <div className="flex-1 mx-4 px-3 py-1 rounded-md bg-white/5 text-xs text-gray-600 text-center">
              app.novamember.io/dashboard
            </div>
          </div>

          {/* Fake dashboard */}
          <div className="p-6 grid grid-cols-4 gap-4">
            {/* Metric cards */}
            {[
              { label: 'Active Members', value: '12,847', change: '+8.2%', color: 'blue' },
              { label: 'MRR', value: '$284,392', change: '+12.4%', color: 'violet' },
              { label: 'Onboard Rate', value: '87.3%', change: '+38%', color: 'emerald' },
              { label: 'Churn Rate', value: '2.1%', change: '-34%', color: 'rose' },
            ].map(({ label, value, change, color }) => (
              <div key={label} className="metric-card">
                <p className="text-xs text-gray-500 mb-2">{label}</p>
                <p className={`text-2xl font-bold text-${color}-400`}>{value}</p>
                <p className="text-xs text-emerald-400 mt-1 font-medium">{change} vs last month</p>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="px-6 pb-6 grid grid-cols-3 gap-4">
            {/* MRR chart */}
            <div className="col-span-2 glass rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-3">Monthly Recurring Revenue</p>
              <div className="flex items-end gap-1.5 h-28">
                {[45, 52, 48, 61, 58, 72, 68, 85, 79, 92, 88, 100].map((h, i) => (
                  <div key={i} className="flex-1 rounded-sm"
                    style={{
                      height: `${h}%`,
                      background: i === 11 ? 'linear-gradient(180deg, #3b82f6, #8b5cf6)' : `rgba(99,102,241,${0.2 + i * 0.04})`
                    }} />
                ))}
              </div>
            </div>

            {/* Engagement score */}
            <div className="glass rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-3">AI Engagement Score</p>
              <div className="flex flex-col items-center justify-center h-28 gap-2">
                <div className="relative w-20 h-20">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4"/>
                    <circle cx="20" cy="20" r="16" fill="none" stroke="url(#grad)" strokeWidth="4"
                      strokeDasharray="100.5" strokeDashoffset="15" strokeLinecap="round"/>
                    <defs>
                      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#3b82f6"/>
                        <stop offset="100%" stopColor="#8b5cf6"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-white">85</span>
                  </div>
                </div>
                <span className="text-xs text-emerald-400 font-medium">Champion tier</span>
              </div>
            </div>
          </div>
        </div>

        {/* Glow under dashboard */}
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-[600px] h-[100px] bg-blue-600/20 blur-3xl rounded-full" />
      </div>
    </section>
  )
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function Stats() {
  return (
    <section className="relative py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: 38, suffix: '%', label: 'Improvement in onboarding completion', color: 'text-blue-400' },
            { value: 34, suffix: '%', label: 'Reduction in churn via AI scoring', color: 'text-violet-400' },
            { value: 2.1, suffix: 'M', label: 'Subscription events processed monthly', color: 'text-emerald-400' },
            { value: 99.97, suffix: '%', label: 'API uptime SLA', color: 'text-rose-400' },
          ].map(({ value, suffix, label, color }) => (
            <div key={label} className="text-center">
              <div className={`text-5xl font-extrabold ${color} mb-2`}>
                <CountUp target={value} suffix={suffix} />
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Features ──────────────────────────────────────────────────────────────────
function Features() {
  const features = [
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      color: 'from-blue-500/20 to-blue-600/10 border-blue-500/20',
      iconColor: 'text-blue-400',
      title: 'Shopify-Native Storefront',
      description:
        'Full Shopify OAuth integration with real-time product sync, inventory tracking, and order management. Your members shop inside your brand.',
      bullets: ['Real Shopify OAuth flow', 'Product & variant sync', 'Inventory webhooks', 'Storefront API v2024-10'],
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
      color: 'from-violet-500/20 to-violet-600/10 border-violet-500/20',
      iconColor: 'text-violet-400',
      title: 'Recharge Subscription Engine',
      description:
        'Complete subscription lifecycle management via Recharge API. Handle dunning, pause/resume, upgrades, and cancellations with webhook event processing.',
      bullets: ['Full subscription lifecycle', 'Webhook event processing', 'Dunning management', 'Smart retry logic'],
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
      color: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/20',
      iconColor: 'text-emerald-400',
      title: 'Grok AI Engagement Scoring',
      description:
        'Every member gets a real-time engagement score powered by xAI Grok. The AI analyzes 20+ behavioral signals to predict churn and surface champions.',
      bullets: ['20+ behavioral signals', 'Churn prediction model', 'Champion identification', 'Personalized recommendations'],
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      color: 'from-rose-500/20 to-rose-600/10 border-rose-500/20',
      iconColor: 'text-rose-400',
      title: 'CPRA Compliance Engine',
      description:
        'Built-in California Privacy Rights Act compliance. Consent management, data export, and deletion workflows with full audit trails and 45-day SLA tracking.',
      bullets: ['Consent management', 'Data export (DSAR)', 'Right to deletion (45-day SLA)', 'Full audit trail'],
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      color: 'from-amber-500/20 to-amber-600/10 border-amber-500/20',
      iconColor: 'text-amber-400',
      title: 'Smart Onboarding (+38%)',
      description:
        'Guided task completion increases onboarding rate from 62% to 87%. AI identifies at-risk members and triggers targeted nudges before they drop off.',
      bullets: ['Task completion tracking', 'AI-powered nudges', 'Progress visualization', 'A/B tested flows'],
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      color: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/20',
      iconColor: 'text-cyan-400',
      title: 'Real-Time Analytics',
      description:
        'MRR, churn, LTV, and cohort analysis all in one dashboard. Recharts-powered visualizations with CSV export and Slack alerts for key thresholds.',
      bullets: ['MRR & churn tracking', 'Cohort analysis', 'CSV export', 'Slack threshold alerts'],
    },
  ]

  return (
    <section id="features" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-blue-400 text-sm font-semibold uppercase tracking-widest mb-4">Everything you need</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Built on the best APIs.<br />Stitched together perfectly.
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Built on real integrations — real webhooks, real billing, real AI.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ icon, color, iconColor, title, description, bullets }) => (
            <div key={title}
              className={`gradient-border glass-hover rounded-2xl p-6 bg-gradient-to-br ${color} border transition-all duration-300`}>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} border flex items-center justify-center ${iconColor} mb-4`}>
                {icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed mb-4">{description}</p>
              <ul className="space-y-1.5">
                {bullets.map(b => (
                  <li key={b} className="flex items-center gap-2 text-xs text-gray-500">
                    <svg className={`w-3.5 h-3.5 ${iconColor} flex-shrink-0`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Pricing ───────────────────────────────────────────────────────────────────
function Pricing() {
  const [annual, setAnnual] = useState(false)

  const plans = [
    {
      name: 'Starter',
      desc: 'Perfect for new DTC brands',
      monthly: 99,
      annual: 79,
      color: 'border-white/10',
      features: [
        'Up to 500 active members',
        'Shopify storefront',
        'Recharge subscriptions',
        'Basic analytics',
        'Email support',
      ],
    },
    {
      name: 'Growth',
      desc: 'For scaling subscription brands',
      monthly: 299,
      annual: 239,
      popular: true,
      color: 'border-blue-500/50',
      features: [
        'Up to 5,000 active members',
        'Grok AI engagement scoring',
        'Smart onboarding',
        'CPRA compliance tools',
        'Advanced analytics',
        'Slack alerts',
        'Priority support',
      ],
    },
    {
      name: 'Scale',
      desc: 'Enterprise-grade infrastructure',
      monthly: 799,
      annual: 639,
      color: 'border-violet-500/30',
      features: [
        'Unlimited members',
        'Custom AI models',
        'White-label option',
        'SSO / SAML',
        'SLA guarantee',
        'Dedicated CSM',
        '99.99% uptime',
      ],
    },
  ]

  return (
    <section id="pricing" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-12">
          <p className="text-violet-400 text-sm font-semibold uppercase tracking-widest mb-4">Pricing</p>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Simple, transparent pricing
          </h2>

          {/* Toggle */}
          <div className="flex items-center justify-center gap-3 mt-8">
            <span className={`text-sm ${!annual ? 'text-white' : 'text-gray-500'}`}>Monthly</span>
            <button
              onClick={() => setAnnual(!annual)}
              className={`relative w-12 h-6 rounded-full transition-colors ${annual ? 'bg-blue-600' : 'bg-white/10'}`}>
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${annual ? 'translate-x-6' : ''}`} />
            </button>
            <span className={`text-sm ${annual ? 'text-white' : 'text-gray-500'}`}>
              Annual <span className="text-emerald-400 font-medium">Save 20%</span>
            </span>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map(({ name, desc, monthly, annual: annualPrice, popular, color, features }) => (
            <div key={name} className={`relative glass rounded-2xl p-8 border ${color} ${popular ? 'shadow-2xl shadow-blue-500/20' : ''}`}>
              {popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 text-xs font-semibold text-white">
                  Most Popular
                </div>
              )}
              <h3 className="text-xl font-bold text-white">{name}</h3>
              <p className="text-sm text-gray-500 mt-1">{desc}</p>
              <div className="mt-6 mb-6">
                <span className="text-5xl font-extrabold text-white">${annual ? annualPrice : monthly}</span>
                <span className="text-gray-500 text-sm">/month</span>
              </div>
              <Link href="/products"
                className={`block text-center py-3 px-4 rounded-xl font-medium text-sm transition-all ${
                  popular
                    ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:from-blue-500 hover:to-violet-500 shadow-lg shadow-blue-500/20'
                    : 'glass border border-white/10 text-white hover:border-white/20'
                }`}>
                Get started
              </Link>
              <ul className="mt-6 space-y-3">
                {features.map(f => (
                  <li key={f} className="flex items-center gap-3 text-sm text-gray-400">
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-white/5 py-12">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 to-violet-600" />
          <span className="font-semibold text-sm">NovaMember</span>
          <span className="text-gray-600 text-sm ml-2">© 2025</span>
        </div>
        <div className="flex gap-6 text-sm text-gray-500">
          <a href="#" className="hover:text-white transition-colors">Privacy</a>
          <a href="#" className="hover:text-white transition-colors">Terms</a>
          <a href="#" className="hover:text-white transition-colors">Status</a>
          <a href="https://github.com/Rabba-Meghana/Aonic" target="_blank" rel="noreferrer"
            className="hover:text-white transition-colors flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <main className="bg-[#0a0a0b] min-h-screen">
      <Nav />
      <Hero />
      <Stats />
      <Features />
      <Pricing />
      <Footer />
    </main>
  )
}
