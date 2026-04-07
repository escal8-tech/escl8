ALTER TABLE "whatsapp_identities"
ADD COLUMN IF NOT EXISTS "ai_disabled" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE cascade ON UPDATE cascade,
  "whatsapp_identity_id" text REFERENCES "whatsapp_identities"("phone_number_id") ON DELETE set null ON UPDATE cascade,
  "customer_id" text REFERENCES "customers"("id") ON DELETE set null ON UPDATE cascade,
  "thread_id" text REFERENCES "message_threads"("id") ON DELETE set null ON UPDATE cascade,
  "event_type" text NOT NULL,
  "source" text NOT NULL,
  "credits" integer NOT NULL DEFAULT 1,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ai_usage_events_business_id_idx"
  ON "ai_usage_events" ("business_id", "created_at");

CREATE INDEX IF NOT EXISTS "ai_usage_events_identity_id_idx"
  ON "ai_usage_events" ("whatsapp_identity_id", "created_at");
