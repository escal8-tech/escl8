-- Message thread list performance upgrade.
--
-- Run this once on staging and production before deploying code that reads
-- message_threads.last_message_direction.
--
-- The denormalized direction removes per-thread latest-message lookups from
-- the Messages inbox while keeping thread_messages as the source of truth.

ALTER TABLE message_threads
  ADD COLUMN IF NOT EXISTS last_message_direction text;

UPDATE message_threads mt
SET last_message_direction = latest.direction
FROM (
  SELECT DISTINCT ON (thread_id)
    thread_id,
    direction
  FROM thread_messages
  ORDER BY thread_id, created_at DESC, id DESC
) latest
WHERE latest.thread_id = mt.id
  AND mt.last_message_direction IS DISTINCT FROM latest.direction;

CREATE INDEX CONCURRENTLY IF NOT EXISTS message_threads_business_active_last_message_idx
  ON message_threads (business_id, last_message_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS message_threads_business_identity_active_last_message_idx
  ON message_threads (business_id, whatsapp_identity_id, last_message_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS thread_messages_thread_created_latest_idx
  ON thread_messages (thread_id, created_at, id);
