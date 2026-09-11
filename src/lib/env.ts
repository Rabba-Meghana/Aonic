/**
 * NovaMember — Environment Validation
 *
 * Validates all required environment variables at startup.
 * The server fails fast with a clear error rather than silently
 * using empty strings or undefined values in production.
 *
 * Import this at the top of any lib that uses env vars.
 */

import { z } from 'zod'

const envSchema = z.object({
  // App
  NODE_ENV:       z.enum(['development', 'test', 'production']).default('development'),
  NEXTAUTH_URL:   z.string().url(),

  // Database
  DATABASE_URL:   z.string().min(1),

  // Auth
  JWT_SECRET:     z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // xAI (Grok)
  XAI_API_KEY: z.string().startsWith('xai-'),

  // Shopify
  SHOPIFY_API_KEY:    z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),

  // Recharge
  RECHARGE_API_KEY:        z.string().min(1),
  RECHARGE_WEBHOOK_SECRET: z.string().min(1),

  // Optional — fail gracefully when absent, not at startup
  SHOPIFY_STORE_DOMAIN:        z.string().optional(),
  SHOPIFY_STORE_ACCESS_TOKEN:  z.string().optional(),
  SHOPIFY_VARIANT_STARTER:     z.string().optional(),
  SHOPIFY_VARIANT_GROWTH:      z.string().optional(),
  SHOPIFY_VARIANT_SCALE:       z.string().optional(),
  CRON_SECRET:                 z.string().optional(),
  LOG_LEVEL:                   z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  RESEND_API_KEY:              z.string().optional(),
  EMAIL_FROM:                  z.string().email().optional(),
  SENTRY_DSN:                  z.string().url().optional(),
})

type Env = z.infer<typeof envSchema>

function validateEnv(): Env {
  // In test environment relax validation — only validate keys that are present
  if (process.env.NODE_ENV === 'test') {
    return envSchema.partial().parse(process.env) as Env
  }

  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const missing = result.error.issues.map(i => `  ✗ ${i.path.join('.')}: ${i.message}`)
    throw new Error(
      `\n\nEnvironment validation failed — fix these before starting the server:\n${missing.join('\n')}\n\nSee .env.example for all required variables.\n`,
    )
  }

  return result.data
}

// Singleton — validated once at module load, cached thereafter
let _env: Env | null = null

export function env(): Env {
  if (!_env) _env = validateEnv()
  return _env
}

// Re-export individual vars for convenient destructuring
export const {
  NODE_ENV,
} = process.env
