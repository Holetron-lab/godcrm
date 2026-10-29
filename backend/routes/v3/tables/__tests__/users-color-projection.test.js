// GET /api/v3/users must return `color` — the chat stripe / mention pill accent.
//
// server.js mounts tablesRoutesV3 at /api/v3 (line ~335) BEFORE agentUsersRoutesV3 at
// /api/v3/users (line ~352), so the handler that actually serves GET /users is the one
// in tableCreateController.js. Its projection carried agent_color but omitted u.color,
// while the shadowed agent-users.js handler already exposed COALESCE(agent, user).
// Result: a human saved a profile color, the picker showed it, the message stripe stayed
// on the #3b82f6 default (frontend reads user.color || user.agent_color).
//
// DB-backed (godcrm_test, ADR-0009): mounts both routers in the same order as server.js
// so the assertion holds for the handler that is effectively served.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbRun } from '../../../../database/connection.js';
import { generateBaseId } from '../../../../utils/baseId.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import tablesRouter from '../index.js';
import agentUsersRouter from '../../agent-users.js';

const HUMAN_COLOR = '#a855f7';
const AGENT_COLOR = '#22c55e';
const AGENT_ICON = '🤖';

const app = express();
app.use(express.json());
let currentUser = null;
app.use((req, _res, next) => { req.user = currentUser; next(); });
app.use('/api/v3', tablesRouter);
app.use('/api/v3/users', agentUsersRouter);

let ws;
let agentRowId;
let agentUserId;

beforeAll(async () => {
  ws = await createEphemeralWorkspace({ label: 'users-color', dashboard: false });
  currentUser = { id: ws.userId, email: ws.email, role: 'owner' };

  // Human: saved profile color + an oversized avatar (the existing >2048 filter must survive).
  await dbRun('UPDATE users SET color = ?, avatar = ? WHERE id = ?',
    [HUMAN_COLOR, 'x'.repeat(3000), ws.userId]);

  // Agent: color/icon live on the agent row, not on users.
  const row = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
    [ws.tableId, generateBaseId(), JSON.stringify({ color: AGENT_COLOR, icon: AGENT_ICON }), ws.userId]
  );
  agentRowId = row.lastInsertRowid;
  const agent = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified,
                        user_type, managed_by_agent_table_id, managed_by_agent_row_id)
     VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)`,
    [`agent-${ws.token}@test.godcrm.local`, 'test-hash', `Test agent ${ws.token}`, 'test-encrypted-key', 1,
      ws.tableId, agentRowId]
  );
  agentUserId = agent.lastInsertRowid;
});

afterAll(async () => {
  if (agentUserId) await dbRun('DELETE FROM users WHERE id = ?', [agentUserId]);
  if (agentRowId) await dbRun('DELETE FROM table_rows WHERE id = ?', [agentRowId]);
  await ws.cleanup();
});

describe('GET /api/v3/users — color projection (effective router order)', () => {
  it('returns the saved profile color for a human and keeps the avatar-size filter', async () => {
    const res = await request(app).get('/api/v3/users');
    expect(res.status).toBe(200);
    const human = res.body.data.find((u) => u.id === ws.userId);
    expect(human).toBeDefined();
    expect(human.color).toBe(HUMAN_COLOR);
    expect(human.avatar).toBeNull();
    expect(human.user_type).toBe('human');
  });

  it('returns the agent row color as both color and agent_color for an agent user', async () => {
    const res = await request(app).get('/api/v3/users');
    const agent = res.body.data.find((u) => u.id === agentUserId);
    expect(agent).toBeDefined();
    expect(agent.user_type).toBe('agent');
    expect(agent.agent_color).toBe(AGENT_COLOR);
    expect(agent.agent_icon).toBe(AGENT_ICON);
    expect(agent.color).toBe(AGENT_COLOR);
    expect(agent.managed_by_agent_row_id).toBe(agentRowId);
  });
});
