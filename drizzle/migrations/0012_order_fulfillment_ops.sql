ALTER TABLE "orders"
  ADD COLUMN "fulfillment_status" text DEFAULT 'queued' NOT NULL,
  ADD COLUMN "fulfillment_updated_at" timestamp with time zone,
  ADD COLUMN "recipient_name" text,
  ADD COLUMN "recipient_phone" text,
  ADD COLUMN "shipping_address" text,
  ADD COLUMN "delivery_area" text,
  ADD COLUMN "delivery_notes" text,
  ADD COLUMN "courier_name" text,
  ADD COLUMN "tracking_number" text,
  ADD COLUMN "tracking_url" text,
  ADD COLUMN "dispatch_reference" text,
  ADD COLUMN "scheduled_delivery_at" timestamp with time zone,
  ADD COLUMN "fulfillment_notes" text,
  ADD COLUMN "packed_at" timestamp with time zone,
  ADD COLUMN "dispatched_at" timestamp with time zone,
  ADD COLUMN "out_for_delivery_at" timestamp with time zone,
  ADD COLUMN "delivered_at" timestamp with time zone,
  ADD COLUMN "failed_delivery_at" timestamp with time zone,
  ADD COLUMN "returned_at" timestamp with time zone;

CREATE INDEX "orders_fulfillment_status_idx" ON "orders" USING btree ("business_id", "fulfillment_status");
