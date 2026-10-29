/**
 * Profile colour — the accent picked next to the avatar in Settings.
 * Humans persist it on users.color; agent users write through to the agent
 * row's data.color so the space's Agents table shows the same colour.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRoutes from '../auth.js';
import { dbGet, dbRun } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';

const app = express();
app.use(express.json());
app.use('/api/v3/auth', authRoutes);

const bearer = (id) => `Bearer ${jwt.sign({ id, email: `u${id}@test.godcrm.local`, role: 'user' }, JWT_SECRET)}`;

describe('PATCH /auth/profile { color }', () => {
  let ws;
  let agentUserId;
  let agentRowId;

  beforeAll(async () => {
    ws = await createEphemeralWorkspace({ label: 'profile-color' });
    const row = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
      [ws.tableId, `pc-${ws.token}`, JSON.stringify({ name: 'Colour Agent', color: '#111111' })]
    );
    agentRowId = row.lastInsertRowid;
    const agent = await dbRun(
      `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified, user_type,
                          managed_by_agent_table_id, managed_by_agent_row_id)
       VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)`,
      [`agent-${ws.token}@test.godcrm.local`, 'x', 'Colour Agent', 'x', 1, ws.tableId, agentRowId]
    );
    agentUserId = agent.lastInsertRowid;
  });

  afterAll(async () => {
    await dbRun('DELETE FROM users WHERE id = ?', [agentUserId]);
    await dbRun('DELETE FROM table_rows WHERE id = ?', [agentRowId]);
    await ws.cleanup();
  });

  test('human: colour persists and comes back from GET /profile', async () => {
    await request(app).patch('/api/v3/auth/profile')
      .set('Authorization', bearer(ws.userId))
      .send({ color: '#3B82F6' })
      .expect(200);
    const res = await request(app).get('/api/v3/auth/profile')
      .set('Authorization', bearer(ws.userId))
      .expect(200);
    expect(res.body.data.color).toBe('#3b82f6');
  });

  test('human: null clears the colour', async () => {
    const res = await request(app).patch('/api/v3/auth/profile')
      .set('Authorization', bearer(ws.userId))
      .send({ color: null })
      .expect(200);
    expect(res.body.data.color).toBeNull();
  });

  test('rejects anything that is not #rrggbb', async () => {
    for (const color of ['red', '#fff', '#12345g', 'javascript:alert(1)', 42]) {
      const res = await request(app).patch('/api/v3/auth/profile')
        .set('Authorization', bearer(ws.userId))
        .send({ color })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_COLOR');
    }
  });

  test('agent: colour is written to the agent row, not to users.color', async () => {
    const res = await request(app).patch('/api/v3/auth/profile')
      .set('Authorization', bearer(agentUserId))
      .send({ color: '#22c55e' })
      .expect(200);
    expect(res.body.data.color).toBe('#22c55e');

    const row = await dbGet('SELECT data FROM table_rows WHERE id = ?', [agentRowId]);
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    expect(data.color).toBe('#22c55e');
    expect(data.name).toBe('Colour Agent');

    const user = await dbGet('SELECT color FROM users WHERE id = ?', [agentUserId]);
    expect(user.color).toBeNull();
  });

  test('agent: GET /profile reads the row colour', async () => {
    await dbRun(`UPDATE table_rows SET data = data || '{"color":"#ef4444"}'::jsonb WHERE id = ?`, [agentRowId]);
    const res = await request(app).get('/api/v3/auth/profile')
      .set('Authorization', bearer(agentUserId))
      .expect(200);
    expect(res.body.data.color).toBe('#ef4444');
  });
});
