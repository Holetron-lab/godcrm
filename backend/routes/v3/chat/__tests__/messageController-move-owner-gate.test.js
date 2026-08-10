// ADR-0031 WP-24 — owner gate on POST /messages/move + /spawn-ticket.
//
// Covers the privilege bug fix: only the chat owner (conversations.created_by)
// or the system admin override (req.user.role === 'admin') may move messages
// out of a conversation. The legacy `req.user.role === 'owner'` global override
// has been removed (it conflated chat ownership with a global role).
//
// Cases:
//   1. not_owner_blocked — non-owner participant gets 403
//   2. owner_passes — chat owner moves successfully
//   3. admin_override — global admin moves successfully even if not the chat owner
//   4. spawn_ticket_not_owner_blocked — same gate on /spawn-ticket
//
// Strategy: mock `chatShared.js` (so the heavy DB module isn't pulled in) and
// the two move services. Mount the router built by `registerMessageRoutes` on
// a tiny express app and hit it via supertest.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

const dbGetMock = vi.fn();
const moveMessagesMock = vi.fn();
const spawnTicketFromCriterionMock = vi.fn();

// requireAuth fake: pulls user from x-test-user-id / x-test-user-role headers.
function fakeRequireAuth(req, _res, next) {
  const id = Number(req.headers['x-test-user-id']);
  const role = req.headers['x-test-user-role'] || 'user';
  req.user = { userId: id, id, role };
  next();
}

// Shape-compatible response helpers.
const success = (res, data) => res.status(200).json({ success: true, data });
const error = (res, code, msg, status = 500) =>
  res.status(status).json({ success: false, error: code, message: msg });
const badRequest = (res, msg) => res.status(400).json({ success: false, error: msg });
const notFound = (res, msg) => res.status(404).json({ success: false, error: msg });
const forbidden = (res, msg) => res.status(403).json({ success: false, error: msg });

vi.mock('../chatShared.js', () => ({
  dbRun: vi.fn(),
  dbGet: (...args) => dbGetMock(...args),
  dbAll: vi.fn(),
  isPostgres: () => true,
  safeJsonParse: (v) => { try { return JSON.parse(v); } catch { return null; } },
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  success, created: success, error, badRequest, notFound, forbidden,
  requireAuth: fakeRequireAuth,
  getAttachmentBaseUrl: () => '',
  conversationLock: { acquire: async (_id, fn) => fn() },
  parseInvocationMentions: () => [],
  parseInvocationCommands: () => [],
}));

vi.mock('../../../../services/messageMoveService.js', () => ({
  moveMessages: (...args) => moveMessagesMock(...args),
  MoveValidationError: class extends Error {},
  MoveAuthError: class extends Error {},
}));

vi.mock('../../../../services/criterionTicketSpawnService.js', () => ({
  spawnTicketFromCriterion: (...args) => spawnTicketFromCriterionMock(...args),
  SpawnValidationError: class extends Error {},
}));

vi.mock('../chatAgentHelpers.js', () => ({
  resolveMentionedUser: vi.fn(),
  resolveAgentUser: vi.fn(),
  findAiAgentByCommand: vi.fn(),
  autoJoinAgentToConversation: vi.fn(),
  resolveAgentInfoForMessages: vi.fn(),
}));

vi.mock('../chatAgentExecution.js', () => ({
  executeAgentResponse: vi.fn(),
}));

vi.mock('../chatAgentAutoRespond.js', () => ({
  getAutoRespondAgents: vi.fn(),
  shouldAutoRespondWithAI: vi.fn(),
  getDefaultAgentForConversation: vi.fn(),
}));

const { default: registerMessageRoutes } = await import('../messageController.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerMessageRoutes(router);
  app.use('/api/v3/chat', router);
  return app;
}

describe('POST /messages/move — ADR-0031 WP-24 owner gate', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    moveMessagesMock.mockReset();
    spawnTicketFromCriterionMock.mockReset();
  });

  it('not_owner_blocked: non-owner participant gets 403', async () => {
    // chat owner is user 7; caller is user 8
    dbGetMock.mockResolvedValueOnce({ created_by: 7 });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/messages/move')
      .set('x-test-user-id', '8')
      .set('x-test-user-role', 'user')
      .send({ target_conversation_id: 2, message_ids: [101] });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the chat owner/i);
    expect(moveMessagesMock).not.toHaveBeenCalled();
  });

  it('owner_passes: chat owner moves successfully', async () => {
    dbGetMock.mockResolvedValueOnce({ created_by: 7 });
    moveMessagesMock.mockResolvedValueOnce({
      moved_count: 1,
      source_message_ids: [101],
      target_message_ids: [501],
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/messages/move')
      .set('x-test-user-id', '7')
      .set('x-test-user-role', 'user')
      .send({ target_conversation_id: 2, message_ids: [101] });

    expect(res.status).toBe(200);
    expect(res.body.data.moved_count).toBe(1);
    expect(moveMessagesMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceConversationId: 1,
      targetConversationId: 2,
      messageIds: [101],
      userId: 7,
      actorIsChatOwner: true,
    }));
  });

  it('admin_override: global admin moves successfully even if not chat owner', async () => {
    // chat owner is 7; caller is admin user 99
    dbGetMock.mockResolvedValueOnce({ created_by: 7 });
    moveMessagesMock.mockResolvedValueOnce({
      moved_count: 1,
      source_message_ids: [101],
      target_message_ids: [501],
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/messages/move')
      .set('x-test-user-id', '99')
      .set('x-test-user-role', 'admin')
      .send({ target_conversation_id: 2, message_ids: [101] });

    expect(res.status).toBe(200);
    expect(moveMessagesMock).toHaveBeenCalledWith(expect.objectContaining({
      actorIsChatOwner: true,
    }));
  });

  it('global role "owner" is NOT honored — only chat ownership counts (regression)', async () => {
    // chat owner is 7; caller is user 8 with global role 'owner' (the legacy bug)
    dbGetMock.mockResolvedValueOnce({ created_by: 7 });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/messages/move')
      .set('x-test-user-id', '8')
      .set('x-test-user-role', 'owner')
      .send({ target_conversation_id: 2, message_ids: [101] });

    expect(res.status).toBe(403);
    expect(moveMessagesMock).not.toHaveBeenCalled();
  });

  it('returns 404 when conversation does not exist', async () => {
    dbGetMock.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/9999/messages/move')
      .set('x-test-user-id', '7')
      .send({ target_conversation_id: 2, message_ids: [101] });

    expect(res.status).toBe(404);
    expect(moveMessagesMock).not.toHaveBeenCalled();
  });
});

describe('POST /spawn-ticket — ADR-0031 WP-24 owner gate', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    moveMessagesMock.mockReset();
    spawnTicketFromCriterionMock.mockReset();
  });

  it('spawn_ticket_not_owner_blocked: non-owner gets 403', async () => {
    dbGetMock.mockResolvedValueOnce({ created_by: 7 });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/spawn-ticket')
      .set('x-test-user-id', '8')
      .set('x-test-user-role', 'user')
      .send({ ticket_data: { what: 'X', assigned_to: 7 } });

    expect(res.status).toBe(403);
    expect(spawnTicketFromCriterionMock).not.toHaveBeenCalled();
  });

  it('spawn_ticket_owner_passes: chat owner spawns successfully', async () => {
    dbGetMock.mockResolvedValueOnce({ created_by: 7 });
    spawnTicketFromCriterionMock.mockResolvedValueOnce({
      ticket_id: 144000,
      ticket_conversation_id: 4500,
      moved_count: 1,
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/spawn-ticket')
      .set('x-test-user-id', '7')
      .send({ ticket_data: { what: 'X', assigned_to: 7 } });

    expect(res.status).toBe(200);
    expect(spawnTicketFromCriterionMock).toHaveBeenCalledWith(expect.objectContaining({
      actorIsChatOwner: true,
    }));
  });

  it('spawn_ticket_admin_override: global admin spawns successfully', async () => {
    dbGetMock.mockResolvedValueOnce({ created_by: 7 });
    spawnTicketFromCriterionMock.mockResolvedValueOnce({
      ticket_id: 144001,
      ticket_conversation_id: 4501,
      moved_count: 0,
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/spawn-ticket')
      .set('x-test-user-id', '99')
      .set('x-test-user-role', 'admin')
      .send({ ticket_data: { what: 'X', assigned_to: 7 } });

    expect(res.status).toBe(200);
  });
});
