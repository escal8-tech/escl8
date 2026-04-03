ALTER TABLE "whatsapp_identities"
DROP CONSTRAINT IF EXISTS "wa_identities_bot_type_valid";--> statement-breakpoint
ALTER TABLE "whatsapp_identities"
ADD CONSTRAINT "wa_identities_bot_type_valid"
CHECK ("whatsapp_identities"."bot_type" in ('AGENT', 'CONCIERGE', 'ORDER', 'RESERVATION'));--> statement-breakpoint
