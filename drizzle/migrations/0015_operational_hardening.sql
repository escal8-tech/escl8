CREATE TABLE "operation_throttles" (
  "scope_key" text PRIMARY KEY NOT NULL,
  "business_id" text NOT NULL,
  "bucket" text NOT NULL,
  "hit_count" integer NOT NULL DEFAULT 0,
  "reset_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "operation_throttles"
  ADD CONSTRAINT "operation_throttles_business_id_businesses_id_fk"
  FOREIGN KEY ("business_id")
  REFERENCES "public"."businesses"("id")
  ON DELETE cascade
  ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "operation_throttles_business_bucket_idx"
  ON "operation_throttles" USING btree ("business_id", "bucket", "reset_at");
--> statement-breakpoint
CREATE INDEX "operation_throttles_reset_at_idx"
  ON "operation_throttles" USING btree ("reset_at");
--> statement-breakpoint

CREATE INDEX "thread_messages_thread_direction_created_idx"
  ON "thread_messages" USING btree ("thread_id", "direction", "created_at");
--> statement-breakpoint

CREATE INDEX "support_tickets_type_updated_created_idx"
  ON "support_tickets" USING btree ("business_id", "ticket_type_key", "updated_at", "created_at");
--> statement-breakpoint
CREATE INDEX "support_tickets_status_updated_created_idx"
  ON "support_tickets" USING btree ("business_id", "status", "updated_at", "created_at");
--> statement-breakpoint
CREATE INDEX "support_tickets_outcome_updated_idx"
  ON "support_tickets" USING btree ("business_id", "outcome", "updated_at");
--> statement-breakpoint

CREATE INDEX "orders_business_updated_created_idx"
  ON "orders" USING btree ("business_id", "updated_at", "created_at");
--> statement-breakpoint
CREATE INDEX "orders_business_created_idx"
  ON "orders" USING btree ("business_id", "created_at");
--> statement-breakpoint
CREATE INDEX "orders_business_method_updated_created_idx"
  ON "orders" USING btree ("business_id", "payment_method", "updated_at", "created_at");
--> statement-breakpoint
CREATE INDEX "orders_business_method_created_idx"
  ON "orders" USING btree ("business_id", "payment_method", "created_at");
--> statement-breakpoint

CREATE INDEX "order_payments_business_order_created_idx"
  ON "order_payments" USING btree ("business_id", "order_id", "created_at");
