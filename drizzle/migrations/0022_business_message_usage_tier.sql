ALTER TABLE "businesses"
ADD COLUMN IF NOT EXISTS "message_usage_tier" text DEFAULT 'standard' NOT NULL;

UPDATE "businesses"
SET "message_usage_tier" = 'standard'
WHERE "message_usage_tier" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'businesses_message_usage_tier_valid'
  ) THEN
    ALTER TABLE "businesses"
    ADD CONSTRAINT "businesses_message_usage_tier_valid"
    CHECK ("message_usage_tier" IN ('minimum', 'standard', 'enterprise'));
  END IF;
END $$;
