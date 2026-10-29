// Bugs 1552/228712: real uploader -> metadata -> private file delivery.
import { beforeAll, afterAll, afterEach, describe, test, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { dbGet, dbAll, dbRun } from '../database/connection.js';
import { createEphemeralWorkspace } from './helpers/workspace-fixture.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-scope-'));
process.env.UPLOAD_PATH = root;
const marker = `wp4-scope-${Date.now()}`;
const source = path.join(root, 'source.png');
fs.writeFileSync(source, 'screenshot');
let ws, stranger, app, columnId, otherColumnId, rowId, actor, handlers;
const post = (fields) => {
  const r = request(app).post('/api/v3/files/upload').field('description', marker);
  for (const [key, value] of Object.entries(fields)) r.field(key, String(value));
  return r.attach('files', Buffer.from('screenshot'), 'screen.png');
};
const rows = () => dbAll('SELECT * FROM files WHERE description = ?', [marker]);

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  ws = await createEphemeralWorkspace({ label: 'wp4-upload', dashboard: false });
  stranger = await createEphemeralWorkspace({ label: 'wp4-stranger', dashboard: false });
  columnId = (await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type) VALUES (?, 'images', 'Screenshots', 'image')", [ws.tableId])).lastInsertRowid;
  otherColumnId = (await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type) VALUES (?, 'images', 'Screenshots', 'image')", [stranger.tableId])).lastInsertRowid;
  rowId = (await dbRun("INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, '{}')", [ws.tableId, ws.token])).lastInsertRowid;
  actor = { id: ws.userId, role: 'user' };
  const { default: router } = await import('../routes/v3/files.js');
  const { uploadsFileGuard } = await import('../middleware/fileGuard.js');
  ({ fileToolHandlers: handlers } = await import('../services/agent-tools/file-tools.js'));
  app = express();
  app.use('/uploads', uploadsFileGuard, express.static(root));
  app.use('/api/v3', (req, _res, next) => { req.user = actor; next(); }, router);
});
afterEach(async () => {
  await dbRun('DELETE FROM files WHERE description = ?', [marker]);
  actor = { id: ws.userId, role: 'user' };
});
afterAll(async () => {
  await dbRun('DELETE FROM table_columns WHERE id IN (?, ?)', [columnId, otherColumnId]);
  await ws?.cleanup(); await stranger?.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('REST upload scope', () => {
  test.each(['projectId', 'tableId', 'columnId', 'rowId'])('derives space from %s and serves private bytes only to a member', async (key) => {
    const res = await post({ [key]: { projectId: ws.projectId, tableId: ws.tableId, columnId, rowId }[key], visibility: 'private' });
    expect(res.status).toBe(200);
    const [file] = await rows();
    expect(Number(file.space_id)).toBe(ws.spaceId);
    expect(file.url).toMatch(new RegExp(`^/uploads/spaces/${ws.spaceId}/`));
    const token = (id) => jwt.sign({ id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1m' });
    expect((await request(app).get(file.url)).status).toBe(401);
    expect((await request(app).get(file.url).auth(token(stranger.userId), { type: 'bearer' })).status).toBe(403);
    expect((await request(app).get(file.url).auth(token(ws.userId), { type: 'bearer' })).status).toBe(200);
  });
  test.each(['spaceId', 'projectId', 'columnId', 'rowId', 'invalidId'])('rejects inconsistent or invalid %s without registering files', async (key) => {
    const fields = { tableId: ws.tableId };
    if (key === 'spaceId') fields.spaceId = stranger.spaceId;
    if (key === 'projectId') fields.projectId = stranger.projectId;
    if (key === 'columnId') fields.columnId = otherColumnId;
    if (key === 'rowId') { fields.rowId = rowId; fields.tableId = stranger.tableId; }
    if (key === 'invalidId') fields.spaceId = '../../outside';
    const res = await post(fields);
    expect(res.status).toBe(400);
    expect(await rows()).toEqual([]);
    expect(fs.readdirSync(path.join(root, '.temp'))).toEqual([]);
  });
  test('rejects a nonexistent table', async () => {
    expect((await post({ tableId: 2147483647 })).status).toBe(400);
    expect(await rows()).toEqual([]);
  });
  test('refuses uploads into a foreign project', async () => {
    expect((await post({ projectId: stranger.projectId })).status).toBe(403);
    expect(await rows()).toEqual([]);
  });
});

describe('MCP upload scope', () => {
  test('derives project space and keeps the URL relative', async () => {
    const res = await handlers.upload_file({ source, project_id: ws.projectId, description: marker }, ws.userId);
    expect(res.success).toBe(true);
    expect((await rows())[0].space_id).toBe(ws.spaceId);
    expect(res.url).toMatch(/^\/uploads\//);
  });
  test('rejects a forged space/project pair', async () => {
    const res = await handlers.upload_file({ source, project_id: ws.projectId, space_id: stranger.spaceId, description: marker }, ws.userId);
    expect(res.error).toBeTruthy();
    expect(await rows()).toEqual([]);
  });
  test('refuses a foreign project', async () => {
    const res = await handlers.upload_file({ source, project_id: stranger.projectId, description: marker }, ws.userId);
    expect(res.error).toBeTruthy();
    expect(await rows()).toEqual([]);
  });
});
