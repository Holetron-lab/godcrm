// ADR-0068 WP-B — guards & cascade tests for the comment-thread BE.
//
// Covers (per ticket T-159008 acceptance criteria):
//   - POST /comment-thread idempotency: calling twice returns the same child id.
//   - Readonly conversation: non-owner gets 403 with comment_thread_child_id
//     hint; owner posting as space bypasses the lock.
//   - sender_kind = 'space' requires owner OR space admin AND a space_id that
//     matches the conversation; sender_id is preserved as the real actor.
//   - Edit guard: PATCH /messages/:id/content rejects non-author callers.
//   - Cascade-archive: deleting a parent flips child purpose → comments_archived
//     and nulls parent_conversation_id; child messages are NOT touched.
//
// Strategy mirrors messageController-move-owner-gate.test.js — mock chatShared
// + DB helpers, mount the routers under a tiny express app, drive via supertest.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

// Shared DB mocks — every test rewires its own queue per case.
const dbGetMock = vi.fn();
const dbRunMock = vi.fn();
const dbAllMock = vi.fn();
const canAdministerMock = vi.fn();

function fakeRequireAuth(req, _res, next) {
  const id = Number(req.headers['x-test-user-id']);
  req.user = { userId: id, id };
  next();
}

const success = (res, data) => res.status(200).json({ success: true, data });
const created = (res, data) => res.status(201).json({ success: true, data });
const error = (res, code, msg, status = 500) =>
  res.status(status).json({ success: false, error: code, message: msg });
const badRequest = (res, msg) => res.status(400).json({ success: false, error: msg });
const notFound = (res, msg) => res.status(404).json({ success: false, error: msg });
const forbidden = (res, msg) => res.status(403).json({ success: false, error: msg });

vi.mock('../chatShared.js', () => ({
  dbRun: (...args) => dbRunMock(...args),
  dbGet: (...args) => dbGetMock(...args),
  dbAll: (...args) => dbAllMock(...args),
  isPostgres: () => true,
  safeJsonParse: (v, fallback) => {
    try { return v == null ? fallback : (typeof v === 'string' ? JSON.parse(v) : v); }
    catch { return fallback; }
  },
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  success, created, error, badRequest, notFound, forbidden,
  requireAuth: fakeRequireAuth,
  getAttachmentBaseUrl: () => '',
  conversationLock: { withLock: async (_id, fn) => fn() },
  parseInvocationMentions: () => [],
  parseInvocationCommands: () => [],
  parseMentions: () => [],
  parseDelegations: () => [],
  parseReferenceMentions: () => [],
  parseReferenceCommands: () => [],
}));

vi.mock('../../../../services/messageMoveService.js', () => ({
  moveMessages: vi.fn(),
  MoveValidationError: class extends Error {},
  MoveAuthError: class extends Error {},
}));

vi.mock('../../../../services/criterionTicketSpawnService.js', () => ({
  spawnTicketFromCriterion: vi.fn(),
  SpawnValidationError: class extends Error {},
}));

vi.mock('../../../../services/EffectiveRoleService.js', () => ({
  canAdminister: (...args) => canAdministerMock(...args),
}));

vi.mock('../chatAgentHelpers.js', () => ({
  resolveMentionedUser: vi.fn(),
  resolveAgentUser: vi.fn(),
  findAiAgentByCommand: vi.fn(),
  autoJoinAgentToConversation: vi.fn(),
  resolveAgentInfoForMessages: vi.fn(async (msgs) => msgs),
  validateSubAgentRowIds: vi.fn(async () => []),
  enrichSubAgents: vi.fn(async () => []),
}));

vi.mock('../chatAgentExecution.js', () => ({
  executeAgentResponse: vi.fn(),
}));

vi.mock('../chatAgentAutoRespond.js', () => ({
  getAutoRespondAgents: vi.fn(async () => []),
  shouldAutoRespondWithAI: vi.fn(async () => false),
  getDefaultAgentForConversation: vi.fn(async () => null),
}));

vi.mock('../../../../services/inflight/queryActive.js', () => ({
  queryActiveInflight: vi.fn(async () => []),
}));

const { default: registerMessageRoutes } = await import('../messageController.js');
const { default: registerConversationCrudRoutes } = await import('../conversationCrudController.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerConversationCrudRoutes(router);
  registerMessageRoutes(router);
  app.use('/api/v3/chat', router);
  return app;
}

// ---------------------------------------------------------------------------
// POST /conversations/:id/comment-thread — idempotency (ticket AC #2)
// ---------------------------------------------------------------------------
describe('POST /conversations/:id/comment-thread — ADR-0068 WP-B1 idempotency', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
  });

  it('returns existing child on second call (same id, no 4xx)', async () => {
    // First call: parent lookup returns parent, no existing child, INSERT
    // returns id=555, participant insert OK, child re-read returns full row.
    dbGetMock
      .mockResolvedValueOnce({ id: 1, title: 'Announcements', space_id: 11 }) // parent
      .mockResolvedValueOnce(null)                                              // no existing
      .mockResolvedValueOnce({ id: 555, parent_conversation_id: 1, purpose: 'comments', title: '💬 Comments — Announcements' }); // re-read

    dbRunMock
      .mockResolvedValueOnce({ lastInsertRowid: 555 }) // INSERT conversations RETURNING id
      .mockResolvedValueOnce({ lastInsertRowid: 1 });  // INSERT participant

    const app = buildApp();
    const first = await request(app)
      .post('/api/v3/chat/conversations/1/comment-thread')
      .set('x-test-user-id', '7')
      .send({});

    expect(first.status).toBe(201);
    expect(first.body.data.child_id).toBe(555);
    expect(first.body.data.found).toBe(false);

    // Second call: parent lookup returns parent, existing child found,
    // idempotent path returns 200 with same id.
    dbGetMock.mockReset();
    dbRunMock.mockReset();
    dbGetMock
      .mockResolvedValueOnce({ id: 1, title: 'Announcements', space_id: 11 }) // parent
      .mockResolvedValueOnce({ id: 555, parent_conversation_id: 1, purpose: 'comments', title: '💬 Comments — Announcements' }); // existing
    dbRunMock.mockResolvedValueOnce({ lastInsertRowid: 1 }); // participant idempotent insert

    const second = await request(app)
      .post('/api/v3/chat/conversations/1/comment-thread')
      .set('x-test-user-id', '7')
      .send({});

    expect(second.status).toBe(200);
    expect(second.body.data.child_id).toBe(555);
    expect(second.body.data.found).toBe(true);
  });

  it('404 when parent is missing', async () => {
    dbGetMock.mockResolvedValueOnce(null); // parent lookup miss

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/9999/comment-thread')
      .set('x-test-user-id', '7')
      .send({});

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /conversations/:id/messages — readonly guard (ticket AC #3)
// ---------------------------------------------------------------------------
describe('POST /messages — ADR-0068 WP-B3 readonly guard', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
    canAdministerMock.mockReset();
  });

  it('non-owner gets 403 with comment_thread_child_id hint when readonly', async () => {
    // 1) conversation load (readonly=true, space=11, owner=7)
    // 2) child lookup → finds child=555
    dbGetMock
      .mockResolvedValueOnce({
        id: 1, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: true, parent_conversation_id: null, purpose: null,
      })
      .mockResolvedValueOnce({ id: 555 }); // child for redirect hint

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/messages')
      .set('x-test-user-id', '99') // not the owner
      .send({ content: 'attempting to post in a channel' });

    expect(res.status).toBe(403);
    const parsed = JSON.parse(res.body.error);
    expect(parsed.code).toBe('READONLY_CONVERSATION');
    expect(parsed.comment_thread_child_id).toBe(555);
  });

  it('owner posting as space bypasses readonly lock', async () => {
    // conversation load (readonly=true, space=11, owner=7)
    dbGetMock
      .mockResolvedValueOnce({
        id: 1, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: true, parent_conversation_id: null, purpose: null,
      })
      // participant lookup
      .mockResolvedValueOnce({ conversation_id: 1, user_id: 7, role: 'admin' })
      // re-read after insert
      .mockResolvedValueOnce({ id: 9001, conversation_id: 1, sender_id: 7, sender_kind: 'space', sender_space_id: 11, content: 'hi', mentions: '[]', attachments: '[]', metadata: '{}' });

    canAdministerMock.mockResolvedValueOnce(true); // space admin = yes
    dbRunMock
      .mockResolvedValueOnce({ lastInsertRowid: 9001 }) // INSERT messages
      .mockResolvedValueOnce({ rowCount: 1 });           // UPDATE conversations.updated_at

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'hi', sender_kind: 'space', sender_space_id: 11 });

    expect(res.status).toBe(201);
    expect(res.body.data.sender_kind).toBe('space');
    expect(res.body.data.sender_id).toBe(7); // audit trail — real actor preserved
  });

  it('rejects sender_kind="space" without ownership', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 1, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: false, parent_conversation_id: null, purpose: null,
    });
    canAdministerMock.mockResolvedValueOnce(false); // not a space admin

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/messages')
      .set('x-test-user-id', '99')
      .send({ content: 'sneaky', sender_kind: 'space', sender_space_id: 11 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/send-as-space requires chat owner or space admin/i);
  });

  it('rejects sender_space_id mismatched with conversation space', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 1, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: false, parent_conversation_id: null, purpose: null,
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/1/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'wrong space', sender_kind: 'space', sender_space_id: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must match the conversation's space/i);
  });
});

// ---------------------------------------------------------------------------
// PATCH /messages/:messageId/content — edit guard (ticket AC §Guards)
// ---------------------------------------------------------------------------
describe('PATCH /messages/:id/content — ADR-0068 WP-B4 edit guard', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
  });

  it('rejects edits by a non-author caller (persona does not transfer rights)', async () => {
    // Message authored by user 7, even if it shipped as a 'space' persona.
    dbGetMock.mockResolvedValueOnce({
      id: 9001, conversation_id: 1, sender_id: 7, content: 'orig', is_deleted: 0,
    });

    const app = buildApp();
    const res = await request(app)
      .patch('/api/v3/chat/messages/9001/content')
      .set('x-test-user-id', '8') // someone else
      .send({ content: 'tampered' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/your own messages/i);
    expect(dbRunMock).not.toHaveBeenCalled();
  });

  it('allows the real author to edit', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 9001, conversation_id: 1, sender_id: 7, content: 'orig', is_deleted: 0,
    });
    dbRunMock.mockResolvedValueOnce({ rowCount: 1 });

    const app = buildApp();
    const res = await request(app)
      .patch('/api/v3/chat/messages/9001/content')
      .set('x-test-user-id', '7')
      .send({ content: 'patched' });

    expect(res.status).toBe(200);
    expect(dbRunMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /conversations/:id — cascade-archive (ticket AC §Cascade)
// ---------------------------------------------------------------------------
describe('DELETE /conversations/:id — ADR-0068 WP-B cascade-archive', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
  });

  it('archives child and detaches parent_conversation_id; does not touch child messages', async () => {
    // 4 dbRun calls in order:
    //  1. UPDATE conversations (archive children)
    //  2. DELETE FROM messages WHERE conversation_id = parent
    //  3. DELETE FROM conversation_participants WHERE conversation_id = parent
    //  4. DELETE FROM conversations WHERE id = parent
    dbRunMock
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 5 })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const app = buildApp();
    const res = await request(app)
      .delete('/api/v3/chat/conversations/1')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    // First call must be the archive UPDATE — verify shape.
    const firstCall = dbRunMock.mock.calls[0];
    expect(firstCall[0]).toMatch(/UPDATE\s+conversations/i);
    expect(firstCall[0]).toMatch(/purpose\s*=\s*'comments_archived'/i);
    expect(firstCall[0]).toMatch(/parent_conversation_id\s*=\s*NULL/i);
    expect(firstCall[0]).toMatch(/WHERE\s+parent_conversation_id\s*=\s*\$1\s+AND\s+purpose\s*=\s*'comments'/i);
    expect(firstCall[1]).toEqual(['1']);

    // None of the subsequent DELETEs touch the child rows — they all bind to
    // the parent conversation_id, which after the UPDATE no longer matches
    // any child rows (parent_conversation_id was nulled).
    const deleteMessages = dbRunMock.mock.calls[1][0];
    expect(deleteMessages).toMatch(/DELETE\s+FROM\s+messages\s+WHERE\s+conversation_id\s*=\s*\$1/i);
    expect(dbRunMock.mock.calls[1][1]).toEqual(['1']);
  });
});
