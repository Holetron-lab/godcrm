// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ participant: true, row: null, rows: [], triggerMetadata: {} }));
const db = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() }));
const canAdminister = vi.hoisted(() => vi.fn());

vi.mock('../../../database/connection.js', () => ({
  dbGet: db.get, dbAll: db.all, dbRun: db.run, isPostgres: () => true,
  sqlNow: () => 'NOW()',
  safeJsonParse: (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return fallback; }
  },
}));
vi.mock('../../../utils/logger.js', async () => (await import('../../../test/loggerMock.js')).loggerMock());
vi.mock('../../chat/invocation-dispatcher.js', () => ({ dispatchInvocationsFromContent: vi.fn(), hasInvocationTokens: vi.fn(() => false) }));
vi.mock('../../EffectiveRoleService.js', () => ({ canAdminister }));

const { chatToolHandlers } = await import('../chat-tools.js');
const { AGENT_TOOLS } = await import('../tool-definitions/index.js');
const { evaluateToolGate } = await import('../capability-gate.js');

const ctx = { agentId: 42, agentName: 'Scheduler' };
const future = () => new Date(Date.now() + 60 * 60_000).toISOString();

function scheduled(overrides = {}) {
  return {
    id: 55, conversation_id: 42, sender_id: 777, content: 'daily report',
    content_type: 'text', mentions: '[]', attachments: '[]', metadata: '{}',
    scheduled_at: future(), status: 'pending', recurrence_cron: '0 9 * * *',
    timezone: 'Europe/Moscow', max_runs: null, runs_done: 0,
    sender_type: 'agent', agent_id: 42, role: 'assistant', ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.participant = true;
  state.triggerMetadata = {};
  state.row = scheduled();
  state.rows = [state.row];
  db.get.mockImplementation(async sql => {
    if (sql.includes('FROM table_rows')) return { user_id: 777, data: JSON.stringify({ name: 'Scheduler', icon: '🔁' }) };
    if (sql.includes('FROM agent_jobs')) return { trigger_message_id: 321 };
    if (sql.includes('FROM messages')) return { metadata: JSON.stringify(state.triggerMetadata) };
    if (sql.includes('FROM scheduled_messages')) return state.row;
    if (sql.includes('FROM conversations')) return { id: 42, space_id: 11 };
    if (sql.includes('SELECT role FROM conversation_participants')) return { role: 'member' };
    if (sql.includes('FROM conversation_participants')) return state.participant ? { 1: 1 } : null;
    return null;
  });
  db.all.mockImplementation(async () => state.rows);
  db.run.mockResolvedValue({ lastInsertRowid: 55, changes: 1 });
  canAdminister.mockResolvedValue(false);
});

describe('ADR-208 D7 — schedule_message actions', () => {
  it('creates an agent series with resolved authorship', async () => {
    const result = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: 42, content: 'daily report', recurrence_cron: '*/15 * * * *', max_runs: 4,
    }, 1, ctx);
    expect(result).toMatchObject({ success: true, scheduled_message: { id: 55 } });
    const insert = db.run.mock.calls.find(([sql]) => sql.includes('INSERT INTO scheduled_messages'));
    expect(insert).toBeTruthy();
    expect(insert[1]).toEqual(expect.arrayContaining([42, 777, 'daily report', 'agent', 42, 'assistant', 4]));
  });

  it('enforces the 15-minute agent interval', async () => {
    const result = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: 42, content: 'too often', recurrence_cron: '*/5 * * * *',
    }, 1, ctx);
    expect(result).toMatchObject({ error: 'RECURRENCE_TOO_FREQUENT' });
    expect(db.run).not.toHaveBeenCalled();
  });

  it('lists visible schedules including paused rows', async () => {
    state.row = scheduled({ status: 'paused' });
    state.rows = [state.row];
    const result = await chatToolHandlers.schedule_message({ action: 'list', conversation_id: 42 }, 1, ctx);
    expect(result).toMatchObject({ success: true, total: 1 });
    expect(result.scheduled_messages[0]).toMatchObject({ status: 'paused', next_run_at: state.row.scheduled_at });
  });

  it.each(['pause', 'resume', 'cancel'])('supports %s', async action => {
    state.row = scheduled({ status: action === 'resume' ? 'paused' : 'pending' });
    const result = await chatToolHandlers.schedule_message({ action, scheduled_message_id: 55 }, 1, ctx);
    expect(result).toMatchObject({ success: true });
  });

  it('rejects a recurring create from a scheduled-message run', async () => {
    state.triggerMetadata = { scheduled_message_id: 55 };
    const result = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: 42, content: 'child series', recurrence_cron: '0 9 * * *',
    }, 1, { ...ctx, triggerMessageId: 123 });
    expect(result).toMatchObject({ error: 'RECURSIVE_SCHEDULE_FORBIDDEN' });
    expect(db.run).not.toHaveBeenCalled();
  });

  it('resolves the triggering message through the CLI job id', async () => {
    state.triggerMetadata = { scheduled_message_id: 55 };
    const result = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: 42, content: 'child series', recurrence_cron: '0 9 * * *',
    }, 1, { ...ctx, jobId: 900 });
    expect(result).toMatchObject({ error: 'RECURSIVE_SCHEDULE_FORBIDDEN' });
  });

  it('allows a one-time message from a scheduled-message run', async () => {
    state.triggerMetadata = { scheduled_message_id: 55 };
    const result = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: 42, content: 'one follow-up', scheduled_at: future(),
    }, 1, { ...ctx, triggerMessageId: 123 });
    expect(result).toMatchObject({ success: true });
  });
});

describe('ADR-208 D7 — definition and capability gate', () => {
  it('registers schedule_message and honors the existing capability gate', () => {
    const definition = AGENT_TOOLS.find(tool => tool.function.name === 'schedule_message');
    expect(definition).toBeTruthy();
    expect(definition.function.parameters.required).toEqual(['action']);
    expect(definition.function.parameters.properties.action.enum).toEqual(['create', 'list', 'pause', 'resume', 'cancel']);
    expect(evaluateToolGate('schedule_message', { allowedTools: [definition] }, true)).toEqual({ permitted: true, violation: false });
    expect(evaluateToolGate('schedule_message', { allowedTools: [] }, true).permitted).toBe(true);
  });
});
