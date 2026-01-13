ALTER TABLE "customers" DROP CONSTRAINT "customers_external_id_nonempty";--> statement-breakpoint
DROP INDEX "customers_pk_v2";--> statement-breakpoint
DROP INDEX "customers_external_id_idx";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_id" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_pk" ON "customers" USING btree ("business_id","source","external_id");--> statement-breakpoint
CREATE INDEX "customers_external_id_idx" ON "customers" USING btree ("external_id");--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "wa_id";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_external_id_nonempty" CHECK (length(btrim("customers"."external_id")) > 0);