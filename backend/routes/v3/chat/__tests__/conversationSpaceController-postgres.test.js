// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dbGet, dbAll, dbRun } from '../../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';

// Avoid loading unrelated agent runtimes; DB, permissions, uploads and file auth are real.
vi.mock('../chatShared.js', async () => ({
  ...await import('../../../../utils/response.js'),
  ...await import('../../../../utils/logger.js'),
  requireAuth: (req, _res, next) => { req.user.userId = req.user.id; next(); },
}));
const root = mkdtempSync(path.join(tmpdir(), 'chat-space-'));
process.env.UPLOAD_PATH = root;
let a, b, app, conversationId;
const token = userId => jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '5m' });
const patch = (spaceId, userId = a.userId) => request(app).patch(`/api/v3/chat/conversations/${conversationId}/space`)
  .auth(token(userId), { type: 'bearer' }).send({ space_id: spaceId });

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  a = await createEphemeralWorkspace({ label: 'chat-space-a', dashboard: false, table: false });
  b = await createEphemeralWorkspace({ label: 'chat-space-b', dashboard: false, table: false });
  await dbRun('INSERT INTO user_access_permissions (user_id, space_id, access_level) VALUES (?, ?, ?)', [a.userId, b.spaceId, 'admin']);
  conversationId = (await dbRun("INSERT INTO conversations (type, created_by, title) VALUES ('chat', ?, ?)", [a.userId, a.token])).lastInsertRowid;
  await dbRun('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [conversationId, b.userId]);
  const [{ default: register }, { default: files }, { uploadsFileGuard }, { authenticate }] = await Promise.all([
    import('../conversationSpaceController.js'), import('../../files.js'),
    import('../../../../middleware/fileGuard.js'), import('../../../../middleware/auth.js'),
  ]);
  app = express();
  app.use(express.json());
  app.use('/uploads', uploadsFileGuard, express.static(root));
  const chat = express.Router();
  register(chat);
  app.use('/api/v3/chat', authenticate, chat);
  app.use('/api/v3', authenticate, files);
});
afterAll(async () => {
  if (conversationId) {
    await dbRun('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
    await dbRun('DELETE FROM conversation_participants WHERE conversation_id = ?', [conversationId]);
    await dbRun('DELETE FROM conversations WHERE id = ?', [conversationId]);
  }
  if (a) {
    await dbRun('DELETE FROM files WHERE uploaded_by = ?', [a.userId]);
    await dbRun('DELETE FROM user_access_permissions WHERE user_id = ?', [a.userId]);
  }
  await b?.cleanup(); await a?.cleanup();
  rmSync(root, { recursive: true, force: true });
});

it('preserves old file metadata, access, messages and participants while future uploads use B', async () => {
  expect((await patch(a.spaceId)).status).toBe(200);
  const upload = async () => {
    const { space_id: spaceId } = await dbGet('SELECT space_id FROM conversations WHERE id = ?', [conversationId]);
    const result = await request(app).post('/api/v3/files/upload').auth(token(a.userId), { type: 'bearer' })
      .field('spaceId', String(spaceId)).field('visibility', 'private').attach('files', Buffer.from('fixture'), 'old.txt');
    expect(result.status).toBe(200);
    return dbGet('SELECT * FROM files WHERE uploaded_by = ? ORDER BY created_at DESC LIMIT 1', [a.userId]);
  };
  const oldFile = await upload();
  await dbRun("INSERT INTO messages (conversation_id, sender_id, role, content, attachments) VALUES (?, ?, 'user', 'keep me', ?)",
    [conversationId, a.userId, JSON.stringify([{ id: oldFile.id, url: oldFile.url }])]);
  const messages = await dbAll('SELECT * FROM messages WHERE conversation_id = ?', [conversationId]);
  const participants = await dbAll('SELECT * FROM conversation_participants WHERE conversation_id = ?', [conversationId]);
  expect((await request(app).get(oldFile.url).auth(token(b.userId), { type: 'bearer' })).status).toBe(403);
  expect((await patch(b.spaceId, b.userId)).status).toBe(403); // Space owner is not chat owner.
  expect((await patch(b.spaceId)).body.data).toEqual({ id: conversationId, space_id: b.spaceId });
  const changed = await dbGet('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  expect((await patch(b.spaceId)).status).toBe(200);
  expect(await dbGet('SELECT * FROM conversations WHERE id = ?', [conversationId])).toEqual(changed);
  expect(await dbGet('SELECT * FROM files WHERE id = ?', [oldFile.id])).toEqual(oldFile);
  expect(await dbAll('SELECT * FROM messages WHERE conversation_id = ?', [conversationId])).toEqual(messages);
  expect(await dbAll('SELECT * FROM conversation_participants WHERE conversation_id = ?', [conversationId])).toEqual(participants);
  expect((await request(app).get(oldFile.url)).status).toBe(401);
  expect((await request(app).get(oldFile.url).auth(token(b.userId), { type: 'bearer' })).status).toBe(403);
  expect((await request(app).get(oldFile.url).auth(token(a.userId), { type: 'bearer' })).status).toBe(200);
  const newFile = await upload();
  expect(newFile.space_id).toBe(b.spaceId);
  expect(newFile.id).not.toBe(oldFile.id);
  expect((await request(app).get(newFile.url).auth(token(b.userId), { type: 'bearer' })).status).toBe(200);
});
