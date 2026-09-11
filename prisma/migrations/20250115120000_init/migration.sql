-- NovaMember — Initial Database Migration
-- Matches the Prisma schema exactly. Run once on a fresh database.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Members ──────────────────────────────────────────────────────────────────

CREATE TYPE member_role AS ENUM ('MEMBER', 'ADMIN');
CREATE TYPE member_status AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'CHURNED');
CREATE TYPE engagement_tier AS ENUM ('COLD', 'WARM', 'HOT', 'CHAMPION');

CREATE TABLE members (
  id                    VARCHAR(30)     PRIMARY KEY DEFAULT 'mem_' || encode(gen_random_bytes(12), 'hex'),
  email                 VARCHAR(255)    NOT NULL UNIQUE,
  password_hash         TEXT            NOT NULL,
  first_name            VARCHAR(100)    NOT NULL,
  last_name             VARCHAR(100)    NOT NULL,
  avatar_url            TEXT,
  role                  member_role     NOT NULL DEFAULT 'MEMBER',
  status                member_status   NOT NULL DEFAULT 'ACTIVE',

  -- Integrations
  shopify_customer_id   VARCHAR(100)    UNIQUE,
  recharge_customer_id  VARCHAR(100)    UNIQUE,

  -- AI scoring
  engagement_score      DECIMAL(5,2)    NOT NULL DEFAULT 0,
  engagement_tier       engagement_tier NOT NULL DEFAULT 'COLD',
  last_scored_at        TIMESTAMPTZ,

  -- Onboarding
  onboarding_completed_at TIMESTAMPTZ,

  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_members_email ON members(email);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_engagement_tier ON members(engagement_tier);

-- ── Products ─────────────────────────────────────────────────────────────────

CREATE TYPE product_status AS ENUM ('ACTIVE', 'ARCHIVED', 'DRAFT');

CREATE TABLE products (
  id                 VARCHAR(30)    PRIMARY KEY DEFAULT 'prod_' || encode(gen_random_bytes(12), 'hex'),
  shopify_product_id VARCHAR(100)   NOT NULL UNIQUE,
  title              VARCHAR(255)   NOT NULL,
  description        TEXT,
  vendor             VARCHAR(100),
  product_type       VARCHAR(100),
  tags               TEXT[]         NOT NULL DEFAULT '{}',
  image_url          TEXT,
  status             product_status NOT NULL DEFAULT 'ACTIVE',
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE product_variants (
  id                     VARCHAR(30)    PRIMARY KEY DEFAULT 'var_' || encode(gen_random_bytes(12), 'hex'),
  shopify_variant_id     VARCHAR(100)   NOT NULL UNIQUE,
  product_id             VARCHAR(30)    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title                  VARCHAR(255)   NOT NULL,
  sku                    VARCHAR(100),
  price                  DECIMAL(10,2)  NOT NULL,
  compare_at_price       DECIMAL(10,2),
  inventory_quantity     INTEGER        NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── Subscription Plans ────────────────────────────────────────────────────────

CREATE TYPE billing_cycle AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

CREATE TABLE subscription_plans (
  id              VARCHAR(30)    PRIMARY KEY DEFAULT 'plan_' || encode(gen_random_bytes(12), 'hex'),
  recharge_id     VARCHAR(100)   UNIQUE,
  product_id      VARCHAR(30)    NOT NULL REFERENCES products(id),
  name            VARCHAR(100)   NOT NULL,
  description     TEXT,
  price           DECIMAL(10,2)  NOT NULL,
  billing_cycle   billing_cycle  NOT NULL,
  interval_count  INTEGER        NOT NULL DEFAULT 1,
  trial_days      INTEGER        NOT NULL DEFAULT 0,
  features        TEXT[]         NOT NULL DEFAULT '{}',
  is_popular      BOOLEAN        NOT NULL DEFAULT FALSE,
  sort_order      INTEGER        NOT NULL DEFAULT 0,
  is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── Subscriptions ─────────────────────────────────────────────────────────────

CREATE TYPE subscription_status AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED');

CREATE TABLE subscriptions (
  id                         VARCHAR(30)          PRIMARY KEY DEFAULT 'sub_' || encode(gen_random_bytes(12), 'hex'),
  member_id                  VARCHAR(30)          NOT NULL REFERENCES members(id),
  plan_id                    VARCHAR(30)          NOT NULL REFERENCES subscription_plans(id),
  recharge_subscription_id   VARCHAR(100)         UNIQUE,
  recharge_charge_id         VARCHAR(100),
  status                     subscription_status  NOT NULL DEFAULT 'ACTIVE',
  current_period_start       TIMESTAMPTZ          NOT NULL,
  current_period_end         TIMESTAMPTZ          NOT NULL,
  cancel_at_period_end       BOOLEAN              NOT NULL DEFAULT FALSE,
  cancelled_at               TIMESTAMPTZ,
  paused_at                  TIMESTAMPTZ,
  resumes_at                 TIMESTAMPTZ,
  trial_ends_at              TIMESTAMPTZ,
  price_at_subscription      DECIMAL(10,2)        NOT NULL,
  shopify_order_id           VARCHAR(100),
  metadata                   JSONB,
  created_at                 TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_member ON subscriptions(member_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- ── Charges ───────────────────────────────────────────────────────────────────

CREATE TYPE charge_status AS ENUM ('QUEUED', 'SKIPPED', 'SUCCESS', 'ERROR', 'REFUNDED', 'PARTIALLY_REFUNDED');

CREATE TABLE charges (
  id                    VARCHAR(30)     PRIMARY KEY DEFAULT 'chg_' || encode(gen_random_bytes(12), 'hex'),
  subscription_id       VARCHAR(30)     NOT NULL REFERENCES subscriptions(id),
  recharge_charge_id    VARCHAR(100)    UNIQUE,
  amount                DECIMAL(10,2)   NOT NULL,
  currency              CHAR(3)         NOT NULL DEFAULT 'USD',
  status                charge_status   NOT NULL DEFAULT 'QUEUED',
  scheduled_at          TIMESTAMPTZ     NOT NULL,
  processed_at          TIMESTAMPTZ,
  failure_reason        TEXT,
  retry_count           INTEGER         NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ── Onboarding Tasks ──────────────────────────────────────────────────────────

CREATE TABLE onboarding_tasks (
  id           VARCHAR(30)   PRIMARY KEY DEFAULT 'otk_' || encode(gen_random_bytes(12), 'hex'),
  member_id    VARCHAR(30)   NOT NULL REFERENCES members(id),
  task_key     VARCHAR(100)  NOT NULL,
  title        VARCHAR(255)  NOT NULL,
  description  TEXT,
  is_required  BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order   INTEGER       NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  skipped_at   TIMESTAMPTZ,
  metadata     JSONB,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, task_key)
);

-- ── Activity Events ───────────────────────────────────────────────────────────

CREATE TABLE activity_events (
  id          VARCHAR(30)   PRIMARY KEY DEFAULT 'evt_' || encode(gen_random_bytes(12), 'hex'),
  member_id   VARCHAR(30)   NOT NULL REFERENCES members(id),
  event_type  VARCHAR(100)  NOT NULL,
  properties  JSONB,
  source      VARCHAR(50),
  session_id  VARCHAR(100),
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_events_member_time ON activity_events(member_id, created_at DESC);
CREATE INDEX idx_activity_events_type_time ON activity_events(event_type, created_at DESC);

-- ── Webhook Events ────────────────────────────────────────────────────────────

CREATE TYPE webhook_status AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED');

CREATE TABLE webhook_events (
  id            VARCHAR(30)     PRIMARY KEY DEFAULT 'whe_' || encode(gen_random_bytes(12), 'hex'),
  source        VARCHAR(50)     NOT NULL,
  topic         VARCHAR(100)    NOT NULL,
  external_id   VARCHAR(100),
  member_id     VARCHAR(30)     REFERENCES members(id),
  payload       JSONB           NOT NULL,
  status        webhook_status  NOT NULL DEFAULT 'PENDING',
  processed_at  TIMESTAMPTZ,
  error_message TEXT,
  retry_count   INTEGER         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_source_topic ON webhook_events(source, topic);
CREATE INDEX idx_webhook_events_status_time ON webhook_events(status, created_at);

-- ── CPRA Compliance ───────────────────────────────────────────────────────────

CREATE TABLE consent_records (
  id           VARCHAR(30)   PRIMARY KEY DEFAULT 'cns_' || encode(gen_random_bytes(12), 'hex'),
  member_id    VARCHAR(30)   NOT NULL REFERENCES members(id),
  consent_type VARCHAR(100)  NOT NULL,
  granted      BOOLEAN       NOT NULL,
  ip_address   INET,
  user_agent   TEXT,
  version      VARCHAR(20)   NOT NULL,
  metadata     JSONB,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_consent_records_member_type ON consent_records(member_id, consent_type);

CREATE TYPE deletion_status AS ENUM ('PENDING', 'VERIFIED', 'PROCESSING', 'COMPLETED', 'CANCELLED');

CREATE TABLE deletion_requests (
  id                 VARCHAR(30)      PRIMARY KEY DEFAULT 'del_' || encode(gen_random_bytes(12), 'hex'),
  member_id          VARCHAR(30)      NOT NULL REFERENCES members(id),
  requested_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  scheduled_at       TIMESTAMPTZ      NOT NULL,  -- 45 days from request per CPRA
  completed_at       TIMESTAMPTZ,
  status             deletion_status  NOT NULL DEFAULT 'PENDING',
  verification_token VARCHAR(64)      NOT NULL UNIQUE,
  requestor_email    VARCHAR(255)     NOT NULL,
  notes              TEXT
);

-- ── AI Score Log ──────────────────────────────────────────────────────────────

CREATE TABLE ai_score_logs (
  id             VARCHAR(30)     PRIMARY KEY DEFAULT 'asl_' || encode(gen_random_bytes(12), 'hex'),
  member_id      VARCHAR(30)     NOT NULL REFERENCES members(id),
  score          DECIMAL(5,2)    NOT NULL,
  tier           engagement_tier NOT NULL,
  signals        JSONB           NOT NULL,
  reasoning      TEXT,
  model_version  VARCHAR(50)     NOT NULL,
  prompt_tokens  INTEGER         NOT NULL,
  output_tokens  INTEGER         NOT NULL,
  created_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_score_logs_member_time ON ai_score_logs(member_id, created_at DESC);

-- ── Updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'members', 'products', 'product_variants', 'subscription_plans',
    'subscriptions', 'charges', 'onboarding_tasks'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END;
$$;
