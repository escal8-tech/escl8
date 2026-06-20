ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS channel_identity_id text;

ALTER TABLE order_payments
  ADD COLUMN IF NOT EXISTS channel_identity_id text;

WITH order_channel_map AS (
  SELECT
    o.id,
    COALESCE(
      c.channel_identity_id,
      t.channel_identity_id,
      wid.channel_identity_id
    ) AS target_channel_identity_id
  FROM orders o
  LEFT JOIN customers c
    ON c.id = o.customer_id
  LEFT JOIN message_threads t
    ON t.id = o.thread_id
  LEFT JOIN whatsapp_identity_details wid
    ON wid.phone_number_id = o.whatsapp_identity_id
)
UPDATE orders o
SET channel_identity_id = m.target_channel_identity_id
FROM order_channel_map m
WHERE o.id = m.id
  AND m.target_channel_identity_id IS NOT NULL
  AND o.channel_identity_id IS DISTINCT FROM m.target_channel_identity_id;

WITH order_channel_map AS (
  SELECT
    o.id,
    COALESCE(
      c.channel_identity_id,
      t.channel_identity_id,
      wid.channel_identity_id
    ) AS target_channel_identity_id
  FROM orders o
  LEFT JOIN customers c
    ON c.id = o.customer_id
  LEFT JOIN message_threads t
    ON t.id = o.thread_id
  LEFT JOIN whatsapp_identity_details wid
    ON wid.phone_number_id = o.whatsapp_identity_id
),
payment_channel_map AS (
  SELECT
    op.id,
    COALESCE(
      c.channel_identity_id,
      t.channel_identity_id,
      ocm.target_channel_identity_id,
      wid.channel_identity_id
    ) AS target_channel_identity_id
  FROM order_payments op
  LEFT JOIN customers c
    ON c.id = op.customer_id
  LEFT JOIN message_threads t
    ON t.id = op.thread_id
  LEFT JOIN order_channel_map ocm
    ON ocm.id = op.order_id
  LEFT JOIN whatsapp_identity_details wid
    ON wid.phone_number_id = op.whatsapp_identity_id
)
UPDATE order_payments op
SET channel_identity_id = m.target_channel_identity_id
FROM payment_channel_map m
WHERE op.id = m.id
  AND m.target_channel_identity_id IS NOT NULL
  AND op.channel_identity_id IS DISTINCT FROM m.target_channel_identity_id;

CREATE INDEX IF NOT EXISTS orders_channel_identity_id_idx
  ON orders (channel_identity_id);

CREATE INDEX IF NOT EXISTS order_payments_channel_identity_id_idx
  ON order_payments (channel_identity_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_whatsapp_identity_fk'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_whatsapp_identity_fk
      FOREIGN KEY (channel_identity_id)
      REFERENCES channel_identities(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_payments_whatsapp_identity_fk'
      AND conrelid = 'order_payments'::regclass
  ) THEN
    ALTER TABLE order_payments
      ADD CONSTRAINT order_payments_whatsapp_identity_fk
      FOREIGN KEY (channel_identity_id)
      REFERENCES channel_identities(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
