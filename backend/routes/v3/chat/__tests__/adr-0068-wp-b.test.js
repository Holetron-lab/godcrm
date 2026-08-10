// ADR-0068 WP-B BE — comment-thread + channel-readonly + send-as-space.
//
// Covers all four guards locked in the chat sign-off (2026-05-19, T-159008):
//   1. POST /conversations/:id/comment-thread idempotency (twice → same id, no 4xx).
//   2. is_readonly=true blocks non-owner sends (403 + comment_thread_child_id hint).
//   3. is_readonly=true + sender_kind='space' + chat owner → message goes through
//      with sender_id preserved (audit) and sender_space_id stamped.
//   4. PATCH /messages/:id/content — only the real author (sender_id) may edit.
//
// Plus the cascade-archive contract verified at the DELETE handler boundary:
//   5. DELETE /conversations/:id first runs the UPDATE that flips comment-thread
//      children to purpose='comments_archived' before any message DELETE.
//
// Strategy mirrors messageController-move-owner-gate.test.js: mock chatShared.js
// + the heavy agent helpers, build the routers in-memory, hit them via supertest.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

const dbGetMock = vi.fn();
const dbRunMock = vi.fn();
const dbAllMock = vi.fn();
const canAdministerMock = vi.fn();

function fakeRequireAuth(req, _res, next) {
  const id = Number(req.headers['x-test-user-id']);
  req.user = { userId: id, id, role: req.headers['x-test-user-role'] || 'user' };
  next();
}

const success = (res, data) => res.status(200).json({ success: true, data });
const created = (res, data) => res.status(201).json({ success: true, data });
const error = (res, code, msg, status = 500) =>
  res.status(status).json({ success: false, error: code, message: msg });
const badRequest = (res, msg) => res.status(400).json({ success: false, error: msg });
const notFound = (res, msg) => res.status(404).json({ success: false, error: msg });
const forbidden = (res, msg) => res.status(403).json({ success: false, error: msg });
const unauthorized = (res, msg) => res.status(401).json({ success: false, error: msg });

vi.mock('../chatShared.js', () => ({
  dbRun: (...args) => dbRunMock(...args),
  dbGet: (...args) => dbGetMock(...args),
  dbAll: (...args) => dbAllMock(...args),
  isPostgres: () => true,
  safeJsonParse: (v, fb) => { try { return v ? JSON.parse(v) : (fb ?? null); } catch { return fb ?? null; } },
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  success, created, error, badRequest, notFound, forbidden, unauthorized,
  requireAuth: fakeRequireAuth,
  getAttachmentBaseUrl: () => '',
  conversationLock: { acquire: async (_id, fn) => fn() },
  parseInvocationMentions: () => [],
  parseInvocationCommands: () => [],
  parseMentions: () => [],
  parseDelegations: () => [],
  parseReferenceMentions: () => [],
  parseReferenceCommands: () => [],
  BUBBLE_PAGE_SIZE: 50,
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
  resolveAgentInfoForMessages: vi.fn(async (rows) => rows),
  validateSubAgentRowIds: vi.fn(async () => []),
  enrichSubAgents: vi.fn(async () => []),
}));

vi.mock('../chatAgentExecution.js', () => ({
  executeAgentResponse: vi.fn(),
}));

vi.mock('../chatAgentAutoRespond.js', () => ({
  getAutoRespondAgents: vi.fn(async () => []),
  shouldAutoRespondWithAI: vi.fn(() => false),
  getDefaultAgentForConversation: vi.fn(async () => null),
}));

vi.mock('../../../../services/inflight/queryActive.js', () => ({
  queryActiveInflight: vi.fn(async () => []),
}));

const { default: registerMessageRoutes } = await import('../messageController.js');
const { default: registerConversationCrudRoutes } = await import('../conversationCrudController.js');
const { default: registerConversationExtrasRoutes } = await import('../conversationExtrasController.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerConversationCrudRoutes(router);
  registerConversationExtrasRoutes(router);
  registerMessageRoutes(router);
  app.use('/api/v3/chat', router);
  return app;
}

// -----------------------------------------------------------------------------
// 1. POST /conversations/:id/comment-thread — idempotency
// -----------------------------------------------------------------------------

describe('ADR-0068 WP-B1 — POST /conversations/:id/comment-thread', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
  });

  it('returns the existing child on the second call (no INSERT)', async () => {
    // First call path is exercised by the integration suite; here we cover the
    // pure idempotency branch — existing child already in the DB.
    const existingChild = { id: 555, parent_conversation_id: 100, purpose: 'comments', title: 'Comments — #100' };
    dbGetMock
      .mockResolvedValueOnce({ id: 100, title: 'Parent', space_id: 11 }) // parent lookup
      .mockResolvedValueOnce(existingChild);                              // existing-child lookup

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/100/comment-thread')
      .set('x-test-user-id', '7')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(true);
    expect(res.body.data.child_id).toBe(555);
    // No INSERT into conversations should have happened.
    const insertConversationCalls = dbRunMock.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && /INSERT INTO conversations/i.test(sql)
    );
    expect(insertConversationCalls).toHaveLength(0);
  });

  it('rejects with 400 when conversation id is invalid', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/notanumber/comment-thread')
      .set('x-test-user-id', '7')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when parent does not exist', async () => {
    dbGetMock.mockResolvedValueOnce(null); // parent lookup
    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/9999/comment-thread')
      .set('x-test-user-id', '7')
      .send({});
    expect(res.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------
// 2-3. POST /conversations/:id/messages — readonly guard + send-as-space
// -----------------------------------------------------------------------------

describe('ADR-0068 WP-B3 — readonly guard on POST /messages', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
    canAdministerMock.mockReset();
  });

  it('non-owner is blocked with 403 and comment_thread_child_id hint', async () => {
    // 1) conversation lookup (is_readonly = true, owner = 7)
    dbGetMock.mockResolvedValueOnce({
      id: 10, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: true, parent_conversation_id: null, purpose: null,
    });
    // 2) comment-thread child lookup for the redirect hint
    dbGetMock.mockResolvedValueOnce({ id: 555 });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '8') // not the owner
      .send({ content: 'forbidden words' });

    expect(res.status).toBe(403);
    const body = JSON.parse(res.body.error);
    expect(body.code).toBe('READONLY_CONVERSATION');
    expect(body.comment_thread_child_id).toBe(555);
  });

  it('owner posting as space bypasses the readonly lock', async () => {
    // 1) conversation (readonly, owner=7)
    dbGetMock.mockResolvedValueOnce({
      id: 10, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: true, parent_conversation_id: null, purpose: null,
    });
    // 2) participant lookup
    dbGetMock.mockResolvedValueOnce({ conversation_id: 10, user_id: 7, role: 'admin' });
    // 3) re-read of inserted message
    dbGetMock.mockResolvedValueOnce({
      id: 901, conversation_id: 10, sender_id: 7, role: 'user', content: 'hello',
      content_type: 'text', mentions: '[]', attachments: '[]',
      sender_kind: 'space', sender_space_id: 11,
    });
    // 4) space_id lookup for the auto-respond path (line ~115)
    dbGetMock.mockResolvedValueOnce({ space_id: 11 });
    dbRunMock.mockResolvedValue({ lastInsertRowid: 901 });
    canAdministerMock.mockResolvedValue(false); // owner gate passes via created_by

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'hello', sender_kind: 'space', sender_space_id: 11 });

    // POST /messages → 201 Created (canonical response helper).
    expect(res.status).toBe(201);
    // The INSERT carried sender_id=7 (real actor) AND the persona stamp.
    const insertCall = dbRunMock.mock.calls.find(([sql]) =>
      typeof sql === 'string' && /INSERT INTO messages/i.test(sql)
    );
    expect(insertCall).toBeDefined();
    const params = insertCall[1];
    // params order: [id, userId, role, content, content_type, mentionsJson,
    //                attachmentsJson, parent_id, metadataJson, sender_kind, sender_space_id]
    expect(params[1]).toBe(7);          // sender_id = real user (audit)
    expect(params[9]).toBe('space');    // sender_kind
    expect(params[10]).toBe(11);        // sender_space_id
  });

  it('non-owner attempting send-as-space gets 403', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 10, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: false, parent_conversation_id: null, purpose: null,
    });
    canAdministerMock.mockResolvedValue(false);

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '8')
      .send({ content: 'impersonation attempt', sender_kind: 'space', sender_space_id: 11 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/send-as-space/i);
  });

  it('send-as-space across different spaces is rejected with 400', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 10, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: false, parent_conversation_id: null, purpose: null,
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'wrong space', sender_kind: 'space', sender_space_id: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must match the conversation's space/);
  });

  it('rejects unknown sender_kind values', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 10, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: false, parent_conversation_id: null, purpose: null,
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'agent injection', sender_kind: 'agent', sender_space_id: 11 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid sender_kind/);
  });
});

// -----------------------------------------------------------------------------
// 4. PATCH /messages/:id/content — edit-only-real-actor
// -----------------------------------------------------------------------------

describe('ADR-0068 WP-B4 — edit-only-real-actor on PATCH /messages/:id/content', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
  });

  it('blocks edits by a non-author with 403', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 901, conversation_id: 10, sender_id: 7, content: 'old', is_deleted: 0 });

    const app = buildApp();
    const res = await request(app)
      .patch('/api/v3/chat/messages/901/content')
      .set('x-test-user-id', '8') // different user
      .send({ content: 'tampered' });

    expect(res.status).toBe(403);
    expect(dbRunMock).not.toHaveBeenCalled();
  });

  it('allows the original author to edit', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 901, conversation_id: 10, sender_id: 7, content: 'old', is_deleted: 0 });
    dbRunMock.mockResolvedValue({});

    const app = buildApp();
    const res = await request(app)
      .patch('/api/v3/chat/messages/901/content')
      .set('x-test-user-id', '7')
      .send({ content: 'fresh' });

    expect(res.status).toBe(200);
    expect(dbRunMock).toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// 5. DELETE /conversations/:id — cascade-archive contract
// -----------------------------------------------------------------------------

describe('ADR-0068 WP-B Cascade — DELETE /conversations/:id', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
  });

  it('archives comment-thread children BEFORE wiping the parent', async () => {
    dbRunMock.mockResolvedValue({});

    const app = buildApp();
    const res = await request(app)
      .delete('/api/v3/chat/conversations/100')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);

    // Inspect the order of dbRun calls; archive must come first, then the
    // hard-delete cascade on messages/participants/conversation.
    const sqls = dbRunMock.mock.calls.map(([sql]) => sql);
    const archiveIdx = sqls.findIndex(s => /UPDATE conversations[\s\S]*purpose\s*=\s*'comments_archived'/i.test(s));
    const messagesDeleteIdx = sqls.findIndex(s => /DELETE FROM messages/i.test(s));
    const conversationsDeleteIdx = sqls.findIndex(s => /DELETE FROM conversations/i.test(s));

    expect(archiveIdx).toBeGreaterThanOrEqual(0);
    expect(messagesDeleteIdx).toBeGreaterThan(archiveIdx);
    expect(conversationsDeleteIdx).toBeGreaterThan(archiveIdx);
  });
});

// -----------------------------------------------------------------------------
// 6. GET /conversations/:id/messages — persona JOIN on `spaces`
// -----------------------------------------------------------------------------

describe('ADR-0068 WP-B5 — persona enrichment on GET /messages', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
    dbAllMock.mockReset();
  });

  it('JOINs spaces and surfaces nested sender_space {id,name,icon,color} for sender_kind=space rows', async () => {
    // Row 1 — user post, no persona fields populated by the JOIN.
    // Row 2 — space-persona post, JOIN columns populated.
    // Row 3 — space-persona post BUT referenced space row deleted (FK
    //         preserved on the message, JOIN returns NULLs).
    dbAllMock.mockResolvedValueOnce([
      {
        id: 901, conversation_id: 10, sender_id: 7, content: 'plain user',
        content_type: 'text', mentions: '[]', attachments: '[]', metadata: null,
        sender_kind: 'user', sender_space_id: null,
        sender_name: 'Alice', sender_avatar: null, sender_user_type: 'human',
        _sender_space_name: null, _sender_space_icon: null, _sender_space_color: null,
        created_at: '2026-05-19T10:00:00Z',
      },
      {
        id: 902, conversation_id: 10, sender_id: 7, content: 'broadcast',
        content_type: 'text', mentions: '[]', attachments: '[]', metadata: null,
        sender_kind: 'space', sender_space_id: 11,
        sender_name: 'Alice', sender_avatar: null, sender_user_type: 'human',
        _sender_space_name: 'Development', _sender_space_icon: '🛠', _sender_space_color: '#0ea5e9',
        created_at: '2026-05-19T10:01:00Z',
      },
      {
        id: 903, conversation_id: 10, sender_id: 7, content: 'orphaned persona',
        content_type: 'text', mentions: '[]', attachments: '[]', metadata: null,
        sender_kind: 'space', sender_space_id: 999,
        sender_name: 'Alice', sender_avatar: null, sender_user_type: 'human',
        _sender_space_name: null, _sender_space_icon: null, _sender_space_color: null,
        created_at: '2026-05-19T10:02:00Z',
      },
    ]);
    // conversation lookup (Promise.all sibling).
    dbGetMock
      .mockResolvedValueOnce({
        settings: null, bound_table_id: null, bound_row_id: null,
        is_processing: false, processing_started_at: null,
        processing_agent_id: null, processing_agent_name: null,
        parent_conversation_id: null, purpose: null, is_readonly: false,
      })
      // contextStats
      .mockResolvedValueOnce({ total_tokens_in: 0, total_tokens_out: 0, total_messages: 3, text_messages: 3, tool_calls: 0, thinking_steps: 0 })
      // lastAgentMsg
      .mockResolvedValueOnce(null)
      // active_agent_status row
      .mockResolvedValueOnce(null)
      // active_plan row
      .mockResolvedValueOnce(null)
      // getCommentThreadChildId → existing-child lookup (returns null = no child)
      .mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);

    // 1) The SQL fired by dbAll must include the persona JOIN + underscore aliases.
    const messagesCall = dbAllMock.mock.calls.find(([sql]) =>
      typeof sql === 'string' && /FROM messages m/i.test(sql)
    );
    expect(messagesCall).toBeDefined();
    const sql = messagesCall[0];
    expect(sql).toMatch(/LEFT JOIN spaces s ON m\.sender_space_id = s\.id/);
    expect(sql).toMatch(/s\.name as _sender_space_name/);
    expect(sql).toMatch(/s\.icon as _sender_space_icon/);
    expect(sql).toMatch(/s\.theme_primary as _sender_space_color/);

    // 2) Internal underscore aliases MUST NOT leak in the response.
    const messages = res.body.data.messages;
    expect(messages).toHaveLength(3);
    for (const m of messages) {
      expect(m).not.toHaveProperty('_sender_space_name');
      expect(m).not.toHaveProperty('_sender_space_icon');
      expect(m).not.toHaveProperty('_sender_space_color');
    }

    // 3) Plain user message — kind='user', sender_space=null.
    const userMsg = messages.find(m => m.id === 901);
    expect(userMsg.sender_kind).toBe('user');
    expect(userMsg.sender_space_id).toBeNull();
    expect(userMsg.sender_space).toBeNull();

    // 4) Space-persona message — kind='space', nested payload populated.
    const spaceMsg = messages.find(m => m.id === 902);
    expect(spaceMsg.sender_kind).toBe('space');
    expect(spaceMsg.sender_space_id).toBe(11);
    expect(spaceMsg.sender_space).toEqual({
      id: 11, name: 'Development', icon: '🛠', color: '#0ea5e9',
    });
    // Real-actor identity is preserved alongside persona stamp (audit invariant).
    expect(spaceMsg.sender_id).toBe(7);
    expect(spaceMsg.sender_name).toBe('Alice');

    // 5) Orphaned persona (space row deleted, FK preserved on message) —
    //    raw sender_space_id still surfaced for FE fallback rendering, nested
    //    payload null so FE can render "(deleted space)" placeholder.
    const orphanMsg = messages.find(m => m.id === 903);
    expect(orphanMsg.sender_kind).toBe('space');
    expect(orphanMsg.sender_space_id).toBe(999);
    expect(orphanMsg.sender_space).toBeNull();
  });

  it('coerces NULL sender_kind to "user" on legacy rows', async () => {
    dbAllMock.mockResolvedValueOnce([
      {
        id: 800, conversation_id: 10, sender_id: 7, content: 'legacy',
        content_type: 'text', mentions: '[]', attachments: '[]', metadata: null,
        sender_kind: null, sender_space_id: null,
        sender_name: 'Alice', sender_avatar: null, sender_user_type: 'human',
        _sender_space_name: null, _sender_space_icon: null, _sender_space_color: null,
        created_at: '2026-05-19T09:00:00Z',
      },
    ]);
    dbGetMock
      .mockResolvedValueOnce({
        settings: null, bound_table_id: null, bound_row_id: null,
        is_processing: false, processing_started_at: null,
        processing_agent_id: null, processing_agent_name: null,
        parent_conversation_id: null, purpose: null, is_readonly: false,
      })
      .mockResolvedValueOnce({ total_tokens_in: 0, total_tokens_out: 0, total_messages: 1, text_messages: 1, tool_calls: 0, thinking_steps: 0 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    const [legacy] = res.body.data.messages;
    expect(legacy.sender_kind).toBe('user');
    expect(legacy.sender_space).toBeNull();
  });

  it('POST /messages response carries the nested sender_space for send-as-space', async () => {
    // 1) conversation (not readonly, owner=7).
    dbGetMock.mockResolvedValueOnce({
      id: 10, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: false, parent_conversation_id: null, purpose: null,
    });
    // 2) participant lookup.
    dbGetMock.mockResolvedValueOnce({ conversation_id: 10, user_id: 7, role: 'admin' });
    // 3) re-read of inserted message (SELECT * FROM messages WHERE id = $1).
    dbGetMock.mockResolvedValueOnce({
      id: 950, conversation_id: 10, sender_id: 7, role: 'user', content: 'hello',
      content_type: 'text', mentions: '[]', attachments: '[]', metadata: '{}',
      sender_kind: 'space', sender_space_id: 11,
    });
    // 4) sender_space enrichment dbGet on spaces (POST-only, parity with GET).
    dbGetMock.mockResolvedValueOnce({
      id: 11, name: 'Development', icon: '🛠', theme_primary: '#0ea5e9',
    });
    // 5) space_id lookup for the auto-respond path.
    dbGetMock.mockResolvedValueOnce({ space_id: 11 });
    dbRunMock.mockResolvedValue({ lastInsertRowid: 950 });
    canAdministerMock.mockResolvedValue(true);

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'hello', sender_kind: 'space', sender_space_id: 11 });

    expect(res.status).toBe(201);
    const body = res.body.data;
    expect(body.sender_kind).toBe('space');
    expect(body.sender_space_id).toBe(11);
    expect(body.sender_space).toEqual({
      id: 11, name: 'Development', icon: '🛠', color: '#0ea5e9',
    });
    // Real actor preserved on response (audit) even when posting as a space.
    expect(body.sender_id).toBe(7);
  });
});
