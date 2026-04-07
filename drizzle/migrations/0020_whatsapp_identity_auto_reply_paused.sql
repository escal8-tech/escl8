ALTER TABLE "whatsapp_identities"
ADD COLUMN IF NOT EXISTS "auto_reply_paused" boolean NOT NULL DEFAULT false;
