-- ADR-0030 Phase 1 — Run-state machine + _workflow_config table
-- Date: 2026-05-04
-- Author: @developer-ralph
-- Doc: 139182
-- Companion rollback: scripts/rollback/adr-0030-p1-down.sql
--
-- Scope:
--   1. Add 10 run_* virtual columns to tickets table (table_id=1708) — ADR-0030 §3.4
--   2. Create _workflow_config CRM virtual table (table_id=100000) — ADR-0030 §3.2
--   3. Insert singleton row with §13 defaults
--
-- Idempotent: every INSERT is gated by WHERE NOT EXISTS, safe to re-run.
-- Storage model: virtual columns (rows in table_columns), data in table_rows.data JSONB.
-- No physical tables created — matches CRM convention (Path A from architect ack).

BEGIN;

-- =============================================================
-- Part 1 — Run-state columns on tickets (table_id=1708)
-- ADR-0030 §3.4: 10 columns, all nullable, no defaults at row level
-- =============================================================

-- run_state: select with 12 valid states (idle is implicit default via app code)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_state', 'Run', 'select',
       '{"appearance":{"align":"left","indicator":{"type":"emoji","value":"🎼"}},"options":[{"label":"idle"},{"label":"queued"},{"label":"preparing"},{"label":"running"},{"label":"streaming"},{"label":"awaiting_approval"},{"label":"succeeded"},{"label":"failed"},{"label":"timed_out"},{"label":"stalled"},{"label":"canceled"},{"label":"retry_after"}]}',
       100, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_state');

-- run_attempt: number (1-based)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_attempt', 'Attempt', 'number',
       '{"min":0}',
       101, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_attempt');

-- run_thread_id: text (claude --continue key)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_thread_id', 'Thread', 'text',
       '{}',
       102, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_thread_id');

-- run_workspace_path: text (e.g. /root/workspaces/T-138981)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_workspace_path', 'Workspace', 'text',
       '{}',
       103, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_workspace_path');

-- run_started_at: datetime (first transition out of idle)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_started_at', 'Run Started', 'datetime',
       '{}',
       104, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_started_at');

-- run_finished_at: datetime (terminal-state transition)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_finished_at', 'Run Finished', 'datetime',
       '{}',
       105, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_finished_at');

-- run_last_event_at: datetime (heartbeat — every chat msg or claude stdout line)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_last_event_at', 'Last Event', 'datetime',
       '{}',
       106, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_last_event_at');

-- run_terminal_reason: text (free-form: agent_exit_zero, stall, turn_timeout, etc.)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_terminal_reason', 'Terminal Reason', 'text',
       '{}',
       107, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_terminal_reason');

-- run_next_attempt_after: datetime (computed retry time, exp backoff)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_next_attempt_after', 'Retry After', 'datetime',
       '{}',
       108, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_next_attempt_after');

-- run_pending_approval_token: text (TOTP challenge hash)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 1708, 'run_pending_approval_token', 'Approval Token', 'text',
       '{}',
       109, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=1708 AND column_name='run_pending_approval_token');


-- =============================================================
-- Part 2 — _workflow_config CRM virtual table (table_id=100000)
-- ADR-0030 §3.2: singleton row, hot-reloaded every 5 min
-- =============================================================

-- Register table metadata. tables.id is a plain INTEGER PK (no sequence).
INSERT INTO tables (id, name, display_name, icon)
SELECT 100000, '_workflow_config', 'Workflow Config', '🎼'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE id=100000);

-- Columns 1-9: numeric tunables (poll, concurrency, timeouts, retry)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'poll_interval_ms', 'Poll Interval (ms)', 'number', '{"min":1000}', 0, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='poll_interval_ms');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'max_concurrent_runs', 'Max Concurrent Runs', 'number', '{"min":1}', 1, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='max_concurrent_runs');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'max_per_agent', 'Max Per Agent', 'number', '{"min":1}', 2, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='max_per_agent');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'max_turns', 'Max Turns', 'number', '{"min":1}', 3, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='max_turns');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'stall_timeout_ms', 'Stall Timeout (ms)', 'number', '{"min":1000}', 4, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='stall_timeout_ms');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'turn_timeout_ms', 'Turn Timeout (ms)', 'number', '{"min":1000}', 5, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='turn_timeout_ms');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'retry_backoff_min_ms', 'Retry Backoff Min (ms)', 'number', '{"min":1000}', 6, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='retry_backoff_min_ms');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'retry_backoff_max_ms', 'Retry Backoff Max (ms)', 'number', '{"min":1000}', 7, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='retry_backoff_max_ms');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'max_attempts', 'Max Attempts', 'number', '{"min":1}', 8, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='max_attempts');

-- Column 10: workspace root path
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'workspace_root', 'Workspace Root', 'text', '{}', 9, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='workspace_root');

-- Columns 11-13: hooks (bash snippets)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'hook_after_create', 'Hook: After Create', 'text', '{"cellFormat":{"mode":"markdown"}}', 10, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='hook_after_create');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'hook_before_run', 'Hook: Before Run', 'text', '{"cellFormat":{"mode":"markdown"}}', 11, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='hook_before_run');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'hook_after_run', 'Hook: After Run', 'text', '{"cellFormat":{"mode":"markdown"}}', 12, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='hook_after_run');

-- Column 14: default model
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'default_model', 'Default Model', 'select',
       '{"options":[{"label":"opus"},{"label":"sonnet"},{"label":"haiku"}]}',
       13, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='default_model');

-- Column 15: default approval mode
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'default_approval_mode', 'Default Approval Mode', 'select',
       '{"options":[{"label":"per-run"},{"label":"per-sensitive-op"},{"label":"never"}]}',
       14, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='default_approval_mode');

-- Column 16: paused (emergency kill-switch)
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'paused', 'Paused (Kill Switch)', 'checkbox',
       '{"appearance":{"align":"center","indicator":{"type":"emoji","value":"🛑"}}}',
       15, 1, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='paused');

-- Column 17: paused_verification — TOTP gate on paused (ADR-0011 pattern)
-- Toggling paused requires TOTP because it can halt all autonomous runs.
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'paused_verification', 'Paused Verification', 'verification',
       '{"guards":["paused"],"method":"totp","policy":"all","ttl_ms":86400000,"ttl_seconds":86400,"cooldown_ms":300000,"cooldown_seconds":300,"rate_limit":null,"method_config":{},"required_methods":1,"available_methods":["totp"],"locks_on_statuses":[],"unlocks_on_statuses":[]}',
       16, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='paused_verification');

-- Columns 18-19: audit
INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'updated_at', 'Updated At', 'datetime', '{}', 17, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='updated_at');

INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
SELECT 100000, 'updated_by', 'Updated By', 'select',
       '{"relation":{"enabled":true,"tableId":"1782","valueColumn":"id","labelColumn":"name"}}',
       18, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM table_columns WHERE table_id=100000 AND column_name='updated_by');


-- =============================================================
-- Part 3 — Singleton config row with §13 F5/F6/F7/F8 defaults
-- =============================================================

INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
SELECT 100000, 'WORKFLOW1', jsonb_build_object(
  'poll_interval_ms',       30000,            -- §13 F5 default
  'max_concurrent_runs',    3,                -- §13 F6 default
  'max_per_agent',          1,                -- §13 F6 default
  'max_turns',              20,
  'stall_timeout_ms',       300000,           -- §13 F7 default (5 min)
  'turn_timeout_ms',        3600000,          -- 60 min per turn
  'retry_backoff_min_ms',   10000,            -- §13 F8 default (10s × 2^n)
  'retry_backoff_max_ms',   300000,           -- 5 min cap
  'max_attempts',           3,                -- §13 F8 default
  'workspace_root',         '/root/workspaces',
  'hook_after_create',      NULL,
  'hook_before_run',        NULL,
  'hook_after_run',         NULL,
  'default_model',          'opus',
  'default_approval_mode',  'per-sensitive-op', -- §13 F4 default
  'paused',                 false,
  'updated_at',             to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'updated_by',             NULL
), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM table_rows WHERE table_id=100000 AND base_id='WORKFLOW1');

COMMIT;

-- Verification queries (run manually to confirm):
--   SELECT column_name FROM table_columns WHERE table_id=1708 AND column_name LIKE 'run_%' ORDER BY column_name;
--     -> 10 rows
--   SELECT id, name FROM tables WHERE id=100000;
--     -> 1 row, name='_workflow_config'
--   SELECT count(*) FROM table_columns WHERE table_id=100000;
--     -> 19 rows
--   SELECT data->>'paused', data->>'default_model' FROM table_rows WHERE table_id=100000;
--     -> 'false', 'opus'
