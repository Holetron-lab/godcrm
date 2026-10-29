// POST /conversations/:id/voice-notes — a chat-input recording posted back as
// a system message on the user's behalf.
//
// Runs against godcrm_test (ADR-0009 §Phase 7) because the dedup guarantee is
// the partial unique index from migration 095, not application logic.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';
import { dbRun, dbAll } from '../../../../database/connection.js';
import { createEphemeralWorkspace, fixtureToken } from '../../../../tests/helpers/workspace-fixture.js';
import { up as applyDedupIndex } from '../../../../database/migrations/knex/095_messages_client_id_dedup.js';
import registerVoiceNoteRoutes from '../voiceNoteController.js';

let app, ws, other, conversationId, readonlyId, fileId, otherFileId, textFileId;
const files = [];

async function insertFile(userId, spaceId, mime) {
  const id = `f_${fixtureToken()}`;
  await dbRun(`INSERT INTO files (id, name, original_name, mime_type, size, path, url, storage_provider_id, space_id, uploaded_by, visibility, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, 'internal', NOW(), NOW())`,
    [id, `${id}.webm`, 'voice.webm', mime, 1234, `/tmp/${id}`, `/uploads/spaces/${spaceId}/${id}.webm`, spaceId, userId]);
  files.push(id);
  return id;
}

async function insertConversation(spaceId, ownerId, extra = {}) {
  const row = await dbRun(`INSERT INTO conversations (type, title, created_by, space_id, is_readonly, created_at, updated_at) VALUES ('ai_chat', ?, ?, ?, ?, NOW(), NOW())`,
    ['voice-note test', ownerId, spaceId, !!extra.readonly]);
  await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'owner', NOW())`, [row.lastInsertRowid, ownerId]);
  return row.lastInsertRowid;
}

const post = (id, userId, body) => request(app).post(`/api/v3/chat/conversations/${id}/voice-notes`).set('x-user-id', String(userId)).send(body);
const rows = (id) => dbAll(`SELECT id, role, sender_type, sender_id, content, content_type, attachments, metadata FROM messages WHERE conversation_id = ? ORDER BY id`, [id]);

beforeAll(async () => {
  await applyDedupIndex({ raw: (sql) => dbRun(sql) });
  ws = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'voice-note' });
  other = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'voice-note-other' });
  conversationId = await insertConversation(ws.spaceId, ws.userId);
  readonlyId = await insertConversation(ws.spaceId, ws.userId, { readonly: true });
  fileId = await insertFile(ws.userId, ws.spaceId, 'audio/webm');
  otherFileId = await insertFile(other.userId, other.spaceId, 'audio/webm');
  textFileId = await insertFile(ws.userId, ws.spaceId, 'text/plain');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-user-id']) }; next(); });
  const router = Router();
  registerVoiceNoteRoutes(router);
  app.use('/api/v3/chat', router);
});

afterAll(async () => {
  await dbRun(`DELETE FROM files WHERE id = ANY($1::text[])`, [files]);
  await other?.cleanup();
  await ws?.cleanup();
});

describe('POST /conversations/:id/voice-notes', () => {
  it('validates the body', async () => {
    const res = await post(conversationId, ws.userId, { text: 'no ids' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/client_id/);
  });

  it('hides the conversation from non-participants', async () => {
    const res = await post(conversationId, other.userId, { client_id: 'c-outsider', file_id: otherFileId, text: 'hi' });
    expect(res.status).toBe(404);
  });

  it('refuses read-only conversations with the READONLY_CONVERSATION envelope', async () => {
    const res = await post(readonlyId, ws.userId, { client_id: 'c-ro', file_id: fileId, text: 'hi' });
    expect(res.status).toBe(403);
    // Same envelope POST /messages emits: the JSON payload rides in error.message.
    expect(JSON.parse(res.body.error.message).code).toBe('READONLY_CONVERSATION');
  });

  it('accepts only audio uploaded by the caller', async () => {
    expect((await post(conversationId, ws.userId, { client_id: 'c-foreign', file_id: otherFileId })).status).toBe(403);
    expect((await post(conversationId, ws.userId, { client_id: 'c-text', file_id: textFileId })).status).toBe(400);
    expect((await post(conversationId, ws.userId, { client_id: 'c-missing', file_id: 'nope' })).status).toBe(404);
    expect(await rows(conversationId)).toHaveLength(0);
  });

  it('stores the transcript as a system message with the audio attached', async () => {
    const res = await post(conversationId, ws.userId, { client_id: 'c-1', file_id: fileId, text: 'Привет, это заметка', duration: 4.2 });
    expect(res.status).toBe(201);
    const { data } = res.body;
    expect(data).toMatchObject({
      conversation_id: conversationId, sender_id: ws.userId, role: 'system', sender_type: 'system',
      content: 'Привет, это заметка', content_type: 'text', detected_lang: 'ru',
      metadata: { type: 'voice_note', client_id: 'c-1', duration: 4.2, actor: { id: ws.userId } },
    });
    expect(data.attachments).toEqual([{ id: fileId, name: 'voice.webm', type: 'audio/webm', size: 1234, url: `/uploads/spaces/${ws.spaceId}/${fileId}.webm`, duration: 4.2 }]);
  });

  it('returns the same message for a retried client_id', async () => {
    const first = await post(conversationId, ws.userId, { client_id: 'c-1', file_id: fileId, text: 'retry with different text' });
    expect(first.status).toBe(200);
    expect(first.body.data.content).toBe('Привет, это заметка');
    expect(await rows(conversationId)).toHaveLength(1);
  });

  it('keeps one row under concurrent identical posts', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post(conversationId, ws.userId, { client_id: 'c-race', file_id: fileId, text: 'race' })));
    expect(results.map(r => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map(r => r.body.data.id)).size).toBe(1);
    expect(await rows(conversationId)).toHaveLength(2);
  });

  it('does not hand another sender’s client_id back as the caller’s message', async () => {
    await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', NOW())`, [conversationId, other.userId]);
    const otherInSpace = await insertFile(other.userId, ws.spaceId, 'audio/ogg');
    const res = await post(conversationId, other.userId, { client_id: 'c-1', file_id: otherInSpace });
    expect(res.status).toBe(409);
    expect(await rows(conversationId)).toHaveLength(2);
  });
});
