CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"support_ticket_id" text,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"customer_id" text,
	"thread_id" text,
	"whatsapp_identity_id" text,
	"customer_name" text,
	"customer_phone" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"payment_method" text DEFAULT 'manual' NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"expected_amount" numeric(12, 2),
	"paid_amount" numeric(12, 2),
	"payment_reference" text,
	"ticket_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"approved_at" timestamp with time zone,
	"payment_approved_at" timestamp with time zone,
	"payment_rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"customer_id" text,
	"thread_id" text,
	"whatsapp_identity_id" text,
	"payment_method" text DEFAULT 'bank_qr' NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"expected_amount" numeric(12, 2),
	"paid_amount" numeric(12, 2),
	"paid_date" text,
	"reference_code" text,
	"proof_url" text,
	"ai_check_status" text,
	"ai_check_notes" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"actor_label" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_support_ticket_id_support_tickets_id_fk" FOREIGN KEY ("support_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_whatsapp_identity_id_whatsapp_identities_phone_number_id_fk" FOREIGN KEY ("whatsapp_identity_id") REFERENCES "public"."whatsapp_identities"("phone_number_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_whatsapp_identity_id_whatsapp_identities_phone_number_id_fk" FOREIGN KEY ("whatsapp_identity_id") REFERENCES "public"."whatsapp_identities"("phone_number_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "orders_business_id_idx" ON "orders" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_support_ticket_id_ux" ON "orders" USING btree ("support_ticket_id") WHERE "orders"."support_ticket_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_payments_business_id_idx" ON "order_payments" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "order_payments_order_id_idx" ON "order_payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_payments_status_idx" ON "order_payments" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "order_payments_created_at_idx" ON "order_payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_events_business_id_idx" ON "order_events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "order_events_order_id_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_created_at_idx" ON "order_events" USING btree ("created_at");
