import { test, expect } from '@playwright/test'

test.describe('Products page', () => {
  test('shows an honest empty state when no products have synced yet', async ({ page }) => {
    await page.route('**/api/products', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ products: [], nextCursor: null, hasMore: false }),
    }))

    await page.goto('/products')
    await expect(page.getByText(/no products yet/i)).toBeVisible()
    // Regression guard: this page used to show 6 hardcoded fake products
    // (Unsplash stock photos + invented review counts) unconditionally.
    await expect(page.getByText('Essential Wellness Box')).toHaveCount(0)
  })

  test('renders real products returned by the API', async ({ page }) => {
    await page.route('**/api/products', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        products: [{
          id: 'prod_e2e', title: 'E2E Test Product', description: 'A real product from the mocked API',
          vendor: 'NovaMember', tags: ['test'], imageUrl: null,
          variants: [{ id: 'var_1', title: 'Default', price: '49.99', compareAtPrice: '59.99' }],
          subscriptionPlans: [{ id: 'plan_1', name: 'Monthly', price: '49.99', billingCycle: 'MONTHLY', features: [], isPopular: false }],
        }],
        nextCursor: null, hasMore: false,
      }),
    }))

    await page.goto('/products')
    await expect(page.getByText('E2E Test Product')).toBeVisible()
    await expect(page.getByText('$49.99')).toBeVisible()
  })
})
