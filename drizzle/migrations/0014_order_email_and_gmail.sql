ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gmail_connected" boolean DEFAULT false NOT NULL;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gmail_email" text;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gmail_refresh_token" text;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gmail_access_token" text;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gmail_access_token_expires_at" timestamp with time zone;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gmail_scope" text;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gmail_connected_at" timestamp with time zone;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gmail_error" text;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_email" text;

UPDATE "support_ticket_types"
SET
  "required_fields" = COALESCE("required_fields", '[]'::jsonb) || '"email"'::jsonb,
  "updated_at" = now()
WHERE "key" = 'ordercreation'
  AND NOT COALESCE("required_fields", '[]'::jsonb) ? 'email';
