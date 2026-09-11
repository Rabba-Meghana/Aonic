# NovaMember

**AI-Powered Subscription Intelligence** — a production-grade membership platform built on Shopify, Recharge, and xAI Grok.

> Built by [Meghana Rabba](https://github.com/Rabba-Meghana) · [meghanarabba@gmail.com](mailto:meghanarabba@gmail.com)

---

## 📈 Design Targets

These are the outcomes the platform's architecture is designed to drive. Measured results depend on the merchant's baseline and implementation.

| Metric | Design goal |
|--------|-------------|
| Onboarding completion | +38% vs. time-based drip sequences |
| Churn rate | -34% via AI-triggered at-risk outreach |
| Time to first subscription | -57% via reduced friction checkout |
| Dunning support tickets | -59% via automated charge retry + webhook lifecycle |

The onboarding improvement is driven by three mechanisms:
1. **AI-powered nudge timing** — Grok scores member engagement in real time and triggers targeted emails at optimal moments (not time-based)
2. **XP-gamified task completion** — members earn points for each step, creating a compelling loop
3. **At-risk detection** — members with score < 35 after 48h get a personal outreach, not a generic drip

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js 14 (App Router)  ·  TypeScript  ·  Tailwind CSS       │
│                                                                  │
│  /                    Landing page (animated, pricing)          │
│  /products            Shopify storefront (subscribe & save)     │
│  /checkout            Multi-step Recharge checkout flow         │
│  /dashboard           Member portal (onboarding + AI score)     │
│  /admin               Analytics, webhooks, churn risk           │
│                                                                  │
│  API Routes                                                      │
│  POST   /api/auth/register      JWT auth + CPRA consent         │
│  POST   /api/auth/login         Timing-safe bcrypt compare      │
│  GET    /api/auth/shopify/install   Shopify OAuth step 1        │
│  GET    /api/auth/shopify/callback  Shopify OAuth step 2        │
│  POST   /api/checkout           Shopify + Recharge signup flow  │
│  GET    /api/subscriptions      Live subscription + charge data │
│  DELETE /api/subscriptions      Cancel via Recharge API         │
│  PATCH  /api/subscriptions      Pause / resume via Recharge     │
│  POST   /api/ai/score           Grok engagement scoring         │
│  POST   /api/evals              Unattended scoring eval run     │
│  GET    /api/evals              Last eval run report            │
│  POST   /api/webhooks/recharge  HMAC-verified webhook handler   │
│  POST   /api/webhooks/shopify   HMAC-verified webhook handler   │
│  GET    /api/compliance/data-export     CPRA DSAR               │
│  POST   /api/compliance/data-deletion   CPRA right to delete    │
│  PATCH  /api/onboarding         Task completion tracking        │
└─────────────────────────────────────────────────────────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        PostgreSQL    xAI          Recharge
        (Prisma ORM)  Grok API     API v1
              │
        Shopify
        Admin API + OAuth
```

---

## ⚡ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS + custom animations |
| Database | PostgreSQL 16 via Prisma ORM |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Subscriptions | Recharge API v1 |
| Ecommerce | Shopify Partner API + OAuth |
| AI Scoring | xAI Grok (grok-2-1212) |
| Logging | Winston (structured JSON) |
| Validation | Zod |
| Testing | Jest + ts-jest |
| Container | Docker + docker-compose |

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/Rabba-Meghana/Aonic.git
cd Aonic

# 2. Install dependencies
npm install

# 3. Environment variables
cp .env.example .env.local
# Fill in: DATABASE_URL, XAI_API_KEY, SHOPIFY_*, RECHARGE_*

# 4. Start PostgreSQL
docker-compose up postgres -d

# 5. Apply the real migration (see prisma/migrations/ — not just db push)
npm run db:deploy

# 6. Start dev server
npm run dev
# → http://localhost:3000
```

---

## 🔑 Key Design Decisions

### Recharge Webhook Security
Every webhook from Recharge is HMAC-verified before processing. The signature lives in `X-Recharge-Hmac-Sha256`, and we use `crypto.timingSafeEqual` to prevent timing attacks.

```typescript
// src/lib/recharge.ts
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const digest = crypto
    .createHmac('sha256', RECHARGE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(signature, 'hex'))
}
```

### Grok AI Engagement Scoring
Each member gets scored across 20+ behavioral signals. The AI returns a 0-100 score, a churn probability, and 3 actionable recommendations. Scores are persisted to `ai_score_logs` with token usage for cost tracking.

```typescript
// Tier thresholds
CHAMPION >= 80  →  "At-risk" emails never sent; upgrade offers instead
HOT      >= 60  →  Standard growth flows
WARM     >= 35  →  Nudge sequences activated
COLD     <  35  →  Personal outreach triggered within 24h
```

### CPRA Compliance
- **Consent at registration** — two consent types recorded (`data_processing`, `marketing`) with IP, user agent, and policy version
- **Data export** — `GET /api/compliance/data-export` returns everything we hold: profile, subscriptions, activity log, AI score history, third-party integrations
- **Right to deletion** — 45-day SLA per CPRA. We anonymize rather than hard-delete to preserve financial records, then wipe all PII fields
- **Full audit trail** — every consent change and deletion request is logged to `activity_events` with source and timestamp

### PostgreSQL Schema
Normalized to 3NF. Key indexes:
- `members(email)` — login lookup
- `activity_events(member_id, created_at DESC)` — engagement query
- `ai_score_logs(member_id, created_at DESC)` — history lookup
- `webhook_events(status, created_at)` — retry queue

---

## 📡 API Reference

### Auth

```
POST /api/auth/register
{
  "email": "user@example.com",
  "password": "securepass123",
  "firstName": "Alex",
  "lastName": "Chen",
  "cpraConsent": true,
  "marketingConsent": false
}
→ 201: { token, member }

POST /api/auth/login
{ "email": "...", "password": "..." }
→ 200: { token, member }
```

### AI Scoring

```
POST /api/ai/score
Authorization: Bearer <token>
→ {
    score: 85,
    tier: "CHAMPION",
    churnProbability30d: 0.082,
    reasoning: "...",
    recommendations: ["...", "...", "..."]
  }
```

### CPRA Compliance

```
GET  /api/compliance/data-export         Full DSAR data package
POST /api/compliance/data-deletion       Initiate 45-day deletion
DELETE /api/compliance/data-deletion?token=<token>  Execute deletion
```

### Webhooks

```
POST /api/webhooks/recharge
X-Recharge-Hmac-Sha256: <hmac>
X-Recharge-Topic: subscription/activated

Handled topics:
  subscription/activated
  subscription/cancelled
  charge/paid
  charge/failed
```

---

## 🧪 Tests

Unit tests (Jest):
```bash
npm test

# Coverage:
# ✓ Auth: password hashing, JWT sign/verify, timing-safe comparisons
# ✓ Recharge: HMAC signature verification, tamper detection
# ✓ Shopify: OAuth callback validation
# ✓ Engagement: tier assignment across full score range
# ✓ CPRA: 45-day window, token entropy
# ✓ Onboarding: completion percentage math
```

End-to-end tests (Playwright) — exercises the real UI against a real running server:
```bash
npx playwright install --with-deps chromium   # first time only
npm run test:e2e        # headless
npm run test:e2e:ui     # interactive UI mode

# Coverage:
# ✓ Landing page renders and CTA routes to checkout
# ✓ Checkout: full plan → account → confirm flow, then hands off to the
#   real checkoutUrl the API returns (no card fields anywhere in our own UI)
# ✓ Checkout: surfaces a clear error when Shopify isn't configured yet
# ✓ Dashboard: honest "not signed in" state — no hardcoded demo member
# ✓ Dashboard: renders real member/subscription data once authenticated
# ✓ Products: honest empty state vs. real synced products
```

---

## 📁 Project Structure

```
novamember/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Landing page
│   │   ├── products/page.tsx     # Shopify storefront
│   │   ├── checkout/page.tsx     # Recharge checkout
│   │   ├── dashboard/page.tsx    # Member portal
│   │   ├── admin/page.tsx        # Analytics
│   │   └── api/
│   │       ├── auth/             # JWT auth endpoints
│   │       ├── ai/               # Grok scoring
│   │       ├── webhooks/         # Recharge + Shopify
│   │       ├── compliance/       # CPRA DSAR + deletion
│   │       ├── products/         # Product catalog
│   │       └── onboarding/       # Task tracking
│   └── lib/
│       ├── auth.ts               # JWT + bcrypt
│       ├── grok.ts               # xAI Grok client (OpenAI-compatible SDK)
│       ├── recharge.ts           # Recharge API client
│       ├── shopify.ts            # Shopify OAuth + API
│       ├── db.ts                 # Prisma client
│       └── logger.ts             # Winston
├── prisma/schema.prisma          # Full database schema
├── prisma/migrations/            # Real Prisma migration history (source of truth)
├── tests/api.test.ts             # Jest test suite
├── docker-compose.yml
└── .env.example
```

---

## 🌐 Deploy

```bash
# Vercel (recommended)
vercel --prod

# Docker
docker-compose up --build

# Environment checklist:
# ✓ DATABASE_URL (Neon, Supabase, or Railway — Postgres)
# ✓ XAI_API_KEY
# ✓ SHOPIFY_API_KEY + SHOPIFY_API_SECRET
# ✓ RECHARGE_API_KEY + RECHARGE_WEBHOOK_SECRET
# ✓ JWT_SECRET (min 32 chars)
# ✓ UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
```

---

*Built with Next.js 14, Prisma, xAI Grok, and ❤️*
