// @vitest-environment node
import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { dbGet, dbAll, dbRun } from '../database/connection.js';
import { createEphemeralWorkspace } from './helpers/workspace-fixture.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-runtime-upload-'));
const marker = path.basename(root);
const source = path.join(root, 'probe.txt');
const bytes = 'private upload regression probe';
const previousUploadPath = process.env.UPLOAD_PATH;
let owner, outsider, conversationId, jobId, context, handlers, app;
const rows = () => dbAll('SELECT * FROM files WHERE description = ?', [marker]);
const upload = (args = {}, runtime = context) => handlers.upload_file({
  source, space_id: owner.spaceId, visibility: 'private', description: marker, ...args,
}, 1, runtime);

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  process.env.UPLOAD_PATH = root;
  fs.writeFileSync(source, bytes);
  owner = await createEphemeralWorkspace({ label: 'mcp-owner', type: 'personal', dashboard: false });
  outsider = await createEphemeralWorkspace({ label: 'mcp-outsider', dashboard: false });
  conversationId = (await dbRun("INSERT INTO conversations (type,title,space_id,created_by) VALUES ('group',?,?,?)", [marker, owner.spaceId, owner.userId])).lastInsertRowid;
  await dbRun("INSERT INTO conversation_participants (conversation_id,user_id,role) VALUES (?,?,'admin'),(?,?,'member')", [conversationId, owner.userId, conversationId, outsider.userId]);
  jobId = (await dbRun("INSERT INTO agent_jobs (conversation_id,agent_row_id,agent_user_id,trigger_user_id,status) VALUES (?,?,?,?,'processing')", [conversationId, owner.tableId, outsider.userId, owner.userId])).lastInsertRowid;
  context = { source: 'mcp', jobId, agentId: owner.tableId, spaceId: owner.spaceId };
  ({ fileToolHandlers: handlers } = await import('../services/agent-tools/file-tools.js'));
  const { uploadsFileGuard } = await import('../middleware/fileGuard.js');
  app = express();
  app.use('/uploads', uploadsFileGuard, express.static(root));
});
beforeEach(async () => {
  await dbRun("UPDATE agent_jobs SET status='processing', trigger_user_id=? WHERE id=?", [owner.userId, jobId]);
  await dbRun('UPDATE conversations SET space_id=? WHERE id=?', [owner.spaceId, conversationId]);
});
afterEach(async () => { await dbRun('DELETE FROM files WHERE description=?', [marker]); });
afterAll(async () => {
  if (jobId) await dbRun('DELETE FROM agent_jobs WHERE id=?', [jobId]);
  if (conversationId) {
    await dbRun('DELETE FROM conversation_participants WHERE conversation_id=?', [conversationId]);
    await dbRun('DELETE FROM conversations WHERE id=?', [conversationId]);
  }
  await owner?.cleanup(); await outsider?.cleanup();
  if (previousUploadPath === undefined) delete process.env.UPLOAD_PATH;
  else process.env.UPLOAD_PATH = previousUploadPath;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('MCP uploads use the runtime-bound human initiator', () => {
  test('uploads privately for the owner; owner gets bytes, outsider and anonymous do not', async () => {
    const result = await upload();
    expect(result.success).toBe(true);
    const [file] = await rows();
    expect(file.space_id).toBe(owner.spaceId);
    expect(file.uploaded_by).toBe(owner.userId);
    expect(file.visibility).toBe('private');
    const token = id => jwt.sign({ id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1m' });
    expect((await request(app).get(result.url)).status).toBe(401);
    expect((await request(app).get(result.url).auth(token(outsider.userId), { type: 'bearer' })).status).toBe(403);
    const res = await request(app).get(result.url).auth(token(owner.userId), { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.text).toBe(bytes);
  });
  test.each(['completed', 'failed', 'pending'])('refuses a %s job before creating a file', async status => {
    await dbRun('UPDATE agent_jobs SET status=? WHERE id=?', [status, jobId]);
    expect((await upload()).error).toBeTruthy();
    expect(await rows()).toEqual([]);
  });
  test.each(['jobId', 'agentId', 'spaceId'])('refuses missing or mismatched runtime %s', async key => {
    for (const value of [undefined, -1, 2147483647]) {
      expect((await upload({}, { ...context, [key]: value })).error).toBeTruthy();
    }
    expect(await rows()).toEqual([]);
  });
  test('does not let tool arguments supply job identity', async () => {
    expect((await upload({ ...context, user_id: owner.userId }, { source: 'mcp' })).error).toBeTruthy();
    expect(await rows()).toEqual([]);
  });
  test('refuses a moved conversation with stale runtime space', async () => {
    await dbRun('UPDATE conversations SET space_id=? WHERE id=?', [outsider.spaceId, conversationId]);
    expect((await upload()).error).toBeTruthy();
    expect(await rows()).toEqual([]);
  });
  test('checks initiator permissions instead of impersonating the space owner', async () => {
    await dbRun('UPDATE agent_jobs SET trigger_user_id=? WHERE id=?', [outsider.userId, jobId]);
    expect((await upload()).error).toBeTruthy();
    expect(await rows()).toEqual([]);
  });
  test('requires the initiator to remain a conversation participant', async () => {
    await dbRun('DELETE FROM conversation_participants WHERE conversation_id=? AND user_id=?', [conversationId, owner.userId]);
    try {
      expect((await upload()).error).toBeTruthy();
      expect(await rows()).toEqual([]);
    } finally {
      await dbRun("INSERT INTO conversation_participants (conversation_id,user_id,role) VALUES (?,?,'admin')", [conversationId, owner.userId]);
    }
  });
  test('requires the agent to remain a conversation participant', async () => {
    await dbRun('DELETE FROM conversation_participants WHERE conversation_id=? AND user_id=?', [conversationId, outsider.userId]);
    try {
      expect((await upload()).error).toBeTruthy();
      expect(await rows()).toEqual([]);
    } finally {
      await dbRun("INSERT INTO conversation_participants (conversation_id,user_id,role) VALUES (?,?,'member')", [conversationId, outsider.userId]);
    }
  });
  test('does not delegate human authority from an agent initiator', async () => {
    await dbRun("UPDATE users SET user_type='agent' WHERE id=?", [owner.userId]);
    try {
      expect((await upload()).error).toBeTruthy();
      expect(await rows()).toEqual([]);
    } finally {
      await dbRun("UPDATE users SET user_type='human' WHERE id=?", [owner.userId]);
    }
  });
  test('cannot upload outside the job space even when the human owns both spaces', async () => {
    await dbRun('UPDATE spaces SET owner_id=? WHERE id=?', [owner.userId, outsider.spaceId]);
    try {
      expect((await upload({ space_id: outsider.spaceId })).error).toBeTruthy();
      expect(await rows()).toEqual([]);
    } finally {
      await dbRun('UPDATE spaces SET owner_id=? WHERE id=?', [outsider.userId, outsider.spaceId]);
    }
  });
  test('cannot bypass scope by omitting it or selecting another space', async () => {
    for (const space_id of [undefined, outsider.spaceId]) expect((await upload({ space_id })).error).toBeTruthy();
    expect(await rows()).toEqual([]);
  });
  test('derives the same space from the project without losing privacy', async () => {
    expect((await upload({ space_id: undefined, project_id: owner.projectId })).success).toBe(true);
    expect((await rows())[0].space_id).toBe(owner.spaceId);
  });
});
