-- Agent Database: Complete credit system fix
-- Run on AGENT database only (the one with whatsapp_identities table)

-- 1. Credit columns on whatsapp_identities
ALTER TABLE whatsapp_identities 
  ADD COLUMN IF NOT EXISTS monthly_credit_limit integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_balance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_credits_consumed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_credits_topped_up integer NOT NULL DEFAULT 0;

-- 2. Credit columns on businesses  
ALTER TABLE businesses 
  ADD COLUMN IF NOT EXISTS credit_pool integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_pool_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_tier text,
  ADD COLUMN IF NOT EXISTS senangpay_recurring_id text,
  ADD COLUMN IF NOT EXISTS senangpay_customer_email text;

-- 3. Missing tables
CREATE TABLE IF NOT EXISTS credit_topups (
    id text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    whatsapp_identity_id text REFERENCES whatsapp_identities(phone_number_id) ON DELETE SET NULL,
    amount integer NOT NULL,
    currency text NOT NULL DEFAULT 'MYR',
    type text NOT NULL DEFAULT 'manual',
    status text NOT NULL DEFAULT 'pending',
    senangpay_order_id text,
    senangpay_transaction_id text,
    description text,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS credit_consumption_events (
    id text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    whatsapp_identity_id text REFERENCES whatsapp_identities(phone_number_id) ON DELETE SET NULL,
    credits_consumed integer NOT NULL DEFAULT 1,
    event_type text NOT NULL DEFAULT 'ai_message',
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
    id text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    whatsapp_identity_id text REFERENCES whatsapp_identities(phone_number_id) ON DELETE SET NULL,
    customer_id text,
    thread_id text,
    event_type text NOT NULL,
    source text NOT NULL,
    credits integer NOT NULL DEFAULT 1,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS credit_topups_business_idx ON credit_topups(business_id);
CREATE INDEX IF NOT EXISTS credit_topups_identity_idx ON credit_topups(whatsapp_identity_id);
CREATE INDEX IF NOT EXISTS credit_consumption_business_idx ON credit_consumption_events(business_id, created_at);
CREATE INDEX IF NOT EXISTS credit_consumption_identity_idx ON credit_consumption_events(whatsapp_identity_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_business_idx ON ai_usage_events(business_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_identity_idx ON ai_usage_events(whatsapp_identity_id, created_at);

-- 5. Backfill partner/demo accounts (identify via suite_tenant_id lookup)
-- Note: This assumes suite_tenant_id on businesses links to control plane subscription
-- Run this AFTER control plane has subscription data, or manually set your account:
-- UPDATE whatsapp_identities SET credit_balance=50000, monthly_credit_limit=50000, credit_reset_at=now()+interval '30 days' WHERE business_id='YOUR_BIZ_ID';