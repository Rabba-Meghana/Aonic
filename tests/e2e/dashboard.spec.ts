import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('shows an honest "not signed in" state instead of fake demo data', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByText(/you're not signed in/i)).toBeVisible()
    // Regression guard: this page used to hardcode a fictional member
    // ("Alex Chen", mem_01Jx9zK3) regardless of auth state.
    await expect(page.getByText('Alex Chen')).toHaveCount(0)
    await expect(page.getByText('mem_01Jx9zK3')).toHaveCount(0)
  })

  test('renders real member data when a valid session exists', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('nm_token', 'e2e-fake-token')
    })

    await page.route('**/api/auth/me', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        member: {
          id: 'mem_e2e', email: 'e2e@example.com', firstName: 'Playwright', lastName: 'Tester',
          role: 'MEMBER', status: 'ACTIVE', engagementScore: 42, engagementTier: 'WARM',
          createdAt: new Date().toISOString(),
        },
      }),
    }))
    await page.route('**/api/onboarding', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ tasks: [], summary: { total: 0, completed: 0 } }),
    }))
    await page.route('**/api/subscriptions', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ subscriptions: [], rechargeSubscriptions: [], upcomingCharges: [], chargeHistory: [] }),
    }))

    await page.goto('/dashboard')
    await expect(page.getByText(/Playwright/)).toBeVisible()
    await expect(page.getByText(/you don't have an active subscription yet/i)).toBeVisible()
  })
})
