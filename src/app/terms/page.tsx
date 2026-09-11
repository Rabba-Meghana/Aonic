import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0b] px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300 mb-8 inline-block">← Back to NovaMember</Link>
        <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated September 2026</p>

        <div className="prose prose-invert text-gray-400 text-sm leading-relaxed space-y-6">
          <p>
            NovaMember is a demonstration project built to show a real, working Shopify + Recharge
            membership integration. It is not a commercial product, and these terms exist mainly to be
            transparent about that.
          </p>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">What this is</h2>
            <p>
              An account created here is real (backed by a real database) but the underlying store is a
              Shopify development store. Any checkout you complete goes through Shopify&apos;s real, hosted
              checkout flow, but purchases may be limited by the development store&apos;s configuration
              (for example, live payment capture requires a paid Shopify plan, which this demo store is
              not on).
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">No warranty</h2>
            <p>
              This software is provided as-is, without warranty of any kind, for demonstration and
              evaluation purposes.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">Your data</h2>
            <p>
              See the <Link href="/privacy" className="text-blue-400 underline">Privacy Policy</Link> for
              details on what&apos;s collected and your rights to export or delete it.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
