ALTER TABLE support_tickets
ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_business_idempotency_uk
ON support_tickets (business_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_outbox (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  entity_type text,
  entity_id text,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  thread_id text REFERENCES message_threads(id) ON DELETE SET NULL ON UPDATE CASCADE,
  whatsapp_identity_id text REFERENCES whatsapp_identities(phone_number_id) ON DELETE SET NULL ON UPDATE CASCADE,
  recipient text,
  channel text NOT NULL DEFAULT 'whatsapp',
  source text NOT NULL DEFAULT 'system',
  message_type text NOT NULL DEFAULT 'text',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  provider_message_id text,
  provider_response jsonb,
  idempotency_key text NOT NULL,
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_outbox_business_idempotency_uk
ON message_outbox (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS message_outbox_status_idx
ON message_outbox (business_id, status, created_at);

CREATE INDEX IF NOT EXISTS message_outbox_entity_idx
ON message_outbox (business_id, entity_type, entity_id, created_at);

CREATE INDEX IF NOT EXISTS message_outbox_thread_idx
ON message_outbox (thread_id, created_at);
