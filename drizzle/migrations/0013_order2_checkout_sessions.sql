CREATE TABLE IF NOT EXISTS order2_checkout_sessions (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  thread_id text REFERENCES message_threads(id) ON DELETE SET NULL ON UPDATE CASCADE,
  channel_identity_id text,
  agent_id text,
  customer_phone text,
  status text NOT NULL DEFAULT 'awaiting_payment',
  fulfillment_method text,
  payment_method text NOT NULL DEFAULT 'bank_qr',
  currency text NOT NULL DEFAULT 'LKR',
  expected_amount numeric(12, 2),
  payment_reference text NOT NULL,
  public_reference text,
  cart_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ticket_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_id text REFERENCES orders(id) ON DELETE SET NULL ON UPDATE CASCADE,
  cancelled_at timestamptz,
  converted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order2_checkout_sessions_business_status_idx
  ON order2_checkout_sessions (business_id, status);

CREATE INDEX IF NOT EXISTS order2_checkout_sessions_business_payment_ref_idx
  ON order2_checkout_sessions (business_id, payment_reference);

CREATE INDEX IF NOT EXISTS order2_checkout_sessions_order_id_idx
  ON order2_checkout_sessions (order_id)
  WHERE order_id IS NOT NULL;