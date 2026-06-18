CREATE SEQUENCE "public"."support_ticket_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"channel_identity_id" text,
	"customer_id" text,
	"thread_id" text,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"credits" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"user_id" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"units_booked" integer DEFAULT 1 NOT NULL,
	"phone_number" text,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_customization_settings" (
	"business_id" text PRIMARY KEY NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"logo_blob_path" text DEFAULT '' NOT NULL,
	"logo_container" text DEFAULT '' NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"primary_color" text DEFAULT '#0E1B40' NOT NULL,
	"secondary_color" text DEFAULT '#D4A457' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"invoice_footer_note" text DEFAULT 'Please keep this invoice for your records.' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_order_settings" (
	"business_id" text PRIMARY KEY NOT NULL,
	"ticket_to_order_enabled" boolean DEFAULT true NOT NULL,
	"payment_method" text DEFAULT 'manual' NOT NULL,
	"payment_proof_ai_enabled" boolean DEFAULT true NOT NULL,
	"payment_slip_required" boolean DEFAULT true NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"delivery_charge_enabled" boolean DEFAULT false NOT NULL,
	"delivery_charge_type" text DEFAULT 'fixed' NOT NULL,
	"delivery_charge_value" text DEFAULT '0' NOT NULL,
	"bank_qr_show_qr" boolean DEFAULT true NOT NULL,
	"bank_qr_show_bank_details" boolean DEFAULT true NOT NULL,
	"bank_qr_blob_path" text DEFAULT '' NOT NULL,
	"bank_qr_image_url" text DEFAULT '' NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"account_name" text DEFAULT '' NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"account_instructions" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_order_settings_payment_method_valid" CHECK ("business_order_settings"."payment_method" in ('manual', 'cod', 'bank_qr')),
	CONSTRAINT "business_order_settings_delivery_type_valid" CHECK ("business_order_settings"."delivery_charge_type" in ('fixed', 'percentage')),
	CONSTRAINT "business_order_settings_currency_nonempty" CHECK (length(btrim("business_order_settings"."currency")) > 0)
);
--> statement-breakpoint
CREATE TABLE "business_preferences" (
	"business_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_preferences_timezone_nonempty" CHECK (length(btrim("business_preferences"."timezone")) > 0)
);
--> statement-breakpoint
CREATE TABLE "business_user_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" text,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_website_widget_settings" (
	"business_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"widget_key" text,
	"title" text DEFAULT 'Chat with us' NOT NULL,
	"accent_color" text DEFAULT '#2563eb' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"suite_tenant_id" text,
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
	"message_usage_tier" text DEFAULT 'standard' NOT NULL,
	"credit_pool" integer DEFAULT 0 NOT NULL,
	"credit_pool_reset_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"gmail_connected" boolean DEFAULT false NOT NULL,
	"gmail_email" text,
	"gmail_refresh_token" text,
	"gmail_access_token" text,
	"gmail_access_token_expires_at" timestamp with time zone,
	"gmail_scope" text,
	"gmail_connected_at" timestamp with time zone,
	"gmail_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_id_nonempty" CHECK (length(btrim("businesses"."id")) > 0),
	CONSTRAINT "businesses_instructions_nonempty" CHECK (length(btrim("businesses"."instructions")) > 0),
	CONSTRAINT "businesses_message_usage_tier_valid" CHECK ("businesses"."message_usage_tier" in ('minimum', 'standard', 'agent', 'pro_bundle', 'enterprise', 'partner'))
);
--> statement-breakpoint
CREATE TABLE "channel_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text,
	"display_handle" text,
	"bot_type" text DEFAULT 'AGENT' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"auto_reply_paused" boolean DEFAULT false NOT NULL,
	"monthly_credit_limit" integer DEFAULT 0 NOT NULL,
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"credit_reset_at" timestamp with time zone,
	"total_credits_consumed" integer DEFAULT 0 NOT NULL,
	"total_credits_topped_up" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now(),
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_customer_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"suite_tenant_id" text,
	"customer_id" text,
	"name" text,
	"phone" text,
	"email" text,
	"lifetime_spend_minor" integer DEFAULT 0 NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"loyalty_points" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"suite_tenant_id" text,
	"source" text DEFAULT 'shared_commerce' NOT NULL,
	"file_name" text,
	"file_type" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"column_mapping" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"business_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"source_row_key" text NOT NULL,
	"product_id" text,
	"raw_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'imported' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_loyalty_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"order_id" text,
	"points_delta" integer NOT NULL,
	"reason" text DEFAULT 'manual' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_membership_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"suite_tenant_id" text,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"billing_mode" text DEFAULT 'manual' NOT NULL,
	"benefit_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_membership_plans_name_nonempty" CHECK (length(btrim("commerce_membership_plans"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"source_order_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_memberships_status_valid" CHECK ("commerce_memberships"."status" in ('active', 'paused', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "commerce_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"suite_tenant_id" text,
	"product_id" text NOT NULL,
	"title" text DEFAULT 'Offer' NOT NULL,
	"description" text,
	"original_price_minor" integer,
	"offer_price_minor" integer NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"public_visible" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text,
	"price_id" text,
	"item_type" text DEFAULT 'product' NOT NULL,
	"item_name" text NOT NULL,
	"sku" text,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer DEFAULT 0 NOT NULL,
	"line_total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_order_lines_quantity_positive" CHECK ("commerce_order_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce_order_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"payment_method" text DEFAULT 'bank_qr' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"expected_amount_minor" integer DEFAULT 0 NOT NULL,
	"paid_amount_minor" integer DEFAULT 0 NOT NULL,
	"paid_date" text,
	"reference_code" text,
	"bank_reference_code" text,
	"proof_url" text,
	"ai_check_status" text,
	"ai_check_notes" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"suite_tenant_id" text,
	"order_number" text NOT NULL,
	"channel" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"stock_status" text DEFAULT 'not_reserved' NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"completed_by_user_id" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_product_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"product_id" text NOT NULL,
	"source_key" text NOT NULL,
	"label" text NOT NULL,
	"value_text" text NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_product_prices_label_nonempty" CHECK (length(btrim("commerce_product_prices"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce_products" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"suite_tenant_id" text,
	"source" text DEFAULT 'shared_commerce' NOT NULL,
	"source_filename" text,
	"source_sheet" text DEFAULT '' NOT NULL,
	"source_row_number" integer DEFAULT 0 NOT NULL,
	"source_row_key" text NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"description" text,
	"specification" text,
	"category" text,
	"brand" text,
	"model" text,
	"unit" text,
	"image_url" text,
	"document_url" text,
	"base_price_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"public_visibility" text DEFAULT 'hidden' NOT NULL,
	"raw_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_products_status_valid" CHECK ("commerce_products"."status" in ('active', 'archived', 'draft')),
	CONSTRAINT "commerce_products_visibility_valid" CHECK ("commerce_products"."public_visibility" in ('hidden', 'public', 'private')),
	CONSTRAINT "commerce_products_name_nonempty" CHECK (length(btrim("commerce_products"."name")) > 0),
	CONSTRAINT "commerce_products_source_row_key_nonempty" CHECK (length(btrim("commerce_products"."source_row_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce_settings" (
	"business_id" text PRIMARY KEY NOT NULL,
	"suite_tenant_id" text,
	"items_enabled" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"column_mapping" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_stock_balances" (
	"product_id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"available_qty" integer DEFAULT 0 NOT NULL,
	"reserved_qty" integer DEFAULT 0 NOT NULL,
	"last_movement_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_stock_balances_available_nonnegative" CHECK ("commerce_stock_balances"."available_qty" >= 0),
	CONSTRAINT "commerce_stock_balances_reserved_nonnegative" CHECK ("commerce_stock_balances"."reserved_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce_stock_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"suite_tenant_id" text,
	"product_id" text NOT NULL,
	"order_id" text,
	"movement_type" text NOT NULL,
	"quantity_delta" integer NOT NULL,
	"balance_after" integer,
	"source_ref_type" text,
	"source_ref_id" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_stock_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"order_line_id" text,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_stock_reservations_status_valid" CHECK ("commerce_stock_reservations"."status" in ('active', 'consumed', 'released', 'expired')),
	CONSTRAINT "commerce_stock_reservations_quantity_positive" CHECK ("commerce_stock_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_consumption_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"channel_identity_id" text,
	"credits_consumed" integer DEFAULT 1 NOT NULL,
	"event_type" text DEFAULT 'ai_message' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_topups" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"channel_identity_id" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'MYR' NOT NULL,
	"type" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"senangpay_order_id" text,
	"senangpay_transaction_id" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"channel_identity_id" text,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"profile_picture_url" text,
	"platform_meta" jsonb DEFAULT '{}'::jsonb,
	"bot_paused" boolean DEFAULT false NOT NULL,
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
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_id_nonempty" CHECK (length(btrim("customers"."id")) > 0),
	CONSTRAINT "customers_business_id_nonempty" CHECK (length(btrim("customers"."business_id")) > 0),
	CONSTRAINT "customers_external_id_nonempty" CHECK (length(btrim("customers"."external_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "instagram_identity_details" (
	"channel_identity_id" text PRIMARY KEY NOT NULL,
	"instagram_business_account_id" text NOT NULL,
	"username" text,
	"page_id" text,
	"access_token_ref" text,
	"webhook_subscribed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_product_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"product_id" text NOT NULL,
	"title" text DEFAULT 'Offer' NOT NULL,
	"original_price_text" text,
	"original_price_amount" numeric(14, 2),
	"offer_price_text" text NOT NULL,
	"offer_price_amount" numeric(14, 2),
	"currency" text DEFAULT 'LKR' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_product_offers_title_nonempty" CHECK (length(btrim("inventory_product_offers"."title")) > 0),
	CONSTRAINT "inventory_product_offers_price_nonempty" CHECK (length(btrim("inventory_product_offers"."offer_price_text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_product_price_options" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"product_id" text NOT NULL,
	"source_key" text NOT NULL,
	"label" text NOT NULL,
	"value_text" text NOT NULL,
	"amount" numeric(14, 2),
	"currency" text DEFAULT 'LKR' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_product_price_options_label_nonempty" CHECK (length(btrim("inventory_product_price_options"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_products" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"training_document_id" text,
	"source" text NOT NULL,
	"source_filename" text,
	"source_sheet" text DEFAULT '' NOT NULL,
	"source_row_number" integer NOT NULL,
	"source_row_key" text NOT NULL,
	"item_code" text,
	"name" text NOT NULL,
	"specification" text,
	"description" text,
	"category" text,
	"brand" text,
	"model" text,
	"media_url" text,
	"media_type" text,
	"media_filename" text,
	"quantity_on_hand" integer,
	"quantity_initial" integer,
	"quantity_unit" text,
	"search_text" text DEFAULT '' NOT NULL,
	"raw_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_products_status_valid" CHECK ("inventory_products"."status" in ('active', 'archived')),
	CONSTRAINT "inventory_products_name_nonempty" CHECK (length(btrim("inventory_products"."name")) > 0),
	CONSTRAINT "inventory_products_source_row_key_nonempty" CHECK (length(btrim("inventory_products"."source_row_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"product_id" text NOT NULL,
	"order_id" text NOT NULL,
	"customer_id" text,
	"thread_id" text,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_status_valid" CHECK ("inventory_reservations"."status" in ('held', 'consumed', 'released', 'expired')),
	CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("inventory_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "message_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"customer_id" text,
	"thread_id" text,
	"channel_identity_id" text,
	"recipient" text,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"provider_response" jsonb DEFAULT 'null'::jsonb,
	"idempotency_key" text NOT NULL,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"channel_identity_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_direction" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_throttles" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"bucket" text NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
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
CREATE TABLE "order_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"order_id" text NOT NULL,
	"customer_id" text,
	"thread_id" text,
	"channel_identity_id" text,
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
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"support_ticket_id" text,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"customer_id" text,
	"thread_id" text,
	"channel_identity_id" text,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"fulfillment_status" text DEFAULT 'queued' NOT NULL,
	"fulfillment_updated_at" timestamp with time zone,
	"recipient_name" text,
	"recipient_phone" text,
	"shipping_address" text,
	"delivery_area" text,
	"delivery_notes" text,
	"courier_name" text,
	"tracking_number" text,
	"tracking_url" text,
	"dispatch_reference" text,
	"scheduled_delivery_at" timestamp with time zone,
	"fulfillment_notes" text,
	"packed_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"out_for_delivery_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_delivery_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
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
	"invoice_number" text,
	"invoice_url" text,
	"invoice_storage_path" text,
	"invoice_file_name" text,
	"invoice_status" text DEFAULT 'not_sent' NOT NULL,
	"invoice_delivery_method" text,
	"invoice_generated_at" timestamp with time zone,
	"invoice_sent_at" timestamp with time zone,
	"refund_requested_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refund_amount" numeric(12, 2),
	"refund_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"customer_id" text,
	"customer_number" text,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"source_meta" jsonb DEFAULT '{}'::jsonb,
	"sentiment" text NOT NULL,
	"status" text DEFAULT 'ongoing' NOT NULL,
	"type" text DEFAULT 'browsing' NOT NULL,
	"price" numeric(10, 2) DEFAULT '0',
	"paid" boolean DEFAULT false NOT NULL,
	"summary" text,
	"bot_version" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_id_nonempty" CHECK (length(btrim("requests"."id")) > 0),
	CONSTRAINT "requests_business_id_nonempty" CHECK (length(btrim("requests"."business_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "support_ticket_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"actor_label" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_types" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_ticket_types_key_nonempty" CHECK (length(btrim("support_ticket_types"."key")) > 0),
	CONSTRAINT "support_ticket_types_label_nonempty" CHECK (length(btrim("support_ticket_types"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_number" text DEFAULT ('A'::text || lpad((nextval('support_ticket_number_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
	"business_id" text NOT NULL,
	"ticket_type_id" text,
	"ticket_type_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"loss_reason" text,
	"sla_due_at" timestamp with time zone,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"customer_id" text,
	"thread_id" text,
	"channel_identity_id" text,
	"customer_name" text,
	"customer_phone" text,
	"idempotency_key" text,
	"title" text,
	"summary" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_by" text DEFAULT 'bot' NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
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
	"firebase_uid" text NOT NULL,
	"suite_user_id" text,
	"whatsapp_connected" boolean DEFAULT false NOT NULL,
	"business_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_nonempty" CHECK (length(btrim("users"."id")) > 0),
	CONSTRAINT "users_email_nonempty" CHECK (length(btrim("users"."email")) > 0),
	CONSTRAINT "users_firebase_uid_nonempty" CHECK (length(btrim("users"."firebase_uid")) > 0),
	CONSTRAINT "users_business_id_nonempty" CHECK (length(btrim("users"."business_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_identity_details" (
	"channel_identity_id" text PRIMARY KEY NOT NULL,
	"phone_number_id" text NOT NULL,
	"waba_id" text,
	"display_phone_number" text,
	"two_step_pin" text,
	"webhook_subscribed_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"credit_line_shared_at" timestamp with time zone,
	"credit_line_allocation_config_id" text,
	"waba_currency" text
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_channel_identity_id_whatsapp_identities_phone_" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "business_customization_settings" ADD CONSTRAINT "business_customization_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "business_order_settings" ADD CONSTRAINT "business_order_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "business_preferences" ADD CONSTRAINT "business_preferences_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "business_user_invites" ADD CONSTRAINT "business_user_invites_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "business_user_invites" ADD CONSTRAINT "business_user_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "business_website_widget_settings" ADD CONSTRAINT "business_website_widget_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_customer_profiles" ADD CONSTRAINT "commerce_customer_profiles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_customer_profiles" ADD CONSTRAINT "commerce_customer_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_import_batches" ADD CONSTRAINT "commerce_import_batches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_import_batches" ADD CONSTRAINT "commerce_import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_import_rows" ADD CONSTRAINT "commerce_import_rows_batch_id_commerce_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."commerce_import_batches"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_import_rows" ADD CONSTRAINT "commerce_import_rows_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_import_rows" ADD CONSTRAINT "commerce_import_rows_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_loyalty_ledger" ADD CONSTRAINT "commerce_loyalty_ledger_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_loyalty_ledger" ADD CONSTRAINT "commerce_loyalty_ledger_profile_id_commerce_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."commerce_customer_profiles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_loyalty_ledger" ADD CONSTRAINT "commerce_loyalty_ledger_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_membership_plans" ADD CONSTRAINT "commerce_membership_plans_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_memberships" ADD CONSTRAINT "commerce_memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_memberships" ADD CONSTRAINT "commerce_memberships_profile_id_commerce_customer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."commerce_customer_profiles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_memberships" ADD CONSTRAINT "commerce_memberships_plan_id_commerce_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commerce_membership_plans"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_memberships" ADD CONSTRAINT "commerce_memberships_source_order_id_commerce_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_offers" ADD CONSTRAINT "commerce_offers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_offers" ADD CONSTRAINT "commerce_offers_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_order_lines" ADD CONSTRAINT "commerce_order_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_order_lines" ADD CONSTRAINT "commerce_order_lines_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_order_lines" ADD CONSTRAINT "commerce_order_lines_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_order_lines" ADD CONSTRAINT "commerce_order_lines_price_id_commerce_product_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."commerce_product_prices"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_order_payments" ADD CONSTRAINT "commerce_order_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_order_payments" ADD CONSTRAINT "commerce_order_payments_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_order_payments" ADD CONSTRAINT "commerce_order_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_product_prices" ADD CONSTRAINT "commerce_product_prices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_product_prices" ADD CONSTRAINT "commerce_product_prices_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_settings" ADD CONSTRAINT "commerce_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_stock_balances" ADD CONSTRAINT "commerce_stock_balances_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_stock_balances" ADD CONSTRAINT "commerce_stock_balances_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ADD CONSTRAINT "commerce_stock_movements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ADD CONSTRAINT "commerce_stock_movements_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_stock_movements" ADD CONSTRAINT "commerce_stock_movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_stock_reservations" ADD CONSTRAINT "commerce_stock_reservations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commerce_stock_reservations" ADD CONSTRAINT "commerce_stock_reservations_product_id_commerce_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commerce_products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_consumption_events" ADD CONSTRAINT "credit_consumption_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_consumption_events" ADD CONSTRAINT "credit_consumption_events_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_topups" ADD CONSTRAINT "credit_topups_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "credit_topups" ADD CONSTRAINT "credit_topups_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_channel_identity_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "instagram_identity_details" ADD CONSTRAINT "instagram_identity_details_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_product_offers" ADD CONSTRAINT "inventory_product_offers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_product_offers" ADD CONSTRAINT "inventory_product_offers_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_product_price_options" ADD CONSTRAINT "inventory_product_price_options_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_product_price_options" ADD CONSTRAINT "inventory_price_options_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_products" ADD CONSTRAINT "inventory_products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_products" ADD CONSTRAINT "inventory_products_training_doc_fk" FOREIGN KEY ("training_document_id") REFERENCES "public"."training_documents"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_channel_identity_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_channel_identity_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_throttles" ADD CONSTRAINT "operation_throttles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_whatsapp_identity_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_support_ticket_id_support_tickets_id_fk" FOREIGN KEY ("support_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_whatsapp_identity_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "rag_jobs" ADD CONSTRAINT "rag_jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "rag_jobs" ADD CONSTRAINT "rag_jobs_training_document_id_training_documents_id_fk" FOREIGN KEY ("training_document_id") REFERENCES "public"."training_documents"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_ticket_types" ADD CONSTRAINT "support_ticket_types_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_ticket_type_id_support_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."support_ticket_types"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_channel_identity_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "training_documents" ADD CONSTRAINT "training_documents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "training_documents" ADD CONSTRAINT "training_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whatsapp_identity_details" ADD CONSTRAINT "whatsapp_identity_details_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_events_business_id_idx" ON "ai_usage_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_identity_id_idx" ON "ai_usage_events" USING btree ("channel_identity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_user_invites_token_ux" ON "business_user_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "business_user_invites_business_email_idx" ON "business_user_invites" USING btree ("business_id","email");--> statement-breakpoint
CREATE INDEX "business_user_invites_accepted_idx" ON "business_user_invites" USING btree ("accepted_at");--> statement-breakpoint
CREATE INDEX "business_website_widget_key_idx" ON "business_website_widget_settings" USING btree ("widget_key");--> statement-breakpoint
CREATE INDEX "businesses_is_active_idx" ON "businesses" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ci_business_id_idx" ON "channel_identities" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "ci_provider_idx" ON "channel_identities" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ci_external_acc_idx" ON "channel_identities" USING btree ("external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_bus_prov_ext_ux" ON "channel_identities" USING btree ("business_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "commerce_customer_profiles_business_phone_idx" ON "commerce_customer_profiles" USING btree ("business_id","phone");--> statement-breakpoint
CREATE INDEX "commerce_customer_profiles_business_email_idx" ON "commerce_customer_profiles" USING btree ("business_id","email");--> statement-breakpoint
CREATE INDEX "commerce_customer_profiles_customer_id_idx" ON "commerce_customer_profiles" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "commerce_import_batches_business_created_idx" ON "commerce_import_batches" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "commerce_import_batches_suite_tenant_idx" ON "commerce_import_batches" USING btree ("suite_tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_import_rows_batch_row_ux" ON "commerce_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "commerce_import_rows_business_batch_idx" ON "commerce_import_rows" USING btree ("business_id","batch_id");--> statement-breakpoint
CREATE INDEX "commerce_import_rows_business_source_idx" ON "commerce_import_rows" USING btree ("business_id","source_row_key");--> statement-breakpoint
CREATE INDEX "commerce_loyalty_ledger_business_profile_idx" ON "commerce_loyalty_ledger" USING btree ("business_id","profile_id");--> statement-breakpoint
CREATE INDEX "commerce_loyalty_ledger_order_idx" ON "commerce_loyalty_ledger" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_membership_plans_business_status_idx" ON "commerce_membership_plans" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "commerce_memberships_business_profile_idx" ON "commerce_memberships" USING btree ("business_id","profile_id");--> statement-breakpoint
CREATE INDEX "commerce_memberships_plan_idx" ON "commerce_memberships" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "commerce_offers_business_active_idx" ON "commerce_offers" USING btree ("business_id","active");--> statement-breakpoint
CREATE INDEX "commerce_offers_product_idx" ON "commerce_offers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "commerce_order_lines_business_order_idx" ON "commerce_order_lines" USING btree ("business_id","order_id");--> statement-breakpoint
CREATE INDEX "commerce_order_lines_business_product_idx" ON "commerce_order_lines" USING btree ("business_id","product_id");--> statement-breakpoint
CREATE INDEX "commerce_order_payments_business_order_idx" ON "commerce_order_payments" USING btree ("business_id","order_id");--> statement-breakpoint
CREATE INDEX "commerce_order_payments_bank_reference_idx" ON "commerce_order_payments" USING btree ("business_id","bank_reference_code","paid_amount_minor");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_orders_business_order_number_ux" ON "commerce_orders" USING btree ("business_id","order_number");--> statement-breakpoint
CREATE INDEX "commerce_orders_business_created_idx" ON "commerce_orders" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "commerce_orders_business_status_idx" ON "commerce_orders" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "commerce_orders_suite_tenant_created_idx" ON "commerce_orders" USING btree ("suite_tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "commerce_product_prices_business_id_idx" ON "commerce_product_prices" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "commerce_product_prices_product_id_idx" ON "commerce_product_prices" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_product_prices_product_source_ux" ON "commerce_product_prices" USING btree ("product_id","source_key");--> statement-breakpoint
CREATE INDEX "commerce_products_business_id_idx" ON "commerce_products" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "commerce_products_suite_tenant_status_idx" ON "commerce_products" USING btree ("suite_tenant_id","status");--> statement-breakpoint
CREATE INDEX "commerce_products_business_status_idx" ON "commerce_products" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "commerce_products_business_sku_idx" ON "commerce_products" USING btree ("business_id","sku");--> statement-breakpoint
CREATE INDEX "commerce_products_business_name_idx" ON "commerce_products" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_products_business_source_row_ux" ON "commerce_products" USING btree ("business_id","source_row_key");--> statement-breakpoint
CREATE INDEX "commerce_settings_suite_tenant_idx" ON "commerce_settings" USING btree ("suite_tenant_id");--> statement-breakpoint
CREATE INDEX "commerce_stock_balances_business_qty_idx" ON "commerce_stock_balances" USING btree ("business_id","available_qty");--> statement-breakpoint
CREATE INDEX "commerce_stock_movements_business_created_idx" ON "commerce_stock_movements" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "commerce_stock_movements_product_created_idx" ON "commerce_stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "commerce_stock_movements_source_idx" ON "commerce_stock_movements" USING btree ("source_ref_type","source_ref_id");--> statement-breakpoint
CREATE INDEX "commerce_stock_reservations_business_status_idx" ON "commerce_stock_reservations" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "commerce_stock_reservations_business_order_idx" ON "commerce_stock_reservations" USING btree ("business_id","order_id");--> statement-breakpoint
CREATE INDEX "commerce_stock_reservations_product_idx" ON "commerce_stock_reservations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "credit_consumption_business_idx" ON "credit_consumption_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_consumption_whatsapp_idx" ON "credit_consumption_events" USING btree ("channel_identity_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_topups_business_idx" ON "credit_topups" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "credit_topups_channel_identity_idx" ON "credit_topups" USING btree ("channel_identity_id");--> statement-breakpoint
CREATE INDEX "credit_topups_status_idx" ON "credit_topups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_topups_created_at_idx" ON "credit_topups" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_composite_ux" ON "customers" USING btree ("business_id","source","external_id","channel_identity_id");--> statement-breakpoint
CREATE INDEX "customers_business_id_idx" ON "customers" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "customers_channel_identity_id_idx" ON "customers" USING btree ("channel_identity_id");--> statement-breakpoint
CREATE INDEX "customers_source_idx" ON "customers" USING btree ("source");--> statement-breakpoint
CREATE INDEX "customers_business_source_idx" ON "customers" USING btree ("business_id","source");--> statement-breakpoint
CREATE INDEX "customers_external_id_idx" ON "customers" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "customers_last_message_at_idx" ON "customers" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "customers_lead_score_idx" ON "customers" USING btree ("lead_score");--> statement-breakpoint
CREATE INDEX "customers_high_intent_idx" ON "customers" USING btree ("business_id","is_high_intent");--> statement-breakpoint
CREATE INDEX "customers_total_revenue_idx" ON "customers" USING btree ("business_id","total_revenue");--> statement-breakpoint
CREATE INDEX "customers_bot_paused_idx" ON "customers" USING btree ("business_id","bot_paused");--> statement-breakpoint
CREATE INDEX "customers_deleted_at_idx" ON "customers" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ig_details_bus_acc_id_ux" ON "instagram_identity_details" USING btree ("instagram_business_account_id");--> statement-breakpoint
CREATE INDEX "inventory_product_offers_business_id_idx" ON "inventory_product_offers" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "inventory_product_offers_product_id_idx" ON "inventory_product_offers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_product_offers_active_idx" ON "inventory_product_offers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "inventory_product_price_options_business_id_idx" ON "inventory_product_price_options" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "inventory_product_price_options_product_id_idx" ON "inventory_product_price_options" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_product_price_options_product_source_ux" ON "inventory_product_price_options" USING btree ("product_id","source_key");--> statement-breakpoint
CREATE INDEX "inventory_products_business_id_idx" ON "inventory_products" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "inventory_products_training_document_id_idx" ON "inventory_products" USING btree ("training_document_id");--> statement-breakpoint
CREATE INDEX "inventory_products_name_idx" ON "inventory_products" USING btree ("name");--> statement-breakpoint
CREATE INDEX "inventory_products_item_code_idx" ON "inventory_products" USING btree ("item_code");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_products_business_source_row_ux" ON "inventory_products" USING btree ("business_id","source_row_key");--> statement-breakpoint
CREATE INDEX "inventory_reservations_business_id_idx" ON "inventory_reservations" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_product_id_idx" ON "inventory_reservations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_order_id_idx" ON "inventory_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_active_idx" ON "inventory_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "message_outbox_status_idx" ON "message_outbox" USING btree ("business_id","status","created_at");--> statement-breakpoint
CREATE INDEX "message_outbox_entity_idx" ON "message_outbox" USING btree ("business_id","entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "message_outbox_thread_idx" ON "message_outbox" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_outbox_business_idempotency_uk" ON "message_outbox" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "message_threads_business_customer_identity_ux" ON "message_threads" USING btree ("business_id","customer_id","channel_identity_id");--> statement-breakpoint
CREATE INDEX "message_threads_business_id_idx" ON "message_threads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "message_threads_customer_id_idx" ON "message_threads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "message_threads_channel_identity_id_idx" ON "message_threads" USING btree ("channel_identity_id");--> statement-breakpoint
CREATE INDEX "message_threads_last_message_at_idx" ON "message_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "message_threads_business_active_last_message_idx" ON "message_threads" USING btree ("business_id","last_message_at","id") WHERE "message_threads"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "message_threads_business_identity_active_last_message_idx" ON "message_threads" USING btree ("business_id","channel_identity_id","last_message_at","id") WHERE "message_threads"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "message_threads_deleted_at_idx" ON "message_threads" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "operation_throttles_business_bucket_idx" ON "operation_throttles" USING btree ("business_id","bucket","reset_at");--> statement-breakpoint
CREATE INDEX "operation_throttles_reset_at_idx" ON "operation_throttles" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "order_events_business_id_idx" ON "order_events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "order_events_order_id_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_created_at_idx" ON "order_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_payments_business_id_idx" ON "order_payments" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "order_payments_order_id_idx" ON "order_payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_payments_status_idx" ON "order_payments" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "order_payments_created_at_idx" ON "order_payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_payments_business_order_created_idx" ON "order_payments" USING btree ("business_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_business_id_idx" ON "orders" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "orders_fulfillment_status_idx" ON "orders" USING btree ("business_id","fulfillment_status");--> statement-breakpoint
CREATE INDEX "orders_business_updated_created_idx" ON "orders" USING btree ("business_id","updated_at","created_at");--> statement-breakpoint
CREATE INDEX "orders_business_created_idx" ON "orders" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_business_method_updated_created_idx" ON "orders" USING btree ("business_id","payment_method","updated_at","created_at");--> statement-breakpoint
CREATE INDEX "orders_business_method_created_idx" ON "orders" USING btree ("business_id","payment_method","created_at");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_support_ticket_id_ux" ON "orders" USING btree ("support_ticket_id") WHERE "orders"."support_ticket_id" is not null;--> statement-breakpoint
CREATE INDEX "rag_jobs_business_id_idx" ON "rag_jobs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "rag_jobs_status_idx" ON "rag_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rag_jobs_created_at_idx" ON "rag_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "requests_business_id_idx" ON "requests" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "requests_customer_number_idx" ON "requests" USING btree ("customer_number");--> statement-breakpoint
CREATE INDEX "requests_customer_id_idx" ON "requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "requests_business_customer_idx" ON "requests" USING btree ("business_id","customer_number");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requests_business_status_idx" ON "requests" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "requests_source_idx" ON "requests" USING btree ("source");--> statement-breakpoint
CREATE INDEX "requests_business_source_idx" ON "requests" USING btree ("business_id","source");--> statement-breakpoint
CREATE INDEX "requests_business_customer_created_idx" ON "requests" USING btree ("business_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "requests_business_type_idx" ON "requests" USING btree ("business_id","type");--> statement-breakpoint
CREATE INDEX "requests_business_bot_version_idx" ON "requests" USING btree ("business_id","bot_version");--> statement-breakpoint
CREATE INDEX "requests_created_at_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "requests_deleted_at_idx" ON "requests" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "support_ticket_events_business_id_idx" ON "support_ticket_events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "support_ticket_events_ticket_id_idx" ON "support_ticket_events" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_ticket_events_created_at_idx" ON "support_ticket_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_ticket_types_business_id_idx" ON "support_ticket_types" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "support_ticket_types_enabled_idx" ON "support_ticket_types" USING btree ("business_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "support_ticket_types_business_key_ux" ON "support_ticket_types" USING btree ("business_id","key");--> statement-breakpoint
CREATE INDEX "support_tickets_business_id_idx" ON "support_tickets" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "support_tickets_type_idx" ON "support_tickets" USING btree ("business_id","ticket_type_key");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "support_tickets_outcome_idx" ON "support_tickets" USING btree ("business_id","outcome");--> statement-breakpoint
CREATE INDEX "support_tickets_type_updated_created_idx" ON "support_tickets" USING btree ("business_id","ticket_type_key","updated_at","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_status_updated_created_idx" ON "support_tickets" USING btree ("business_id","status","updated_at","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_outcome_updated_idx" ON "support_tickets" USING btree ("business_id","outcome","updated_at");--> statement-breakpoint
CREATE INDEX "support_tickets_sla_due_at_idx" ON "support_tickets" USING btree ("sla_due_at");--> statement-breakpoint
CREATE INDEX "support_tickets_created_at_idx" ON "support_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_customer_id_idx" ON "support_tickets" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_ticket_number_ux" ON "support_tickets" USING btree ("ticket_number");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_business_idempotency_uk" ON "support_tickets" USING btree ("business_id","idempotency_key") WHERE "support_tickets"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "thread_messages_thread_id_idx" ON "thread_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "thread_messages_created_at_idx" ON "thread_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "thread_messages_thread_direction_created_idx" ON "thread_messages" USING btree ("thread_id","direction","created_at");--> statement-breakpoint
CREATE INDEX "thread_messages_thread_created_latest_idx" ON "thread_messages" USING btree ("thread_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_messages_external_message_id_ux" ON "thread_messages" USING btree ("external_message_id") WHERE "thread_messages"."external_message_id" is not null;--> statement-breakpoint
CREATE INDEX "training_documents_business_id_idx" ON "training_documents" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_documents_business_doc_type_ux" ON "training_documents" USING btree ("business_id","doc_type");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_ux" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_firebase_uid_ux" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "users_business_id_idx" ON "users" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "users_suite_user_id_idx" ON "users" USING btree ("suite_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_details_phone_id_ux" ON "whatsapp_identity_details" USING btree ("phone_number_id");