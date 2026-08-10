-- ADR-0061 P0 — Runtime budgets + termination_reason + _agent_runs trace
-- Date: 2026-05-16
-- Author: @developer-ralph
-- Doc: 156716 (ADR-0061)
-- Ticket: T-156843
-- Companion rollback: scripts/rollback/adr-0061-p0-down.sql
--
-- Scope:
--   1. Add `default_budget_json` (json) virtual column on agents (table_id=1784)
--   2. Create `_agent_runs` virtual table (table_id=100001) with run-trace cols
--
-- Storage model: virtual columns (rows in table_columns), data in table_rows.data JSONB.
-- No physical postgres tables created — matches ADR-0030 P1 convention.
--
-- Idempotent: every INSERT is gated by WHERE NOT EXISTS, safe to re-run.

BEGIN;

-- =============================================================
-- Part 1 — default_budget_json on agents (table_id=1784)
-- Shape: {step_limit, time_limit_ms, tool_call_limit, token_limit?}
-- Nullable, no row-level default. NULL = harness defaults apply.
-- =============================================================

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1784, 'default_budget_json', 'Default Budget', 'json',
       '{"appearance":{"align":"left","indicator":{"type":"emoji","value":"🛡️"}},"cellFormat":{"mode":"markdown","textWrap":"wrap"}}',
       200, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1784 AND column_name='default_budget_json');


-- =============================================================
-- Part 2 — _agent_runs virtual table (table_id=100001)
-- One row per agentLoop run. Holds the trace pulled into the
-- termination chip (run row → chip via send_widget_message).
-- Metadata lives in `universal_tables` (canonical store read by
-- the chip resolver in agent-tools/chat-tools.js).
-- =============================================================

INSERT INTO universal_tables (id, project_id, name, display_name, icon, is_system, show_in_nav, created_at, updated_at)
SELECT 100001, 1, '_agent_runs', 'Agent Runs', '🛡️', 1, 0, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM universal_tables WHERE id=100001);

-- Keep sequence ahead of explicit id so future auto-assigns don't collide.
SELECT setval('universal_tables_id_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM universal_tables), 100001), true);

-- conversation_id: which conversation triggered the run (chip target)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'conversation_id', 'Conversation', 'number', '{}', 0, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='conversation_id');

-- agent_id: agent row id (table 1784)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'agent_id', 'Agent', 'number', '{}', 1, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='agent_id');

-- ticket_id: ticket row id (table 1708) — non-null for agent-worker dispatched runs
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'ticket_id', 'Ticket', 'number', '{}', 2, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='ticket_id');

-- started_at: ISO timestamp of loop entry
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'started_at', 'Started', 'datetime', '{}', 3, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='started_at');

-- ended_at: ISO timestamp of termination
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'ended_at', 'Ended', 'datetime', '{}', 4, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='ended_at');

-- termination_reason: enum (free-text after colon for out_of_budget:<field>)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'termination_reason', 'Termination', 'select',
       '{"appearance":{"align":"left","indicator":{"type":"emoji","value":"🛑"}},"options":[{"label":"goal_reached"},{"label":"human_stop"},{"label":"out_of_budget"},{"label":"out_of_budget:step_limit"},{"label":"out_of_budget:time_limit_ms"},{"label":"out_of_budget:tool_call_limit"},{"label":"out_of_budget:token_limit"},{"label":"tool_denied"},{"label":"error_unrecoverable"}]}',
       5, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='termination_reason');

-- budget_json: snapshot of the effective merged budget for this run
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'budget_json', 'Budget', 'json',
       '{"appearance":{"align":"left","indicator":{"type":"emoji","value":"🎯"}},"cellFormat":{"mode":"markdown"}}',
       6, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='budget_json');

-- budget_consumed_json: final counter snapshot {steps, time_ms, tool_calls, tokens?}
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'budget_consumed_json', 'Consumed', 'json',
       '{"appearance":{"align":"left","indicator":{"type":"emoji","value":"📊"}},"cellFormat":{"mode":"markdown"}}',
       7, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='budget_consumed_json');

-- provider: which branch executed (anthropic/openai/claude-code/copilot)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'provider', 'Provider', 'text', '{}', 8, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='provider');

-- created_at / updated_at (audit)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'created_at', 'Created', 'datetime', '{}', 9, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='created_at');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100001, 'updated_at', 'Updated', 'datetime', '{}', 10, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100001 AND column_name='updated_at');


COMMIT;

-- Verification queries (run manually to confirm):
--   SELECT column_name FROM table_columns WHERE table_id=1784 AND column_name='default_budget_json';  -- 1 row
--   SELECT id, name FROM tables WHERE id=100001;                                                       -- 1 row
--   SELECT count(*) FROM table_columns WHERE table_id=100001;                                          -- 11 rows
