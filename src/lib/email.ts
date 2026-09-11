/**
 * NovaMember — Transactional Email Service
 *
 * Sends lifecycle emails via Resend (resend.com).
 * Falls back to structured logging in development / when RESEND_API_KEY is absent.
 *
 * Email events:
 *   welcome            — new member created
 *   subscription_started  — first charge confirmed
 *   subscription_cancelled — member or admin cancelled
 *   charge_failed      — dunning notification
 *   charge_recovered   — payment recovered after failure
 *   at_risk_outreach   — COLD tier personal outreach
 *   data_export_ready  — CPRA DSAR completed
 *   deletion_scheduled — CPRA deletion in 45 days
 */

import { logger } from './logger'

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
const FROM_ADDRESS   = process.env.EMAIL_FROM ?? 'NovaMember <hello@novamember.io>'
const APP_URL        = process.env.NEXTAUTH_URL ?? 'https://novamember.io'

interface EmailPayload {
  to:      string
  subject: string
  html:    string
  text?:   string
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!RESEND_API_KEY) {
    logger.info('[email:dev] Would send email', {
      to:      payload.to,
      subject: payload.subject,
    })
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    FROM_ADDRESS,
      to:      [payload.to],
      subject: payload.subject,
      html:    payload.html,
      text:    payload.text,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend API error ${response.status}: ${body}`)
  }

  logger.info('Email sent', { to: payload.to, subject: payload.subject })
}

// ── Email templates ───────────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  to: string
  firstName: string
  planName: string
}): Promise<void> {
  await sendEmail({
    to:      params.to,
    subject: `Welcome to NovaMember, ${params.firstName} 🎉`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:40px 24px">
        <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:12px;padding:32px;text-align:center;margin-bottom:32px">
          <h1 style="color:white;margin:0;font-size:28px">Welcome to NovaMember</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0">Your ${params.planName} subscription is active</p>
        </div>
        <p style="color:#374151;font-size:16px">Hi ${params.firstName},</p>
        <p style="color:#374151">Your account is ready. Head to your dashboard to complete onboarding and connect your Shopify store.</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${APP_URL}/dashboard" style="background:#2563eb;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
            Go to dashboard →
          </a>
        </div>
        <p style="color:#9ca3af;font-size:14px">Questions? Reply to this email — we read every one.</p>
      </div>
    `,
    text: `Hi ${params.firstName}, welcome to NovaMember. Your ${params.planName} subscription is active. Dashboard: ${APP_URL}/dashboard`,
  })
}

export async function sendSubscriptionStartedEmail(params: {
  to: string
  firstName: string
  planName: string
  amount: number
  nextBillingDate: string
  rechargeSubscriptionId?: string
}): Promise<void> {
  await sendEmail({
    to:      params.to,
    subject: `Your ${params.planName} subscription is live`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:40px 24px">
        <h2 style="color:#111827">Subscription confirmed ✓</h2>
        <p style="color:#374151">Hi ${params.firstName}, your first charge of <strong>$${params.amount}</strong> has been processed via Recharge.</p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0">
          <tr><td style="padding:10px 0;color:#6b7280;border-bottom:1px solid #f3f4f6">Plan</td><td style="padding:10px 0;font-weight:600;color:#111827;text-align:right">${params.planName}</td></tr>
          <tr><td style="padding:10px 0;color:#6b7280;border-bottom:1px solid #f3f4f6">Amount</td><td style="padding:10px 0;font-weight:600;color:#111827;text-align:right">$${params.amount}/month</td></tr>
          <tr><td style="padding:10px 0;color:#6b7280;border-bottom:1px solid #f3f4f6">Next billing</td><td style="padding:10px 0;font-weight:600;color:#111827;text-align:right">${params.nextBillingDate}</td></tr>
          ${params.rechargeSubscriptionId ? `<tr><td style="padding:10px 0;color:#6b7280">Subscription ID</td><td style="padding:10px 0;font-family:monospace;color:#6b7280;text-align:right">${params.rechargeSubscriptionId}</td></tr>` : ''}
        </table>
        <a href="${APP_URL}/dashboard" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Manage subscription →</a>
      </div>
    `,
  })
}

export async function sendChargeFailed(params: {
  to: string
  firstName: string
  amount: number
  failureReason?: string
  retryDate?: string
}): Promise<void> {
  await sendEmail({
    to:      params.to,
    subject: `Action needed: payment of $${params.amount} failed`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:40px 24px">
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px">
          <p style="color:#dc2626;margin:0;font-weight:600">⚠️ Payment failed</p>
        </div>
        <p style="color:#374151">Hi ${params.firstName}, we were unable to process your payment of <strong>$${params.amount}</strong>.</p>
        ${params.failureReason ? `<p style="color:#6b7280;font-size:14px">Reason: ${params.failureReason}</p>` : ''}
        <p style="color:#374151">Please update your payment method to keep your subscription active${params.retryDate ? `. We'll retry on <strong>${params.retryDate}</strong>` : ''}.</p>
        <a href="${APP_URL}/dashboard?tab=billing" style="background:#dc2626;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Update payment method →</a>
      </div>
    `,
  })
}

export async function sendChargeRecovered(params: {
  to: string
  firstName: string
  amount: number
}): Promise<void> {
  await sendEmail({
    to:      params.to,
    subject: `Payment recovered — you're all set ✓`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:40px 24px">
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin-bottom:24px">
          <p style="color:#16a34a;margin:0;font-weight:600">✓ Payment successful</p>
        </div>
        <p style="color:#374151">Hi ${params.firstName}, your payment of <strong>$${params.amount}</strong> was successfully processed. Your subscription is fully active.</p>
        <a href="${APP_URL}/dashboard" style="background:#16a34a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Go to dashboard →</a>
      </div>
    `,
  })
}

export async function sendAtRiskOutreach(params: {
  to: string
  firstName: string
  score: number
  recommendations: string[]
}): Promise<void> {
  await sendEmail({
    to:      params.to,
    subject: `${params.firstName}, we want to help`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:40px 24px">
        <p style="color:#374151;font-size:16px">Hi ${params.firstName},</p>
        <p style="color:#374151">I noticed you haven't gotten the most out of NovaMember yet, and I wanted to reach out personally.</p>
        <p style="color:#374151">Here are three things that would make the biggest difference for you right now:</p>
        <ul style="color:#374151;padding-left:20px;line-height:2">
          ${params.recommendations.map(r => `<li>${r}</li>`).join('')}
        </ul>
        <p style="color:#374151">Can I set up 15 minutes to walk you through your setup? Just reply to this email.</p>
        <div style="margin:32px 0">
          <a href="${APP_URL}/dashboard" style="background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Resume onboarding →</a>
        </div>
        <p style="color:#9ca3af;font-size:14px">— The NovaMember team<br/>This is a personal email, not an automated drip. Reply any time.</p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(params: {
  to: string
  firstName: string
  resetUrl: string
}): Promise<void> {
  await sendEmail({
    to:      params.to,
    subject: 'Reset your NovaMember password',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:40px 24px">
        <h2 style="color:#111827">Reset your password</h2>
        <p style="color:#374151">Hi ${params.firstName}, we received a request to reset your NovaMember password. This link expires in 30 minutes.</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${params.resetUrl}" style="background:#2563eb;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
            Reset password →
          </a>
        </div>
        <p style="color:#9ca3af;font-size:14px">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      </div>
    `,
    text: `Reset your NovaMember password: ${params.resetUrl} (expires in 30 minutes). If you didn't request this, ignore this email.`,
  })
}

export async function sendSubscriptionCancelledEmail(params: {
  to: string
  firstName: string
  planName: string
  accessEndsAt: string
}): Promise<void> {
  await sendEmail({
    to:      params.to,
    subject: `Your ${params.planName} subscription has been cancelled`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:40px 24px">
        <h2 style="color:#111827">Subscription cancelled</h2>
        <p style="color:#374151">Hi ${params.firstName}, your ${params.planName} subscription has been cancelled.</p>
        <p style="color:#374151">You'll retain full access until <strong>${params.accessEndsAt}</strong>.</p>
        <p style="color:#374151">If this was a mistake, you can reactivate at any time from your dashboard.</p>
        <a href="${APP_URL}/dashboard" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Reactivate →</a>
      </div>
    `,
  })
}
