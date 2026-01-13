CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"user_id" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"units_booked" integer DEFAULT 1 NOT NULL,
	"phone_number" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"instructions" text NOT NULL,
	"rag_top_k" integer DEFAULT 8,
	"promotions_enabled" boolean DEFAULT true NOT NULL,
	"bookings_enabled" boolean DEFAULT false NOT NULL,
	"booking_unit_capacity" integer DEFAULT 1,
	"booking_timeslot_minutes" integer DEFAULT 60,
	"booking_open_time" text,
	"booking_close_time" text,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_id_nonempty" CHECK (length(btrim("businesses"."id")) > 0),
	CONSTRAINT "businesses_instructions_nonempty" CHECK (length(btrim("businesses"."instructions")) > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"customer_wa_id" text NOT NULL,
	"last_message_at" timestamp with time zone,
	"status" text DEFAULT 'open',
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"business_id" text NOT NULL,
	"wa_id" text NOT NULL,
	"name" text,
	"profile_picture_url" text,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"total_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"successful_requests" integer DEFAULT 0 NOT NULL,
	"lead_score" integer DEFAULT 0 NOT NULL,
	"is_high_intent" boolean DEFAULT false NOT NULL,
	"last_sentiment" text,
	"first_message_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"assigned_to_user_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_business_id_nonempty" CHECK (length(btrim("customers"."business_id")) > 0),
	CONSTRAINT "customers_wa_id_nonempty" CHECK (length(btrim("customers"."wa_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"user_id" text,
	"customer_wa_id" text,
	"inbound_message_id" text,
	"direction" text NOT NULL,
	"channel" text DEFAULT 'whatsapp_cloud' NOT NULL,
	"message_type" text,
	"text_body" text,
	"to_phone_number_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"training_document_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"customer_number" text NOT NULL,
	"sentiment" text NOT NULL,
	"resolution_status" text NOT NULL,
	"price" numeric(10, 2) DEFAULT '0',
	"paid" boolean DEFAULT false NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_id_nonempty" CHECK (length(btrim("requests"."id")) > 0),
	CONSTRAINT "requests_business_id_nonempty" CHECK (length(btrim("requests"."business_id")) > 0),
	CONSTRAINT "requests_customer_number_nonempty" CHECK (length(btrim("requests"."customer_number")) > 0)
);
--> statement-breakpoint
CREATE TABLE "training_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"blob_path" text NOT NULL,
	"blob_url" text,
	"original_filename" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"sha256_hex" text,
	"indexing_status" text DEFAULT 'not_indexed' NOT NULL,
	"last_indexed_at" timestamp with time zone,
	"last_error" text,
	"uploaded_by_user_id" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"whatsapp_connected" boolean DEFAULT false NOT NULL,
	"business_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_nonempty" CHECK (length(btrim("users"."id")) > 0),
	CONSTRAINT "users_email_nonempty" CHECK (length(btrim("users"."email")) > 0),
	CONSTRAINT "users_business_id_nonempty" CHECK (length(btrim("users"."business_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_identities" (
	"phone_number_id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"connected_by_user_id" text,
	"waba_id" text,
	"display_phone_number" text,
	"business_token" text,
	"two_step_pin" text,
	"webhook_subscribed_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"credit_line_shared_at" timestamp with time zone,
	"credit_line_allocation_config_id" text,
	"waba_currency" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_identities_phone_number_id_nonempty" CHECK (length(btrim("whatsapp_identities"."phone_number_id")) > 0),
	CONSTRAINT "wa_identities_business_id_nonempty" CHECK (length(btrim("whatsapp_identities"."business_id")) > 0),
	CONSTRAINT "wa_identities_disconnect_sanity" CHECK ("whatsapp_identities"."disconnected_at" is null OR "whatsapp_identities"."is_active" = false)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "rag_jobs" ADD CONSTRAINT "rag_jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "rag_jobs" ADD CONSTRAINT "rag_jobs_training_document_id_training_documents_id_fk" FOREIGN KEY ("training_document_id") REFERENCES "public"."training_documents"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "training_documents" ADD CONSTRAINT "training_documents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "training_documents" ADD CONSTRAINT "training_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whatsapp_identities" ADD CONSTRAINT "whatsapp_identities_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whatsapp_identities" ADD CONSTRAINT "whatsapp_identities_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "businesses_is_active_idx" ON "businesses" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_threads_business_customer_uidx" ON "customer_threads" USING btree ("business_id","customer_wa_id");--> statement-breakpoint
CREATE INDEX "customer_threads_business_id_idx" ON "customer_threads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "customer_threads_last_message_at_idx" ON "customer_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_pk" ON "customers" USING btree ("business_id","wa_id");--> statement-breakpoint
CREATE INDEX "customers_business_id_idx" ON "customers" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "customers_wa_id_idx" ON "customers" USING btree ("wa_id");--> statement-breakpoint
CREATE INDEX "customers_last_message_at_idx" ON "customers" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "customers_lead_score_idx" ON "customers" USING btree ("lead_score");--> statement-breakpoint
CREATE INDEX "customers_high_intent_idx" ON "customers" USING btree ("business_id","is_high_intent");--> statement-breakpoint
CREATE INDEX "customers_total_revenue_idx" ON "customers" USING btree ("business_id","total_revenue");--> statement-breakpoint
CREATE INDEX "message_events_business_id_idx" ON "message_events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "message_events_inbound_message_id_idx" ON "message_events" USING btree ("inbound_message_id");--> statement-breakpoint
CREATE INDEX "message_events_created_at_idx" ON "message_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rag_jobs_business_id_idx" ON "rag_jobs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "rag_jobs_status_idx" ON "rag_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rag_jobs_created_at_idx" ON "rag_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "requests_business_id_idx" ON "requests" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "requests_customer_number_idx" ON "requests" USING btree ("customer_number");--> statement-breakpoint
CREATE INDEX "requests_business_customer_idx" ON "requests" USING btree ("business_id","customer_number");--> statement-breakpoint
CREATE INDEX "requests_resolution_status_idx" ON "requests" USING btree ("resolution_status");--> statement-breakpoint
CREATE INDEX "training_documents_business_id_idx" ON "training_documents" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_documents_business_doc_type_ux" ON "training_documents" USING btree ("business_id","doc_type");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_ux" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_business_id_idx" ON "users" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "wa_identities_business_id_idx" ON "whatsapp_identities" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "wa_identities_is_active_idx" ON "whatsapp_identities" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "wa_identities_connected_by_user_id_idx" ON "whatsapp_identities" USING btree ("connected_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_identities_waba_id_ux" ON "whatsapp_identities" USING btree ("waba_id") WHERE "whatsapp_identities"."waba_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_identities_display_phone_ux" ON "whatsapp_identities" USING btree ("display_phone_number") WHERE "whatsapp_identities"."display_phone_number" is not null;