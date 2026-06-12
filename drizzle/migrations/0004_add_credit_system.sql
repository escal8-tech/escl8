-- Migration: Add credit system columns to whatsappIdentities and businesses
-- +goose Up
-- +goose StatementBegin

-- Add credit system columns to whatsappIdentities
ALTER TABLE whatsapp_identities 
ADD COLUMN IF NOT EXISTS monthly_credit_limit integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS credit_balance integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS credit_reset_at timestamptz,
ADD COLUMN IF NOT EXISTS total_credits_consumed integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_credits_topped_up integer NOT NULL DEFAULT 0;

-- Add credit pool to businesses
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS credit_pool integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS credit_pool_reset_at timestamptz,
ADD COLUMN IF NOT EXISTS subscription_tier text,
ADD COLUMN IF NOT EXISTS senangpay_recurring_id text,
ADD COLUMN IF NOT EXISTS senangpay_customer_email text;

-- Update messageUsageTier check constraint to include new tiers
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_message_usage_tier_valid;
ALTER TABLE businesses ADD CONSTRAINT businesses_message_usage_tier_valid 
CHECK (message_usage_tier IN ('minimum', 'standard', 'agent', 'enterprise', 'partner'));

-- Create credit_topups table
CREATE TABLE IF NOT EXISTS credit_topups (
    id text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
    whatsapp_identity_id text REFERENCES whatsapp_identities(phone_number_id) ON DELETE SET NULL ON UPDATE CASCADE,
    amount integer NOT NULL,
    currency text NOT NULL DEFAULT 'MYR',
    type text NOT NULL DEFAULT 'manual', -- manual, subscription_renewal, addon_purchase
    status text NOT NULL DEFAULT 'pending', -- pending, completed, failed
    senangpay_order_id text,
    senangpay_transaction_id text,
    description text,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS credit_topups_business_idx ON credit_topups(business_id);
CREATE INDEX IF NOT EXISTS credit_topups_whatsapp_identity_idx ON credit_topups(whatsapp_identity_id);
CREATE INDEX IF NOT EXISTS credit_topups_status_idx ON credit_topups(status);
CREATE INDEX IF NOT EXISTS credit_topups_created_at_idx ON credit_topups(created_at);

-- Create credit_consumption_events table for audit trail
CREATE TABLE IF NOT EXISTS credit_consumption_events (
    id text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
    whatsapp_identity_id text REFERENCES whatsapp_identities(phone_number_id) ON DELETE SET NULL ON UPDATE CASCADE,
    credits_consumed integer NOT NULL DEFAULT 1,
    event_type text NOT NULL DEFAULT 'ai_message', -- ai_message, api_call, etc.
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_consumption_business_idx ON credit_consumption_events(business_id, created_at);
CREATE INDEX IF NOT EXISTS credit_consumption_whatsapp_idx ON credit_consumption_events(whatsapp_identity_id, created_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS credit_consumption_events;
DROP TABLE IF EXISTS credit_topups;
ALTER TABLE businesses DROP COLUMN IF EXISTS subscription_tier;
ALTER TABLE businesses DROP COLUMN IF EXISTS senangpay_recurring_id;
ALTER TABLE businesses DROP COLUMN IF EXISTS senangpay_customer_email;
ALTER TABLE businesses DROP COLUMN IF EXISTS credit_pool;
ALTER TABLE businesses DROP COLUMN IF EXISTS credit_pool_reset_at;
ALTER TABLE whatsapp_identities DROP COLUMN IF EXISTS monthly_credit_limit;
ALTER TABLE whatsapp_identities DROP COLUMN IF EXISTS credit_balance;
ALTER TABLE whatsapp_identities DROP COLUMN IF EXISTS credit_reset_at;
ALTER TABLE whatsapp_identities DROP COLUMN IF EXISTS total_credits_consumed;
ALTER TABLE whatsapp_identities DROP COLUMN IF EXISTS total_credits_topped_up;
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_message_usage_tier_valid;
ALTER TABLE businesses ADD CONSTRAINT businesses_message_usage_tier_valid 
CHECK (message_usage_tier IN ('minimum', 'standard', 'enterprise'));
-- +goose StatementEnd