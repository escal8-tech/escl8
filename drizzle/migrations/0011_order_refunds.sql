ALTER TABLE "orders"
  ADD COLUMN "refund_requested_at" timestamp with time zone,
  ADD COLUMN "refunded_at" timestamp with time zone,
  ADD COLUMN "refund_amount" numeric(12, 2),
  ADD COLUMN "refund_reason" text;
