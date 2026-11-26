// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

const state = vi.hoisted(() => ({ participant: true, participantRole: 'member', row: null, rows: [] }));
const db = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() }));
const canAdminister = vi.hoisted(() => vi.fn());

vi.mock('../../../../database/connection.js', () => ({
  dbGet: db.get, dbAll: db.all, dbRun: db.run, isPostgres: () => true,
  safeJsonParse: (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return fallback; }
  },
}));
vi.mock('../chatShared.js', async () => ({
  ...await import('../../../../database/connection.js'),
  ...await import('../../../../utils/response.js'),
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  requireAuth: (req, _res, next) => {
    req.user = { id: Number(req.headers['x-test-user-id'] || 7), userId: Number(req.headers['x-test-user-id'] || 7) };
    next();
  },
}));
vi.mock('../../../../services/EffectiveRoleService.js', () => ({ canAdminister }));
vi.mock('../../../../services/ScheduledMessageWorker.js', () => ({ sendScheduledMessage: vi.fn() }));

const { default: registerScheduledMessageRoutes } = await import('../scheduledMessageController.js');

function app() {
  const instance = express();
  instance.use(express.json());
  const router = Router();
  registerScheduledMessageRoutes(router);
  instance.use('/api/v3/chat', router);
  return instance;
}

function scheduled(overrides = {}) {
  return {
    id: 55, conversation_id: 42, sender_id: 7, content: 'daily report',
    content_type: 'text', mentions: '[]', attachments: '[]', metadata: '{}',
    scheduled_at: '2026-11-08T06:00:00.000Z', status: 'pending',
    recurrence_cron: '0 9 * * *', timezone: 'Europe/Moscow', max_runs: null,
    runs_done: 2, last_fired_at: '2026-11-07T06:00:00.000Z', error_message: null,
    sender_type: 'human', agent_id: null, role: 'user', ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.participant = true;
  state.participantRole = 'member';
  state.row = scheduled();
  state.rows = [state.row];
  db.get.mockImplementation(async sql => {
    if (sql.includes('FROM scheduled_messages') && sql.includes('WHERE id')) return state.row;
    if (sql.includes('FROM conversations')) return { id: 42, space_id: 11 };
    if (sql.includes('SELECT role FROM conversation_participants')) return state.participantRole ? { role: state.participantRole } : null;
    if (sql.includes('FROM conversation_participants')) return state.participant ? { 1: 1 } : null;
    return null;
  });
  db.all.mockImplementation(async () => state.rows);
  db.run.mockResolvedValue({ lastInsertRowid: 55, changes: 1 });
  canAdminister.mockResolvedValue(false);
});

describe('ADR-208 D6 — REST validation and projection', () => {
  it.each([
    [{ content: 'x', recurrence_cron: '*/4 * * * *' }, 'RECURRENCE_TOO_FREQUENT'],
    [{ content: 'x', recurrence_cron: '0 9 * * *', timezone: 'Moscow' }, 'INVALID_SCHEDULE'],
    [{ content: 'x', recurrence_cron: '0 9 * * *', max_runs: 0 }, 'INVALID_SCHEDULE'],
  ])('POST rejects invalid recurrence %#', async (body, code) => {
    const res = await request(app()).post('/api/v3/chat/conversations/42/scheduled-messages').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('GET includes paused series and recurrence fields', async () => {
    state.row = scheduled({
      status: 'paused', sender_type: 'agent', agent_id: 42, role: 'assistant',
      attachments: JSON.stringify([{ url: '/uploads/report.pdf', mime_type: 'application/pdf', original_name: 'report.pdf' }]),
    });
    state.rows = [state.row];
    const res = await request(app()).get('/api/v3/chat/conversations/42/scheduled-messages');
    expect(res.status).toBe(200);
    expect(res.body.data.scheduled_messages).toHaveLength(1);
    expect(res.body.data.scheduled_messages[0]).toMatchObject({
      status: 'paused', recurrence_cron: '0 9 * * *', timezone: 'Europe/Moscow',
      runs_done: 2, next_run_at: state.row.scheduled_at,
      sender_type: 'agent', agent_id: 42,
      attachments: [{ type: 'application/pdf', name: 'report.pdf' }],
    });
  });

  it('PUT keeps the legacy empty-update validation', async () => {
    const res = await request(app()).put('/api/v3/chat/scheduled-messages/55').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('No fields to update');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('PATCH pauses and resumes a series, recalculating its next run', async () => {
    const paused = await request(app()).patch('/api/v3/chat/scheduled-messages/55/status').send({ status: 'paused' });
    expect(paused.status).toBe(200);
    expect(db.run.mock.calls.some(([sql, params]) => sql.includes("status = 'paused'") && Number(params[0]) === 55)).toBe(true);

    state.row = scheduled({ status: 'paused' });
    const resumed = await request(app()).patch('/api/v3/chat/scheduled-messages/55/status').send({ status: 'pending' });
    expect(resumed.status).toBe(200);
    const update = db.run.mock.calls.at(-1);
    expect(update[0]).toContain("status = 'pending'");
    expect(new Date(update[1][0]).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('ADR-208 D6 — cancel and status ACL', () => {
  it('allows the space owner/admin to cancel another author\'s series', async () => {
    canAdminister.mockResolvedValue(true);
    const res = await request(app()).delete('/api/v3/chat/scheduled-messages/55').set('x-test-user-id', '99');
    expect(res.status).toBe(200);
    expect(canAdminister).toHaveBeenCalledWith(99, { spaceId: 11 });
  });

  it('allows a conversation admin to pause another author\'s series', async () => {
    state.participantRole = 'admin';
    const res = await request(app()).patch('/api/v3/chat/scheduled-messages/55/status').set('x-test-user-id', '99').send({ status: 'paused' });
    expect(res.status).toBe(200);
    expect(canAdminister).not.toHaveBeenCalled();
  });

  it('rejects an ordinary participant cancelling another author\'s series', async () => {
    const res = await request(app()).delete('/api/v3/chat/scheduled-messages/55').set('x-test-user-id', '99');
    expect(res.status).toBe(403);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('allows cancelling a paused message', async () => {
    state.row = scheduled({ status: 'paused' });
    const res = await request(app()).delete('/api/v3/chat/scheduled-messages/55');
    expect(res.status).toBe(200);
  });
});
