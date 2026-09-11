import { test, expect } from '@playwright/test'

test.describe('Landing page', () => {
  test('loads and shows the real value proposition', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/NovaMember/)
    await expect(page.getByRole('heading', { name: /membership/i })).toBeVisible()
  })

  test('primary CTA links to checkout', async ({ page }) => {
    await page.goto('/')
    const cta = page.getByRole('link', { name: /start|get started|subscribe/i }).first()
    await expect(cta).toBeVisible()
    await cta.click()
    await expect(page).toHaveURL(/\/checkout/)
  })

  test('pricing section does not claim unverified metrics as fact', async ({ page }) => {
    await page.goto('/')
    const body = await page.textContent('body')
    // Regression guard: catches a real bug we found and fixed — the landing
    // page used to assert "No mocks. No demos." while checkout didn't work.
    expect(body?.toLowerCase()).not.toContain('no mocks. no demos.')
  })
})
