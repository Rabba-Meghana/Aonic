-- Seeds the real Shopify product ("Club Membership11") into NovaMember's own
-- Postgres tables, so GET /api/products (and the /products page) stops
-- returning an empty catalog. This is the actual product/variant that exists
-- in the connected Shopify dev store — not fabricated data.
--
-- Run this as ONE statement in Vercel → Storage → Prisma Postgres → Query.
-- Enum type names are quoted PascalCase on purpose: Prisma's @map() renames
-- columns/tables but never enum *type* names, so "ProductStatus" and
-- "BillingCycle" must match schema.prisma exactly, not product_status.

DO $$
DECLARE
  v_product_id VARCHAR := 'prod_club_membership11';
BEGIN
  -- Product (idempotent — safe to re-run)
  INSERT INTO products (
    id, shopify_product_id, title, description, vendor, product_type,
    tags, image_url, status, created_at, updated_at
  ) VALUES (
    v_product_id,
    '8101519196203',
    'Club Membership11',
    'NovaMember Club membership — real product synced from the connected Shopify dev store.',
    NULL,
    'Membership',
    ARRAY[]::text[],
    NULL,
    'ACTIVE'::"ProductStatus",
    NOW(),
    NOW()
  )
  ON CONFLICT (shopify_product_id) DO UPDATE SET
    title = EXCLUDED.title,
    updated_at = NOW();

  -- Variant
  INSERT INTO product_variants (
    id, shopify_variant_id, product_id, title, sku, price,
    compare_at_price, inventory_quantity, created_at, updated_at
  ) VALUES (
    'var_club_membership11',
    '45326996013099',
    v_product_id,
    'Default Title',
    NULL,
    9.99,
    NULL,
    100,
    NOW(),
    NOW()
  )
  ON CONFLICT (shopify_variant_id) DO UPDATE SET
    price = EXCLUDED.price,
    inventory_quantity = EXCLUDED.inventory_quantity,
    updated_at = NOW();

  -- Subscription plan (mirrors the Starter plan used at /checkout)
  INSERT INTO subscription_plans (
    id, recharge_id, product_id, name, description, price,
    billing_cycle, interval_count, trial_days, features,
    is_popular, sort_order, is_active, created_at, updated_at
  ) VALUES (
    'plan_starter_club_membership11',
    NULL,
    v_product_id,
    'Starter',
    'Monthly Club Membership11 subscription.',
    9.99,
    'MONTHLY'::"BillingCycle",
    1,
    0,
    ARRAY['Up to 500 active members', 'Shopify storefront', 'Recharge subscriptions', 'Basic analytics', 'Email support']::text[],
    false,
    0,
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    price = EXCLUDED.price,
    updated_at = NOW();
END $$;
