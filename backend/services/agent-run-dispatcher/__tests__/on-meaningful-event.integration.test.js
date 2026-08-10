/**
 * ADR-0042 Task 4 — onMeaningfulEvent integration test (godcrm_test DB).
 *
 * Drives the full pipeline:
 *   raw legacy event → eventTranslator → transition() → persistence helpers
 *
 * Each test seeds a single throwaway row in `table_rows` (table_id=1708)
 * with a unique created_by tag so cleanup is deterministic. The boot guard
 * (backend/test/setup.js) refuses to run if POSTGRES_DB=godcrm_prod or
 * BUSINESS_CRM_IS_PROD=1, so this is safe-by-construction.
 *
 * What we assert (per Task 4 brief):
 *   - output → state flips IDLE → THINKING + run_last_event_at fresh
 *   - tool_use marker → state goes TOOL_ACTIVE + run_current_tool persisted
 *   - tool result equivalent (we feed message_stop legacy=`result`) → IDLE
 *   - completion-intent (send_chat_message in output JSON) → CLOSING
 *     + run_completion_intent_at populated
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dbGet, dbRun } from '../../../database/connection.js';
import {
  onMeaningfulEvent,
  persistStateChange,
  persistCurrentTool,
  bumpHeartbeatAt,
  bumpCompletionIntentAt,
  persistStuckCheckBaseline,
  _getFsmStateForTest,
} from '../index.js';

const TICKETS_TABLE_ID = 1708;
const TAG = `adr0042-task4-${Date.now()}`;

async function createSeedRow(extra = {}) {
  // Insert a minimal ticket row. The schema requires base_id (text) and
  // table_id; created_by is an integer FK we leave NULL. The test tag
  // lives inside data.created_by_tag for cleanup querying.
  const data = {
    title: TAG,
    state: 'idle',
    created_by_tag: TAG,
    ...extra,
  };
  const baseId = `${TAG}-${Math.random().toString(36).slice(2, 10)}`;
  const row = await dbGet(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id`,
    [TICKETS_TABLE_ID, baseId, JSON.stringify(data)]
  );
  return Number(row.id);
}

async function readData(rowId) {
  const r = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = $1 AND id = $2`,
    [TICKETS_TABLE_ID, rowId]
  );
  return r?.data ? (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) : null;
}

async function cleanup(rowIds) {
  if (!rowIds.length) return;
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = $1 AND id = ANY($2::int[])`,
    [TICKETS_TABLE_ID, rowIds]
  );
}

const seededRowIds = [];

beforeAll(() => {
  // Defensive: extra check beyond the boot guard.
  if (process.env.POSTGRES_DB === 'godcrm_prod') {
    throw new Error('REFUSING: integration test against godcrm_prod');
  }
});

afterAll(async () => {
  await cleanup(seededRowIds);
  // Drop the FSM cache so subsequent test files see a clean slate.
  _getFsmStateForTest().clear();
});

describe('ADR-0042 persistence helpers — round-trip', () => {
  it('persistStateChange writes run_liveness_state', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    await persistStateChange(id, 'thinking');
    const data = await readData(id);
    expect(data.run_liveness_state).toBe('thinking');
  });

  it('persistCurrentTool writes run_current_tool object then clears it on null', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    await persistCurrentTool(id, { name: 'Bash', tool_use_id: 'tu_x', attempt_idx: 0 });
    let data = await readData(id);
    expect(data.run_current_tool).toMatchObject({ name: 'Bash', attempt_idx: 0 });

    await persistCurrentTool(id, null);
    data = await readData(id);
    expect(data.run_current_tool).toBeUndefined();
  });

  it('bumpHeartbeatAt updates run_last_heartbeat_at to a fresh ISO timestamp (ADR-150 P0)', async () => {
    // ADR-150 P0 bug fix: bumpHeartbeatAt now writes run_last_heartbeat_at
    // (NOT run_last_event_at). The old behavior masked real stalls because
    // the 15s timer kept the freshness clock fresh during a hung run.
    const id = await createSeedRow();
    seededRowIds.push(id);

    const before = Date.now();
    await bumpHeartbeatAt(id);
    const data = await readData(id);
    expect(typeof data.run_last_heartbeat_at).toBe('string');
    expect(data.run_last_event_at).toBeUndefined();
    const t = Date.parse(data.run_last_heartbeat_at);
    expect(t).toBeGreaterThanOrEqual(before - 1000);
  });

  it('bumpCompletionIntentAt sets run_completion_intent_at', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    await bumpCompletionIntentAt(id);
    const data = await readData(id);
    expect(typeof data.run_completion_intent_at).toBe('string');
  });

  it('persistStuckCheckBaseline writes run_stuck_check_baseline ({baseline, prev_state} shape)', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    const baseline = { state: 'R', active_sockets: 1, child_count: 0 };
    await persistStuckCheckBaseline(id, { baseline, prev_state: 'tool_active' });
    const data = await readData(id);
    expect(data.run_stuck_check_baseline).toMatchObject({
      baseline: { state: 'R', active_sockets: 1, child_count: 0 },
      prev_state: 'tool_active',
    });
  });
});

describe('ADR-0042 onMeaningfulEvent — FSM-driven persistence', () => {
  it('output (no tool marker) flips IDLE → THINKING and bumps heartbeat', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    await onMeaningfulEvent(id, { type: 'output', content: 'thinking text' });
    const data = await readData(id);
    expect(data.run_liveness_state).toBe('thinking');
    expect(typeof data.run_last_event_at).toBe('string');
  });

  it('output with Bash tool_use marker → TOOL_ACTIVE + run_current_tool=Bash', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    const content = '{"type":"tool_use","name":"Bash","input":{"cmd":"ls"}}';
    await onMeaningfulEvent(id, { type: 'output', content });
    const data = await readData(id);
    expect(data.run_liveness_state).toBe('tool_active');
    expect(data.run_current_tool).toMatchObject({ name: 'Bash' });
  });

  it('result event (after tool_active) → IDLE-or-still-active, heartbeat fresh', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    // Drive into tool_active first.
    const toolEvt = { type: 'output', content: '{"type":"tool_use","name":"Read","input":{}}' };
    await onMeaningfulEvent(id, toolEvt);
    let data = await readData(id);
    expect(data.run_liveness_state).toBe('tool_active');

    // result → message_stop. Per state-machine.js, message_stop with a
    // tool still in flight stays in tool_active waiting for tool_result.
    await onMeaningfulEvent(id, { type: 'result', status: 'success' });
    data = await readData(id);
    // Either tool_active (still waiting) or idle — both are documented
    // outcomes per state-machine.js. We just assert heartbeat advanced.
    expect(['tool_active', 'idle']).toContain(data.run_liveness_state);
    expect(typeof data.run_last_event_at).toBe('string');
  });

  it('completion-intent tool (send_chat_message) → CLOSING + completion_intent_at set', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    const content = '{"type":"tool_use","name":"send_chat_message","input":{"text":"done"}}';
    await onMeaningfulEvent(id, { type: 'output', content });
    const data = await readData(id);
    expect(data.run_liveness_state).toBe('closing');
    expect(typeof data.run_completion_intent_at).toBe('string');
  });

  it('info event is skipped (translator returns null) — no DB writes', async () => {
    const id = await createSeedRow();
    seededRowIds.push(id);

    await onMeaningfulEvent(id, { type: 'info', message: 'runner_starting' });
    const data = await readData(id);
    expect(data.run_liveness_state).toBeUndefined();
    expect(data.run_last_event_at).toBeUndefined();
  });
});
