ALTER TABLE "customers" DROP CONSTRAINT "customers_wa_id_nonempty";--> statement-breakpoint
DROP INDEX "customers_pk";--> statement-breakpoint
DROP INDEX "customers_wa_id_idx";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "source" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "platform_meta" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "source" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "source_meta" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_pk_v2" ON "customers" USING btree ("business_id","source","wa_id");--> statement-breakpoint
CREATE INDEX "customers_source_idx" ON "customers" USING btree ("source");--> statement-breakpoint
CREATE INDEX "customers_business_source_idx" ON "customers" USING btree ("business_id","source");--> statement-breakpoint
CREATE INDEX "customers_external_id_idx" ON "customers" USING btree ("wa_id");--> statement-breakpoint
CREATE INDEX "requests_source_idx" ON "requests" USING btree ("source");--> statement-breakpoint
CREATE INDEX "requests_business_source_idx" ON "requests" USING btree ("business_id","source");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_external_id_nonempty" CHECK (length(btrim("customers"."wa_id")) > 0);