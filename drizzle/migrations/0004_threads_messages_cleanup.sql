CREATE TABLE "message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"external_message_id" text,
	"direction" text NOT NULL,
	"message_type" text,
	"text_body" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "customer_threads" CASCADE;--> statement-breakpoint
DROP TABLE "message_events" CASCADE;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "message_threads_business_customer_ux" ON "message_threads" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE INDEX "message_threads_business_id_idx" ON "message_threads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "message_threads_customer_id_idx" ON "message_threads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "message_threads_last_message_at_idx" ON "message_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "message_threads_deleted_at_idx" ON "message_threads" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "thread_messages_thread_id_idx" ON "thread_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "thread_messages_created_at_idx" ON "thread_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_messages_external_message_id_ux" ON "thread_messages" USING btree ("external_message_id") WHERE "thread_messages"."external_message_id" is not null;