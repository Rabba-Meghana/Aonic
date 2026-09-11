'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ApiVariant {
  id: string
  title: string
  price: string
  compareAtPrice?: string | null
}

interface ApiSubscriptionPlan {
  id: string
  name: string
  price: string
  billingCycle: string
  features: string[]
  isPopular: boolean
}

interface ApiProduct {
  id: string
  title: string
  description: string | null
  vendor: string | null
  tags: string[]
  imageUrl: string | null
  variants: ApiVariant[]
  subscriptionPlans: ApiSubscriptionPlan[]
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ApiProduct[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTag, setSelectedTag] = useState('all')
  const [billingType, setBillingType] = useState<'subscribe' | 'onetime'>('subscribe')
  const [cart, setCart] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/products')
      .then(res => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json()
      })
      .then(data => { if (!cancelled) setProducts(data.products ?? []) })
      .catch(err => { if (!cancelled) setError(String(err)) })
    return () => { cancelled = true }
  }, [])

  const allTags = Array.from(new Set((products ?? []).flatMap(p => p.tags))).sort()
  const filtered = !products
    ? []
    : selectedTag === 'all'
      ? products
      : products.filter(p => p.tags.includes(selectedTag))

  const addToCart = (id: string) => {
    setCart(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b]">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-[#0a0a0b]/95 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600" />
            <span className="font-bold">NovaMember</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
              My Account
            </Link>
            <button className="relative text-sm text-gray-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              {cart.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-600 text-[9px] flex items-center justify-center text-white font-bold">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 text-sm text-blue-400 font-medium mb-3">
            <span className={`status-dot ${products ? 'status-dot-green' : 'status-dot-amber'}`} />
            {products === null
              ? 'Loading from your database…'
              : `Synced from Shopify · ${products.length} product${products.length === 1 ? '' : 's'}`}
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">Shop & Subscribe</h1>
          <p className="text-gray-400">Subscribe & save on every box. Cancel, pause, or change anytime.</p>
        </div>

        {error && (
          <div className="mb-8 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            Couldn't load products: {error}
          </div>
        )}

        {products && products.length === 0 && !error && (
          <div className="p-8 rounded-2xl glass border border-white/10 text-center">
            <p className="text-white font-semibold mb-2">No products yet</p>
            <p className="text-sm text-gray-500">
              This reads live from your Postgres <code className="text-blue-400">products</code> table — it's empty
              because no Shopify product has synced in yet. Connect a real Shopify store and the{' '}
              <code className="text-blue-400">products/update</code> webhook will populate this automatically.
            </p>
          </div>
        )}

        {products && products.length > 0 && (
          <>
            {/* Billing toggle */}
            <div className="flex items-center gap-3 mb-8 p-1 glass rounded-xl w-fit border border-white/10">
              {(['subscribe', 'onetime'] as const).map(type => (
                <button key={type} onClick={() => setBillingType(type)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    billingType === type
                      ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg'
                      : 'text-gray-400 hover:text-white'
                  }`}>
                  {type === 'subscribe' ? '🔄 Subscribe & Save' : '🛒 One-time Purchase'}
                </button>
              ))}
            </div>

            {/* Tag filter */}
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-8">
                {['all', ...allTags].map(tag => (
                  <button key={tag} onClick={() => setSelectedTag(tag)}
                    className={`px-4 py-1.5 rounded-full text-sm capitalize transition-all border ${
                      selectedTag === tag
                        ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
                        : 'border-white/10 text-gray-500 hover:text-white hover:border-white/20'
                    }`}>
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {/* Product grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map(product => {
                const variant = product.variants[0]
                const plan = product.subscriptionPlans[0]
                const basePrice = variant ? parseFloat(variant.price) : (plan ? parseFloat(plan.price) : 0)
                const compareAt = variant?.compareAtPrice ? parseFloat(variant.compareAtPrice) : null
                const inCart = cart.includes(product.id)

                return (
                  <div key={product.id} className="glass glass-hover rounded-2xl overflow-hidden border border-white/8 group">
                    {/* Image */}
                    <div className="relative overflow-hidden h-48 bg-white/5">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt={product.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-700 text-4xl">📦</div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                      {product.tags.length > 0 && (
                        <div className="absolute top-3 left-3 flex gap-1.5">
                          {product.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-white/10 text-white backdrop-blur-sm">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-5">
                      <h3 className="font-semibold text-white text-base leading-tight mb-1">{product.title}</h3>
                      {product.vendor && <p className="text-xs text-gray-600 mb-3">{product.vendor}</p>}

                      {product.description && (
                        <p className="text-sm text-gray-500 mb-4 leading-relaxed line-clamp-2">{product.description}</p>
                      )}

                      {/* Price */}
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <span className="text-2xl font-bold text-white">${basePrice.toFixed(2)}</span>
                          {compareAt && (
                            <span className="text-sm text-gray-600 line-through ml-2">${compareAt.toFixed(2)}</span>
                          )}
                          <p className="text-xs text-gray-500 mt-0.5">
                            {billingType === 'subscribe' ? '/ month, cancel anytime' : 'one-time charge'}
                          </p>
                        </div>
                      </div>

                      {billingType === 'subscribe' && plan && (
                        <div className="mb-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/15 text-xs text-gray-500">
                          <p className="text-blue-400 font-medium mb-1">Powered by Recharge</p>
                          <p>{plan.billingCycle.toLowerCase()} billing · Pause or cancel in dashboard</p>
                        </div>
                      )}

                      <Link
                        href={`/checkout?productId=${encodeURIComponent(product.id)}&title=${encodeURIComponent(product.title)}&price=${basePrice}`}
                        onClick={() => addToCart(product.id)}
                        className={`block text-center w-full py-3 px-4 rounded-xl text-sm font-semibold transition-all ${
                          inCart
                            ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-400'
                            : 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-500/20'
                        }`}>
                        {inCart ? '✓ Added — go to checkout' : billingType === 'subscribe' ? 'Subscribe & Save' : 'Add to Cart'}
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
