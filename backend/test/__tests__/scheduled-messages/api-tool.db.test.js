// @vitest-environment node
import express, { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as h from './db-testkit.js';

vi.mock('../../../database/connection.js', async () => ({
  dbGet: h.get, dbAll: h.all, dbRun: h.run, isPostgres: h.isPostgres,
  safeJsonParse: h.safeJsonParse, toBool: h.toBool, sqlNow: h.sqlNow,
  withTransactionAsync: h.withTransactionAsync,
}));
vi.mock('../../../utils/logger.js', async () =>
  (await import('../../loggerMock.js')).loggerMock());
vi.mock('../../../routes/v3/chat/chatShared.js', async () => ({
  ...(await import('../../../utils/response.js')),
  dbGet: h.get, dbAll: h.all, dbRun: h.run, isPostgres: h.isPostgres, safeJsonParse: h.safeJsonParse,
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  requireAuth: (req, _res, next) => {
    const userId = Number(req.headers['x-test-user-id']);
    req.user = { id: userId, userId };
    next();
  },
}));
vi.mock('../../../services/ScheduledMessageWorker.js', () => ({ sendScheduledMessage: vi.fn() }));
vi.mock('../../../services/chat/invocation-dispatcher.js', () => ({
  dispatchInvocationsFromContent: vi.fn(), hasInvocationTokens: vi.fn(() => false),
}));

const { default: registerScheduledMessageRoutes } = await import('../../../routes/v3/chat/scheduledMessageController.js');
const { chatToolHandlers } = await import('../../../services/agent-tools/chat-tools.js');
const { createEphemeralWorkspace } = await import('../../../tests/helpers/workspace-fixture.js');
const { up } = await import('../../../database/migrations/knex/115_scheduled_messages_recurrence.js');

const app = express();
app.use(express.json());
const router = Router();
registerScheduledMessageRoutes(router);
app.use('/api/v3/chat', router);

let ws;
let authorId;
let adminId;
let memberId;
let agent;
let conversationId;
let ctx;

const asUser = userId => ({ 'x-test-user-id': String(userId) });
const createRest = (body, userId = authorId) => request(app)
  .post(`/api/v3/chat/conversations/${conversationId}/scheduled-messages`)
  .set(asUser(userId))
  .send(body);

beforeAll(async () => {
  await h.openDb(up);
}, 20000);

beforeEach(async () => {
  await h.run("UPDATE scheduled_messages SET status = 'cancelled', reply_check_at = NULL");
  ws = await createEphemeralWorkspace({ label: 'scheduled-api', dashboard: false, table: true });
  authorId = await h.createUser('author');
  adminId = await h.createUser('chat-admin');
  memberId = await h.createUser('member');
  agent = await h.createAgentAuthor(ws);
  conversationId = await h.createConversation(ws, [
    { userId: ws.userId, role: 'member' },
    { userId: authorId, role: 'member' },
    { userId: adminId, role: 'admin' },
    { userId: memberId, role: 'member' },
    { userId: agent.agentUserId, role: 'member', userType: 'agent' },
  ]);
  ctx = { agentId: agent.agentRowId, agentName: 'ADR-208 Scheduler' };
});

afterEach(async () => {
  await ws?.cleanup();
  ws = null;
  conversationId = null;
});

afterAll(h.closeDb);

describe('ADR-208 AC8 — real REST validation, pause/resume and ACL', () => {
  it.each([
    [{ content: 'too often', recurrence_cron: '*/4 * * * *' }, 'RECURRENCE_TOO_FREQUENT'],
    [{ content: 'bad tz', recurrence_cron: '0 9 * * *', timezone: 'Moscow' }, 'INVALID_SCHEDULE'],
    [{ content: 'bad count', recurrence_cron: '0 9 * * *', max_runs: 0 }, 'INVALID_SCHEDULE'],
  ])('returns 400 for invalid recurrence input %#', async (body, code) => {
    const response = await createRest(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
    expect(await h.all('SELECT id FROM scheduled_messages WHERE conversation_id = ?', [conversationId])).toHaveLength(0);
  });

  it('pauses and resumes a persisted series with a recalculated next run', async () => {
    const created = await createRest({ content: 'daily', recurrence_cron: '0 9 * * *', timezone: 'Europe/Moscow' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const paused = await request(app)
      .patch(`/api/v3/chat/scheduled-messages/${id}/status`)
      .set(asUser(authorId))
      .send({ status: 'paused' });
    expect(paused.status).toBe(200);
    expect(paused.body.data.status).toBe('paused');

    const resumed = await request(app)
      .patch(`/api/v3/chat/scheduled-messages/${id}/status`)
      .set(asUser(authorId))
      .send({ status: 'pending' });
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.status).toBe('pending');
    expect(new Date(resumed.body.data.next_run_at).getTime()).toBeGreaterThan(Date.now());

    const listed = await request(app)
      .get(`/api/v3/chat/conversations/${conversationId}/scheduled-messages`)
      .set(asUser(authorId));
    expect(listed.status).toBe(200);
    expect(listed.body.data.scheduled_messages[0]).toMatchObject({
      id, recurrence_cron: '0 9 * * *', timezone: 'Europe/Moscow', next_run_at: resumed.body.data.next_run_at,
    });
  });

  it('allows space owner and conversation admin, but rejects an ordinary participant', async () => {
    const first = await createRest({ content: 'owner cancel', recurrence_cron: '0 9 * * *' });
    const ownerCancel = await request(app)
      .delete(`/api/v3/chat/scheduled-messages/${first.body.data.id}`)
      .set(asUser(ws.userId));
    expect(ownerCancel.status).toBe(200);

    const second = await createRest({ content: 'admin cancel', recurrence_cron: '0 9 * * *' });
    const adminCancel = await request(app)
      .delete(`/api/v3/chat/scheduled-messages/${second.body.data.id}`)
      .set(asUser(adminId));
    expect(adminCancel.status).toBe(200);

    const third = await createRest({ content: 'member forbidden', recurrence_cron: '0 9 * * *' });
    const memberCancel = await request(app)
      .delete(`/api/v3/chat/scheduled-messages/${third.body.data.id}`)
      .set(asUser(memberId));
    expect(memberCancel.status).toBe(403);
    expect((await h.get('SELECT status FROM scheduled_messages WHERE id = ?', [third.body.data.id])).status).toBe('pending');
  });
});

describe('ADR-208 AC8–AC9 — schedule_message with real authorship and persistence', () => {
  it('enforces the 15-minute agent minimum', async () => {
    const result = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: conversationId, content: 'too often', recurrence_cron: '*/5 * * * *',
    }, 1, ctx);
    expect(result).toMatchObject({ error: 'RECURRENCE_TOO_FREQUENT' });
    expect(await h.all('SELECT id FROM scheduled_messages WHERE conversation_id = ?', [conversationId])).toHaveLength(0);
  });

  it('supports create/list/pause/resume/cancel and persists agent identity', async () => {
    const created = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: conversationId, content: 'agent daily', recurrence_cron: '*/15 * * * *', max_runs: 4,
    }, 1, ctx);
    expect(created.success).toBe(true);
    const id = created.scheduled_message.id;
    expect(created.scheduled_message).toMatchObject({
      sender_id: agent.agentUserId, sender_type: 'agent', agent_id: agent.agentRowId, role: 'assistant', max_runs: 4,
    });
    expect(created.scheduled_message.metadata).toMatchObject({
      agent_name: 'ADR-208 Scheduler', agent_icon: '🔁', agent_color: '#123456', agent_row_id: agent.agentRowId,
    });

    const listed = await chatToolHandlers.schedule_message({ action: 'list', conversation_id: conversationId }, 1, ctx);
    expect(listed).toMatchObject({ success: true, total: 1 });
    expect(listed.scheduled_messages[0].id).toBe(id);

    const paused = await chatToolHandlers.schedule_message({ action: 'pause', scheduled_message_id: id }, 1, ctx);
    expect(paused.scheduled_message.status).toBe('paused');
    const resumed = await chatToolHandlers.schedule_message({ action: 'resume', scheduled_message_id: id }, 1, ctx);
    expect(resumed.scheduled_message.status).toBe('pending');
    expect(new Date(resumed.scheduled_message.next_run_at).getTime()).toBeGreaterThan(Date.now());
    const cancelled = await chatToolHandlers.schedule_message({ action: 'cancel', scheduled_message_id: id }, 1, ctx);
    expect(cancelled).toMatchObject({ success: true, cancelled: true, id });
    expect((await h.get('SELECT status FROM scheduled_messages WHERE id = ?', [id])).status).toBe('cancelled');
  });

  it('rejects recursive series creation but allows a one-time follow-up', async () => {
    const parent = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: conversationId, content: 'parent', recurrence_cron: '*/15 * * * *',
    }, 1, ctx);
    const trigger = await h.run(
      `INSERT INTO messages (conversation_id, sender_id, sender_type, role, agent_id, content, metadata)
       VALUES (?, ?, 'agent', 'assistant', ?, 'parent', ?::jsonb)`,
      [conversationId, agent.agentUserId, agent.agentRowId, JSON.stringify({ scheduled_message_id: parent.scheduled_message.id })],
    );
    const runCtx = { ...ctx, triggerMessageId: trigger.lastInsertRowid };

    const forbidden = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: conversationId, content: 'child series', recurrence_cron: '0 9 * * *',
    }, 1, runCtx);
    expect(forbidden).toMatchObject({ error: 'RECURSIVE_SCHEDULE_FORBIDDEN' });

    const oneTime = await chatToolHandlers.schedule_message({
      action: 'create', conversation_id: conversationId, content: 'one follow-up',
      scheduled_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    }, 1, runCtx);
    expect(oneTime.success).toBe(true);
    expect(oneTime.scheduled_message.recurrence_cron).toBeNull();
  });
});
