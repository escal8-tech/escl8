-- Normalize order/message relationships out of thread_messages.meta.
-- Safe to run multiple times.

ALTER TABLE thread_messages
  ADD COLUMN IF NOT EXISTS linked_order_id text,
  ADD COLUMN IF NOT EXISTS message_kind text,
  ADD COLUMN IF NOT EXISTS reply_id text,
  ADD COLUMN IF NOT EXISTS reply_title text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS thread_anchor_message_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'thread_messages_linked_order_id_fkey'
  ) THEN
    ALTER TABLE thread_messages
      ADD CONSTRAINT thread_messages_linked_order_id_fkey
      FOREIGN KEY (linked_order_id) REFERENCES orders(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_thread_anchor_message_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_thread_anchor_message_id_fkey
      FOREIGN KEY (thread_anchor_message_id) REFERENCES thread_messages(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE thread_messages
SET
  linked_order_id = NULLIF(
    TRIM(
      COALESCE(
        meta -> 'orderAnchor' ->> 'orderId',
        meta -> 'sourceMeta' ->> 'orderId',
        ''
      )
    ),
    ''
  ),
  message_kind = NULLIF(
    TRIM(
      COALESCE(
        meta -> 'orderAnchor' ->> 'kind',
        meta -> 'sourceMeta' ->> 'kind',
        ''
      )
    ),
    ''
  )
WHERE linked_order_id IS NULL
  AND (
    COALESCE(meta -> 'orderAnchor' ->> 'orderId', meta -> 'sourceMeta' ->> 'orderId', '') <> ''
    OR COALESCE(meta -> 'orderAnchor' ->> 'kind', meta -> 'sourceMeta' ->> 'kind', '') <> ''
  );

UPDATE thread_messages
SET
  reply_id = NULLIF(TRIM(meta -> 'interactive' ->> 'reply_id'), ''),
  reply_title = NULLIF(TRIM(meta -> 'interactive' ->> 'reply_title'), ''),
  message_kind = COALESCE(
    NULLIF(message_kind, ''),
    CASE
      WHEN NULLIF(TRIM(meta -> 'interactive' ->> 'reply_id'), '') IS NOT NULL
        OR NULLIF(TRIM(meta -> 'interactive' ->> 'reply_title'), '') IS NOT NULL
        THEN 'interactive_reply'
      ELSE message_kind
    END
  )
WHERE direction = 'inbound'
  AND (
    COALESCE(meta -> 'interactive' ->> 'reply_id', '') <> ''
    OR COALESCE(meta -> 'interactive' ->> 'reply_title', '') <> ''
  );

UPDATE thread_messages
SET
  reply_id = COALESCE(NULLIF(reply_id, ''), NULLIF(TRIM(text_body), '')),
  message_kind = COALESCE(NULLIF(message_kind, ''), 'interactive_reply')
WHERE direction = 'inbound'
  AND message_kind IS NULL
  AND text_body ~* '^(o2:|order:)';

UPDATE orders AS o
SET thread_anchor_message_id = anchor.message_id
FROM (
  SELECT DISTINCT ON (tm.linked_order_id)
    tm.linked_order_id AS order_id,
    tm.id AS message_id
  FROM thread_messages tm
  WHERE tm.linked_order_id IS NOT NULL
    AND tm.message_kind IN (
      'order2_tracking_link',
      'order2_invoice',
      'order2_payment_pending',
      'order2_payment_finalize_failed',
      'order2_inventory_shortage'
    )
  ORDER BY tm.linked_order_id, tm.created_at DESC, tm.id DESC
) AS anchor
WHERE o.id = anchor.order_id
  AND (
    o.thread_anchor_message_id IS NULL
    OR o.thread_anchor_message_id <> anchor.message_id
  );

CREATE INDEX IF NOT EXISTS thread_messages_linked_order_id_idx
  ON thread_messages (linked_order_id)
  WHERE linked_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS thread_messages_thread_linked_order_created_idx
  ON thread_messages (thread_id, linked_order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_thread_anchor_message_id_idx
  ON orders (thread_anchor_message_id)
  WHERE thread_anchor_message_id IS NOT NULL;