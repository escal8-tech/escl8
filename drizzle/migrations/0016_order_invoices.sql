ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "invoice_number" text,
  ADD COLUMN IF NOT EXISTS "invoice_url" text,
  ADD COLUMN IF NOT EXISTS "invoice_storage_path" text,
  ADD COLUMN IF NOT EXISTS "invoice_file_name" text,
  ADD COLUMN IF NOT EXISTS "invoice_status" text DEFAULT 'not_sent' NOT NULL,
  ADD COLUMN IF NOT EXISTS "invoice_delivery_method" text,
  ADD COLUMN IF NOT EXISTS "invoice_generated_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "invoice_sent_at" timestamp with time zone;
