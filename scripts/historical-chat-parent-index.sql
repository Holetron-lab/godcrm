-- Authorized migration operator only; outside a transaction (CONCURRENTLY).
-- Required for bounded historical-chat rollback: the self-referencing FK
-- otherwise scans messages once for every deleted message.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_historical_parent
  ON public.messages (parent_id) WHERE parent_id IS NOT NULL;
