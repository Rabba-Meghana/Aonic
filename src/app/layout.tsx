import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NovaMember — AI-Powered Subscription Intelligence',
  description:
    'The membership platform that converts. Powered by Shopify, Recharge, and Grok AI. CPRA-compliant. Built for growth.',
  keywords: ['membership', 'subscriptions', 'Shopify', 'Recharge', 'AI', 'CPRA'],
  openGraph: {
    title: 'NovaMember',
    description: 'AI-Powered Subscription Intelligence',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0a0a0b] text-white antialiased">
        {children}
      </body>
    </html>
  )
}
