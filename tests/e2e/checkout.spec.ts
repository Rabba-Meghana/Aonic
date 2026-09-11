import { test, expect } from '@playwright/test'

test.describe('Checkout flow', () => {
  test('walks plan → account → confirm, then redirects to the checkoutUrl the API returns', async ({ page }) => {
    // Mock our own /api/checkout response — this tests OUR redirect logic,
    // not a live Shopify store. See playwright.config.ts for why.
    await page.route('**/api/checkout', async route => {
      const body = route.request().postDataJSON()
      expect(body.cpraConsent).toBe(true)
      expect(body.email).toBeTruthy()
      expect(body.password?.length).toBeGreaterThanOrEqual(8)

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'test-jwt-token',
          member: { id: 'mem_test', email: body.email, firstName: body.firstName, lastName: body.lastName, role: 'MEMBER' },
          plan: { id: body.planId, name: 'Growth', price: 299 },
          checkoutUrl: '/dashboard?checkout=complete',
          subscriptionActive: false,
        }),
      })
    })

    await page.goto('/checkout')

    // Step 0: plan
    await page.getByRole('button', { name: /continue/i }).click()

    // Step 1: account
    await page.getByPlaceholder('Alex').fill('Test')
    await page.getByPlaceholder('Johnson').fill('User')
    await page.getByPlaceholder('alex@company.com').fill(`e2e-${Date.now()}@example.com`)
    await page.getByPlaceholder('••••••••').fill('testpassword123')
    await page.getByText(/I consent to NovaMember processing/i).click()
    await page.getByRole('button', { name: /continue/i }).click()

    // Step 2: confirm — no card fields should exist anywhere in this flow
    await expect(page.getByPlaceholder(/card number/i)).toHaveCount(0)
    await expect(page.getByText(/enter your card on shopify/i)).toBeVisible()

    await page.getByRole('button', { name: /continue to secure checkout/i }).click()

    // The app should hand off to the URL our API returned — never process
    // payment itself.
    await expect(page).toHaveURL(/\/dashboard\?checkout=complete/)
  })

  test('shows a clear error if Shopify is not configured', async ({ page }) => {
    await page.route('**/api/checkout', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'This plan is not connected to a live Shopify product yet. Set SHOPIFY_VARIANT_* in env.' }),
    }))

    await page.goto('/checkout')
    await page.getByRole('button', { name: /continue/i }).click()
    await page.getByPlaceholder('Alex').fill('Test')
    await page.getByPlaceholder('Johnson').fill('User')
    await page.getByPlaceholder('alex@company.com').fill(`e2e-${Date.now()}@example.com`)
    await page.getByPlaceholder('••••••••').fill('testpassword123')
    await page.getByText(/I consent to NovaMember processing/i).click()
    await page.getByRole('button', { name: /continue/i }).click()
    await page.getByRole('button', { name: /continue to secure checkout/i }).click()

    await expect(page.getByText(/not connected to a live shopify product/i)).toBeVisible()
  })
})
