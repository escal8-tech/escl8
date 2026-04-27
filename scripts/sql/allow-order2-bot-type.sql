ALTER TABLE whatsapp_identities
  DROP CONSTRAINT IF EXISTS wa_identities_bot_type_valid;

ALTER TABLE whatsapp_identities
  ADD CONSTRAINT wa_identities_bot_type_valid
  CHECK (bot_type IN ('AGENT', 'CONCIERGE', 'ORDER', 'ORDER2', 'RESERVATION'));
