ALTER TABLE "requests" DROP CONSTRAINT "requests_customer_number_nonempty";--> statement-breakpoint
DROP INDEX "customers_pk";--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "customer_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_composite_ux" ON "customers" USING btree ("business_id","source","external_id");--> statement-breakpoint
CREATE INDEX "customers_deleted_at_idx" ON "customers" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "requests_customer_id_idx" ON "requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "requests_created_at_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "requests_deleted_at_idx" ON "requests" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_id_nonempty" CHECK (length(btrim("customers"."id")) > 0);