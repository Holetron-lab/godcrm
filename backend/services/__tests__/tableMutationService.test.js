// ADR-0031 P1 — tableMutationService tests
//
// Covers the four acceptance cases from T-140314:
//   1. Single column change → 1 system message
//   2. Two column changes → 2 system messages
//   3. Feature flag OFF → 0 messages
//   4. suppress_mutation_log → 0 messages
//
// We mock the database connection module so the test does not touch the test
// DB and works without seeded fixtures. The diff + render + emit pipeline is
// what we actually want to verify.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbAllMock = vi.fn();
const dbGetMock = vi.fn();
const dbRunMock = vi.fn();

vi.mock('../../database/connection.js', () => ({
  dbAll: (...args) => dbAllMock(...args),
  dbGet: (...args) => dbGetMock(...args),
  dbRun: (...args) => dbRunMock(...args),
  sqlNow: () => `'2026-05-05T00:00:00Z'`,
  safeJsonParse: (v, d = null) => {
    if (v == null) return d;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return d; }
  },
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STATE_RULE = {
  id: 1, table_id: 1708, column_key: 'state',
  template: '🔄 {{display.old}} → {{display.new}}',
  event_type: 'state_change', enabled: true,
};
const PROGRESS_RULE = {
  id: 2, table_id: 1708, column_key: 'progress',
  template: '📊 {{old.progress | default: 0}}% → {{new.progress}}%',
  event_type: 'progress', enabled: true,
};

function setupHappyPath() {
  dbAllMock.mockReset();
  dbGetMock.mockReset();
  dbRunMock.mockReset();

  // 1) loadConfig() — enabled rules
  dbAllMock.mockImplementation((sql) => {
    if (/_chat_mutation_log_config/.test(sql)) {
      return Promise.resolve([STATE_RULE, PROGRESS_RULE]);
    }
    return Promise.resolve([]);
  });

  // 2) getTableSpaceId / getColumnConfig / conversation lookup / display resolution
  dbGetMock.mockImplementation((sql, params) => {
    if (/universal_tables/.test(sql) && /space_id/.test(sql)) {
      return Promise.resolve({ space_id: 11 });
    }
    if (/table_columns/.test(sql)) {
      // Non-relation column returns no config → display falls back to raw value.
      return Promise.resolve({ id: 999, type: 'text', config: null });
    }
    if (/FROM conversations/.test(sql)) {
      return Promise.resolve({ id: 4242 }); // existing chat
    }
    return Promise.resolve(null);
  });

  // 3) INSERT messages — captured, no real run
  dbRunMock.mockResolvedValue({ lastInsertRowid: 9001 });
}

async function loadModule() {
  // Re-import so the env var is picked up freshly.
  const mod = await import('../tableMutationService.js?t=' + Math.random());
  mod.invalidateMutationConfigCache();
  return mod;
}

describe('tableMutationService.emitRowMutationEvents (ADR-0031 P1)', () => {
  beforeEach(() => {
    process.env.ROW_MUTATION_LOG_ENABLED_SPACES = '11';
    setupHappyPath();
  });

  it('1) emits exactly 1 system message when one configured column changes', async () => {
    const { emitRowMutationEvents } = await loadModule();
    await emitRowMutationEvents({
      tableId: 1708,
      rowId: 100,
      oldData: { state: 1, progress: 50 },
      newData: { state: 2, progress: 50 },
      actor: { id: 1, name: 'tester' },
    });

    const inserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql));
    expect(inserts).toHaveLength(1);
    const [, params] = inserts[0];
    expect(params[0]).toBe(4242); // conversation_id
    expect(params[1]).toBe(1);    // sender_id (actor)
    expect(params[2]).toContain('🔄'); // rendered content
    const metadata = JSON.parse(params[3]);
    expect(metadata.event_type).toBe('state_change');
    expect(metadata.column_key).toBe('state');
    expect(metadata.old).toBe(1);
    expect(metadata.new).toBe(2);
    expect(metadata.row_ref).toMatchObject({ table_id: 1708, row_id: 100 });
  });

  it('2) emits exactly 2 system messages when two configured columns change', async () => {
    const { emitRowMutationEvents } = await loadModule();
    await emitRowMutationEvents({
      tableId: 1708,
      rowId: 100,
      oldData: { state: 1, progress: 0 },
      newData: { state: 2, progress: 75 },
      actor: { id: 1, name: 'tester' },
    });

    const inserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql));
    expect(inserts).toHaveLength(2);
    const eventTypes = inserts.map(([, params]) => JSON.parse(params[3]).event_type).sort();
    expect(eventTypes).toEqual(['progress', 'state_change']);
    // progress template uses default: 0 — verify rendering produced a string with "0%"
    const progressInsert = inserts.find(([, params]) => JSON.parse(params[3]).column_key === 'progress');
    expect(progressInsert[1][2]).toContain('0%');
    expect(progressInsert[1][2]).toContain('75%');
  });

  it('3) emits 0 messages when feature flag is OFF (no spaces in env var)', async () => {
    process.env.ROW_MUTATION_LOG_ENABLED_SPACES = '';
    const { emitRowMutationEvents } = await loadModule();
    await emitRowMutationEvents({
      tableId: 1708,
      rowId: 100,
      oldData: { state: 1 },
      newData: { state: 2 },
      actor: { id: 1, name: 'tester' },
    });
    const inserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql));
    expect(inserts).toHaveLength(0);
  });

  it('4) emits 0 messages when ctx.suppress_mutation_log = true', async () => {
    const { emitRowMutationEvents } = await loadModule();
    await emitRowMutationEvents({
      tableId: 1708,
      rowId: 100,
      oldData: { state: 1 },
      newData: { state: 2 },
      actor: { id: 1, name: 'tester' },
      ctx: { suppress_mutation_log: true },
    });
    const inserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql));
    expect(inserts).toHaveLength(0);
  });

  it('5) bonus: skips updated_at/created_at even if they differ (defence-in-depth)', async () => {
    const { emitRowMutationEvents } = await loadModule();
    await emitRowMutationEvents({
      tableId: 1708,
      rowId: 100,
      oldData: { state: 1, updated_at: '2026-05-04', created_at: '2026-05-01' },
      newData: { state: 1, updated_at: '2026-05-05', created_at: '2026-05-01' },
      actor: { id: 1, name: 'tester' },
    });
    const inserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql));
    expect(inserts).toHaveLength(0); // state unchanged + updated_at excluded
  });
});

// ADR-0031 P4 — lazy criterion chat + ensureRowChat helper.
// New surface: criterion regression auto-creates a row-bound chat with
// `title='Criterion: <title>'`, `space_id`, and the actor as participant.
// Manual Discuss path uses `ensureRowChat`.

const CRITERION_STATUS_RULE = {
  id: 12, table_id: 7256, column_key: 'status',
  template:
    "{% if new.status == 'failed' %}🔴 Regressed: was passing, now failing.\n" +
    "Last green run: {{old.claimed_at | default: 'unknown'}}. Trigger: {{new.failed_test_id | default: 'manual flip'}}.\n" +
    "[Discuss → spawn ticket]{% elsif new.status == 'verified' %}✅ Verified ({{old.status}} → verified)" +
    "{% else %}🔖 {{old.status}} → {{new.status}}{% endif %}",
  event_type: 'state_change', enabled: true,
};

function setupCriterionRegression(existingConv = null) {
  dbAllMock.mockReset();
  dbGetMock.mockReset();
  dbRunMock.mockReset();

  dbAllMock.mockImplementation((sql) => {
    if (/_chat_mutation_log_config/.test(sql)) {
      return Promise.resolve([CRITERION_STATUS_RULE]);
    }
    return Promise.resolve([]);
  });

  dbGetMock.mockImplementation((sql, _params) => {
    if (/universal_tables/.test(sql) && /space_id/.test(sql)) {
      return Promise.resolve({ space_id: 11 });
    }
    if (/table_columns/.test(sql)) {
      return Promise.resolve({ id: 999, type: 'select', config: null });
    }
    if (/FROM table_rows/.test(sql)) {
      return Promise.resolve({ data: JSON.stringify({ title: 'Verify deploy script' }) });
    }
    if (/FROM conversations/.test(sql)) {
      return Promise.resolve(existingConv); // null → triggers create
    }
    return Promise.resolve(null);
  });

  // Distinguish dbRun call types so we can return a fresh ID for the conv insert
  // and a benign ack for everything else.
  dbRunMock.mockImplementation((sql) => {
    if (/INSERT INTO conversations/.test(sql)) {
      return Promise.resolve({ lastInsertRowid: 7777 });
    }
    return Promise.resolve({ lastInsertRowid: null });
  });
}

describe('tableMutationService.emitRowMutationEvents — P4 lazy criterion chat', () => {
  beforeEach(() => {
    process.env.ROW_MUTATION_LOG_ENABLED_SPACES = '11';
  });

  it('6) criterion status passed→failed: lazy-creates conv with title+space_id+participant', async () => {
    setupCriterionRegression(null);
    const { emitRowMutationEvents } = await loadModule();
    await emitRowMutationEvents({
      tableId: 7256,
      rowId: 555,
      oldData: { status: 'passed', title: 'Verify deploy script', claimed_at: '2026-05-01' },
      newData: { status: 'failed', title: 'Verify deploy script', failed_test_id: 42 },
      actor: { id: 17, name: 'ralph' },
    });

    const convInserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO conversations/.test(sql));
    expect(convInserts).toHaveLength(1);
    const [, convParams] = convInserts[0];
    // title (1st), space_id (2nd), bound_table_id (3rd), bound_row_id (4th), actor (5th)
    expect(convParams[0]).toBe('Criterion: Verify deploy script');
    expect(convParams[1]).toBe(11);
    expect(convParams[2]).toBe(7256);
    expect(convParams[3]).toBe(555);
    expect(convParams[4]).toBe(17);

    const partInserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO conversation_participants/.test(sql));
    expect(partInserts.length).toBeGreaterThanOrEqual(1);

    const msgInserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql));
    expect(msgInserts).toHaveLength(1);
    expect(msgInserts[0][1][2]).toContain('🔴 Regressed');
    expect(msgInserts[0][1][2]).toContain('was passing, now failing');
    expect(msgInserts[0][1][2]).toContain('[Discuss → spawn ticket]');
  });

  it('7) idempotency: second regression on same criterion reuses existing conv (no new INSERT)', async () => {
    setupCriterionRegression({ id: 7777 });
    const { emitRowMutationEvents } = await loadModule();
    await emitRowMutationEvents({
      tableId: 7256,
      rowId: 555,
      oldData: { status: 'verified' },
      newData: { status: 'failed', title: 'Verify deploy script' },
      actor: { id: 17, name: 'ralph' },
    });

    const convInserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO conversations/.test(sql));
    expect(convInserts).toHaveLength(0);

    const msgInserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql));
    expect(msgInserts).toHaveLength(1);
    expect(msgInserts[0][1][0]).toBe(7777); // posted into existing conv
    expect(msgInserts[0][1][2]).toContain('🔴 Regressed');
  });

  it('8) ensureRowChat: creates new chat with criterion title hint when none exists', async () => {
    setupCriterionRegression(null);
    const { ensureRowChat } = await loadModule();
    const conv = await ensureRowChat({ tableId: 7256, rowId: 555, actorId: 17 });
    expect(conv?.id).toBe(7777);

    const convInserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO conversations/.test(sql));
    expect(convInserts).toHaveLength(1);
    expect(convInserts[0][1][0]).toBe('Criterion: Verify deploy script');
    expect(convInserts[0][1][1]).toBe(11);
  });

  it('9) ensureRowChat: idempotent — existing chat returned without INSERT', async () => {
    setupCriterionRegression({ id: 7777 });
    const { ensureRowChat } = await loadModule();
    const conv = await ensureRowChat({ tableId: 7256, rowId: 555, actorId: 17 });
    expect(conv?.id).toBe(7777);
    const convInserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO conversations/.test(sql));
    expect(convInserts).toHaveLength(0);
    // Participant must still be ensured for the visiting user.
    const partInserts = dbRunMock.mock.calls.filter(([sql]) => /INSERT INTO conversation_participants/.test(sql));
    expect(partInserts.length).toBeGreaterThanOrEqual(1);
  });
});
