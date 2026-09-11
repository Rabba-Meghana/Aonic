import { defineConfig, devices } from '@playwright/test'

/**
 * NovaMember E2E config.
 *
 * These tests exercise the real UI against a real running Next.js server —
 * `npm run dev` is started automatically. They do NOT depend on a live
 * Shopify/Recharge account: network calls to our own API routes are mocked
 * with page.route() where the assertion is about our UI's behavior (does it
 * redirect correctly, does it show the right error), not about a third
 * party's live system. That's a deliberate choice: testing "does clicking
 * Subscribe correctly redirect to whatever checkoutUrl our API returns" is
 * a real, valuable, deterministic test; testing against a live Shopify store
 * in CI would be flaky and require real secrets in the pipeline.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
