-- ADR-0031 Phase 7 — extend _chat_mutation_log_config for widget 218 (ADR registry, table 2197)
-- Adds two more meaningful rules on top of P3 seed (status_id, name, category):
--   * hidden          — archive proxy (registry uses `hidden` checkbox, not archived_at)
--   * review_status   — published/approved/draft transitions outside status_id
-- Idempotent via ON CONFLICT.

INSERT INTO _chat_mutation_log_config (table_id, column_key, template, event_type, enabled) VALUES
  (2197, 'hidden',        '{% if new.hidden %}📦 Hidden by {{actor.name}}{% else %}📂 Unhidden by {{actor.name}}{% endif %}', 'archive',       true),
  (2197, 'review_status', '📑 Review: {{display.old}} → {{display.new}}',                                                    'review_change', true)
ON CONFLICT (table_id, column_key) DO NOTHING;
