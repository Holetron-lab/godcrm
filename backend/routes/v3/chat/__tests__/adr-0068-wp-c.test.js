// ADR-0068 WP-C BE — server-fetch reply_to validation + GET enrichment.
//
// Locks the canonical contract negotiated 2026-05-19:
//   POST /conversations/:id/messages accepts reply_to: {message_id, fragment?, range?}
//   ONLY. The source message's sender_id / content / sender_kind are read
//   from the DB at validation time — client-supplied sender/content are
//   rejected by being silently ignored (they never reach the persisted shape).
//
//   GET /conversations/:id/messages walks metadata.reply_to.message_id values,
//   batch-fetches sources from the SAME conversation, and attaches a `replyTo`
//   field to each message with live (Telegram-style staleness) sender_name and
//   content preview (≤200 chars).
//
// Mirrors adr-0068-wp-b.test.js's mock topology — chatShared, the heavy
// agent helpers, the inflight service.

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
  conversationLock: { acquire: async (_id, fn) => fn(), withLock: async (_id, fn) => fn() },
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

vi.mock('../../../../services/chat/rowAttachment.js', () => ({
  getCommentThreadChildId: vi.fn(async () => null),
  resolveAttachedRow: vi.fn(async () => null),
  BOUND_TABLE_ID_CONVERSATIONS: 0,
  CONVERSATIONS_SENTINEL: 0,
  isConversationSentinel: (v) => Number(v) === 0,
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

// Helper — builds a stack of dbGet responses for the POST happy path:
//   1) conversation (for readonly + persona checks)
//   2) source message (loadAndValidateReplyTo)
//   3) participant lookup
//   4) inserted message row read-back (SELECT * FROM messages WHERE id = $1)
// + enrichment dbAll for replyTo.
function setupPostHappyPath({ conversationRow, sourceRow, insertedRow, enrichmentRows }) {
  dbGetMock
    .mockResolvedValueOnce(conversationRow)                     // conversation pre-fetch
    .mockResolvedValueOnce(sourceRow)                           // reply_to source fetch
    .mockResolvedValueOnce({ conversation_id: conversationRow.id, user_id: 7, role: 'admin' }) // participant
    .mockResolvedValueOnce(insertedRow);                        // SELECT inserted
  dbRunMock
    .mockResolvedValueOnce({ lastInsertRowid: insertedRow.id }) // INSERT
    .mockResolvedValueOnce({});                                 // UPDATE conversations.updated_at
  if (enrichmentRows !== undefined) {
    dbAllMock.mockResolvedValueOnce(enrichmentRows);            // batch source fetch for response enrichment
  }
}

// -----------------------------------------------------------------------------
// 1. POST validation — server-fetch source-of-truth
// -----------------------------------------------------------------------------

describe('ADR-0068 WP-C — POST /messages reply_to validation (server-fetch)', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
    dbAllMock.mockReset();
  });

  it('rejects with 400 when reply_to is not an object', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 10, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: false, parent_conversation_id: null, purpose: null,
    });
    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'hi', reply_to: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reply_to/);
  });

  it('rejects with 400 when message_id is missing or not positive', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 10, type: 'chat', space_id: 11, created_by: 7,
      is_readonly: false, parent_conversation_id: null, purpose: null,
    });
    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'hi', reply_to: { message_id: -5 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reply_to.message_id/);
  });

  it('returns 404 when reply_to.message_id does not exist', async () => {
    dbGetMock
      .mockResolvedValueOnce({
        id: 10, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: false, parent_conversation_id: null, purpose: null,
      })
      .mockResolvedValueOnce(null); // source lookup → not found
    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'hi', reply_to: { message_id: 999 } });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('rejects 400 when source message belongs to a different conversation (anti cross-quote)', async () => {
    dbGetMock
      .mockResolvedValueOnce({
        id: 10, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: false, parent_conversation_id: null, purpose: null,
      })
      .mockResolvedValueOnce({
        id: 555, conversation_id: 99, content: 'foreign message', sender_id: 8, sender_kind: 'user', is_deleted: 0,
      });
    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'hi', reply_to: { message_id: 555 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different conversation/);
  });

  it('rejects 400 when source message is deleted', async () => {
    dbGetMock
      .mockResolvedValueOnce({
        id: 10, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: false, parent_conversation_id: null, purpose: null,
      })
      .mockResolvedValueOnce({
        id: 555, conversation_id: 10, content: 'gone', sender_id: 8, sender_kind: 'user', is_deleted: 1,
      });
    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'hi', reply_to: { message_id: 555 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deleted/);
  });

  it('rejects 400 when fragment is not a substring of the live source content', async () => {
    dbGetMock
      .mockResolvedValueOnce({
        id: 10, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: false, parent_conversation_id: null, purpose: null,
      })
      .mockResolvedValueOnce({
        id: 555, conversation_id: 10,
        content: 'The quick brown fox jumps over the lazy dog',
        sender_id: 8, sender_kind: 'user', is_deleted: 0,
      });
    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'reply', reply_to: { message_id: 555, fragment: 'NEVER APPEARED' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a substring/);
  });

  it('rejects 400 when range is out of bounds', async () => {
    dbGetMock
      .mockResolvedValueOnce({
        id: 10, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: false, parent_conversation_id: null, purpose: null,
      })
      .mockResolvedValueOnce({
        id: 555, conversation_id: 10, content: 'short', sender_id: 8, sender_kind: 'user', is_deleted: 0,
      });
    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'reply', reply_to: { message_id: 555, range: [0, 9999] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/out of bounds/);
  });

  it('rejects 400 when fragment + range do not align with source content', async () => {
    dbGetMock
      .mockResolvedValueOnce({
        id: 10, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: false, parent_conversation_id: null, purpose: null,
      })
      .mockResolvedValueOnce({
        id: 555, conversation_id: 10,
        content: 'The quick brown fox',
        sender_id: 8, sender_kind: 'user', is_deleted: 0,
      });
    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'reply', reply_to: {
        message_id: 555,
        fragment: 'quick',
        range: [10, 15],
      } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/range does not align/);
  });

  it('persists only {message_id, fragment, range} — client-supplied sender/content ignored', async () => {
    setupPostHappyPath({
      conversationRow: {
        id: 10, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: false, parent_conversation_id: null, purpose: null,
      },
      sourceRow: {
        id: 555, conversation_id: 10,
        content: 'The quick brown fox jumps over the lazy dog',
        sender_id: 8, sender_kind: 'user', is_deleted: 0,
      },
      insertedRow: {
        id: 9001, conversation_id: 10, sender_id: 7, role: 'user',
        content: 'I reply',
        metadata: JSON.stringify({ reply_to: { message_id: 555, fragment: 'quick brown', range: [4, 15] } }),
        attachments: '[]', mentions: '[]',
      },
      enrichmentRows: [{
        id: 555, conversation_id: 10,
        content: 'The quick brown fox jumps over the lazy dog',
        sender_id: 8, sender_kind: 'user', is_deleted: 0, sender_name: 'Source User',
      }],
    });

    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({
        content: 'I reply',
        reply_to: {
          message_id: 555,
          fragment: 'quick brown',
          range: [4, 15],
          // These should be silently dropped (server reads them from DB):
          sender: 'CLIENT_LIE',
          content: 'CLIENT_LIE_CONTENT',
        },
      });

    expect(res.status).toBe(201);
    // Inspect the INSERT metadata payload — must NOT include client-supplied sender/content.
    const insertCall = dbRunMock.mock.calls.find(([sql]) =>
      typeof sql === 'string' && /INSERT INTO messages/.test(sql)
    );
    expect(insertCall).toBeDefined();
    const metadataJson = insertCall[1][8]; // 9th param: metadata JSON
    const persisted = JSON.parse(metadataJson);
    expect(persisted.reply_to).toEqual({
      message_id: 555,
      fragment: 'quick brown',
      range: [4, 15],
    });
    expect(persisted.reply_to).not.toHaveProperty('sender');
    expect(persisted.reply_to).not.toHaveProperty('content');
  });

  it('returns response with enriched replyTo (live sender_name + content preview) on POST', async () => {
    setupPostHappyPath({
      conversationRow: {
        id: 10, type: 'chat', space_id: 11, created_by: 7,
        is_readonly: false, parent_conversation_id: null, purpose: null,
      },
      sourceRow: {
        id: 555, conversation_id: 10,
        content: 'Source content here',
        sender_id: 8, sender_kind: 'user', is_deleted: 0,
      },
      insertedRow: {
        id: 9002, conversation_id: 10, sender_id: 7, role: 'user',
        content: 'reply',
        metadata: JSON.stringify({ reply_to: { message_id: 555 } }),
        attachments: '[]', mentions: '[]',
      },
      enrichmentRows: [{
        id: 555, conversation_id: 10,
        content: 'Source content here',
        sender_id: 8, sender_kind: 'user', is_deleted: 0, sender_name: 'Source User',
      }],
    });

    const res = await request(buildApp())
      .post('/api/v3/chat/conversations/10/messages')
      .set('x-test-user-id', '7')
      .send({ content: 'reply', reply_to: { message_id: 555 } });

    expect(res.status).toBe(201);
    expect(res.body.data.replyTo).toBeDefined();
    expect(res.body.data.replyTo.id).toBe(555);
    expect(res.body.data.replyTo.content).toBe('Source content here');
    expect(res.body.data.replyTo.sender_name).toBe('Source User');
    expect(res.body.data.replyTo.sender_kind).toBe('user');
  });
});

// -----------------------------------------------------------------------------
// 2. GET enrichment — Telegram-style staleness + cross-conversation defense
// -----------------------------------------------------------------------------

describe('ADR-0068 WP-C — GET /messages reply_to enrichment', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbRunMock.mockReset();
    dbAllMock.mockReset();
  });

  // Helper: stack dbAll calls for GET /messages. The handler calls dbAll twice:
  //   1) the main messages SELECT
  //   2) the reply_to enrichment batch SELECT
  // and dbGet once for the conversation row.
  function setupGetWithMessages(rawMessages, enrichmentRows = []) {
    dbAllMock
      .mockResolvedValueOnce(rawMessages)        // main messages query
      .mockResolvedValueOnce(enrichmentRows);    // enrichment batch
    dbGetMock.mockResolvedValueOnce({
      settings: '{}', bound_table_id: null, bound_row_id: null,
      is_processing: false, processing_started_at: null,
      processing_agent_id: null, processing_agent_name: null,
      parent_conversation_id: null, purpose: null, is_readonly: false,
    });
  }

  it('attaches live source content (Telegram-style staleness)', async () => {
    setupGetWithMessages(
      [
        {
          id: 9001, conversation_id: 10, sender_id: 7, content: 'reply',
          content_type: 'text', mentions: '[]', attachments: '[]',
          metadata: JSON.stringify({ reply_to: { message_id: 555 } }),
          parent_id: null, sender_type: 'human', tool_results: null,
          created_at: new Date().toISOString(),
        },
      ],
      [{
        id: 555, conversation_id: 10,
        content: 'UPDATED source content after edit',
        sender_id: 8, sender_kind: 'user', is_deleted: 0, sender_name: 'Source User',
      }]
    );

    const res = await request(buildApp())
      .get('/api/v3/chat/conversations/10/messages?limit=50')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    const m = res.body.data.messages[0];
    expect(m.replyTo).toEqual(expect.objectContaining({
      id: 555,
      content: 'UPDATED source content after edit',
      sender_name: 'Source User',
      sender_kind: 'user',
    }));
  });

  it('marks reply_to as deleted=true when source is missing from the batch result', async () => {
    setupGetWithMessages(
      [
        {
          id: 9001, conversation_id: 10, sender_id: 7, content: 'reply',
          content_type: 'text', mentions: '[]', attachments: '[]',
          metadata: JSON.stringify({ reply_to: { message_id: 555, fragment: 'gone' } }),
          parent_id: null, sender_type: 'human', tool_results: null,
          created_at: new Date().toISOString(),
        },
      ],
      [] // source not returned — either deleted or filtered by conversation_id
    );

    const res = await request(buildApp())
      .get('/api/v3/chat/conversations/10/messages?limit=50')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    const m = res.body.data.messages[0];
    expect(m.replyTo).toEqual({
      id: 555,
      deleted: true,
      fragment: 'gone',
      range: null,
    });
  });

  it('truncates long source content to 200 chars and sets truncated=true', async () => {
    const longContent = 'a'.repeat(500);
    setupGetWithMessages(
      [
        {
          id: 9001, conversation_id: 10, sender_id: 7, content: 'reply',
          content_type: 'text', mentions: '[]', attachments: '[]',
          metadata: JSON.stringify({ reply_to: { message_id: 555 } }),
          parent_id: null, sender_type: 'human', tool_results: null,
          created_at: new Date().toISOString(),
        },
      ],
      [{
        id: 555, conversation_id: 10, content: longContent,
        sender_id: 8, sender_kind: 'user', is_deleted: 0, sender_name: 'Long Source',
      }]
    );

    const res = await request(buildApp())
      .get('/api/v3/chat/conversations/10/messages?limit=50')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    const m = res.body.data.messages[0];
    expect(m.replyTo.content).toHaveLength(200);
    expect(m.replyTo.truncated).toBe(true);
  });

  it('passes conversation_id to the enrichment batch query (cross-conversation defense)', async () => {
    setupGetWithMessages(
      [
        {
          id: 9001, conversation_id: 10, sender_id: 7, content: 'reply',
          content_type: 'text', mentions: '[]', attachments: '[]',
          metadata: JSON.stringify({ reply_to: { message_id: 555 } }),
          parent_id: null, sender_type: 'human', tool_results: null,
          created_at: new Date().toISOString(),
        },
      ],
      []
    );

    const res = await request(buildApp())
      .get('/api/v3/chat/conversations/10/messages?limit=50')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    // Second dbAll call is the enrichment query — its SQL must filter by
    // conversation_id, and the params must include conversationId.
    const enrichmentCall = dbAllMock.mock.calls[1];
    expect(enrichmentCall).toBeDefined();
    const [sql, params] = enrichmentCall;
    expect(sql).toMatch(/conversation_id\s*=\s*\$2/);
    // params: [ids, conversationId]
    expect(params[1]).toBe('10');
  });

  it('does not call enrichment when no messages carry metadata.reply_to', async () => {
    setupGetWithMessages(
      [
        {
          id: 9001, conversation_id: 10, sender_id: 7, content: 'plain',
          content_type: 'text', mentions: '[]', attachments: '[]',
          metadata: '{}',
          parent_id: null, sender_type: 'human', tool_results: null,
          created_at: new Date().toISOString(),
        },
      ],
      []
    );

    const res = await request(buildApp())
      .get('/api/v3/chat/conversations/10/messages?limit=50')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    // Only the main messages query should have hit dbAll.
    expect(dbAllMock).toHaveBeenCalledTimes(1);
    expect(res.body.data.messages[0].replyTo).toBeUndefined();
  });
});
