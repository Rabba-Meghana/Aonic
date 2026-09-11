import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0b] px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300 mb-8 inline-block">← Back to NovaMember</Link>
        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated September 2026</p>

        <div className="prose prose-invert text-gray-400 text-sm leading-relaxed space-y-6">
          <p>
            NovaMember is a demonstration project. This page describes, honestly, what data the app
            actually collects and how it&apos;s used — it is not a substitute for legal counsel, and this
            project is not currently processing real customer data in production.
          </p>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">What we collect</h2>
            <p>
              When you create an account through checkout, we store your name, email address, a hashed
              password (never plaintext), and any Shopify/Recharge customer IDs generated during
              checkout. We also log activity events (signup, login, checkout) with your IP address and
              user agent for security and debugging purposes.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">CPRA rights</h2>
            <p>
              Consistent with the California Privacy Rights Act, you can request a full export of your
              data or request deletion of your account at any time from your dashboard. Deletion
              requests are logged with a verification token and a scheduled completion date, per the
              45-day window CPRA allows.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">Third parties</h2>
            <p>
              Payment is processed entirely by Shopify&apos;s hosted checkout — we never see or store your
              card details. Subscription billing is managed by Recharge. Engagement scoring, when
              enabled, sends behavioral signals (not raw personal data) to xAI&apos;s Grok API.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">Contact</h2>
            <p>
              This is a portfolio/demo project. For questions about this specific implementation,
              reach out via the GitHub repository linked in the footer.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
