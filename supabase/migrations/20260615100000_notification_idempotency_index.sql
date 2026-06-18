-- Notification automation idempotency
-- Prevents duplicate events for the same rule+entity within a short window

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_events_idempotent
  ON public.notification_events (rule_key, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;
