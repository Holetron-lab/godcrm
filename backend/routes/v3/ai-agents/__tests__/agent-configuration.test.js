// @vitest-environment node
// PUT /api/v3/ai/agents/:agentId/configuration — atomic identity edit
// (conversation 3692, job 20596 handoff).
//
// The agent row (table_rows.data) and its passport (users row linked through
// managed_by_agent_row_id) carry the same identity twice: name in both, slug in
// the row and handle on the user. The legacy PUT /agents/:id writes only
// data.name, so a rename left the evoke directory stale and never touched the
// handle. This route changes both in one transaction and rolls the whole edit
// back on any uniqueness or permission failure.
//
// DB-backed (godcrm_test, ADR-0009): uniqueness is enforced with an advisory
// lock plus the real users_handle_lower_unique index, so the race case is run
// against PostgreSQL, not mocked.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbRun, dbGet, dbAll, toBool } from '../../../../database/connection.js';
import { generateBaseId } from '../../../../utils/baseId.js';
import { createEphemeralWorkspace, fixtureToken } from '../../../../tests/helpers/workspace-fixture.js';
import { resolveAgentUser } from '../../../../services/agent-users.js';
import agentCrudRouter from '../agentCrudController.js';

const app = express();
app.use(express.json());
let currentUser = null;
app.use((req, _res, next) => { req.user = currentUser; next(); });
app.use('/api/v3/ai', agentCrudRouter);

let ws;          // residence space; ws.userId becomes owner + global admin
let other;       // unrelated space owner with the default global role
let tableId;     // agents table inside ws
let relationColumnId;
const rowIds = {};
const extraUsers = [];
let t;

async function insertAgentRow(data) {
  const r = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
    [tableId, generateBaseId(), JSON.stringify({ status: 'active', ...data }), ws.userId]
  );
  return r.lastInsertRowid;
}

async function insertUser({ role = 'user', user_type = 'human', agentRowId = null, handle = null, name }) {
  const token = fixtureToken();
  const r = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified, role, user_type,
                        managed_by_agent_row_id, managed_by_agent_table_id, handle)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`test-agent-config-${token}@test.godcrm.local`, 'test-hash', name ?? `Cfg ${token}`, 'test-encrypted-key',
      toBool(true), role, user_type, agentRowId, agentRowId ? tableId : null, handle]
  );
  extraUsers.push(r.lastInsertRowid);
  return r.lastInsertRowid;
}

async function rowData(id) {
  const r = await dbGet('SELECT data FROM table_rows WHERE id = ?', [id]);
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
}

function put(id, data) {
  return request(app).put(`/api/v3/ai/agents/${id}/configuration`).send({ data });
}

beforeAll(async () => {
  ws = await createEphemeralWorkspace({ label: 'agent-config', dashboard: false, table: false });
  other = await createEphemeralWorkspace({ label: 'agent-config-other', dashboard: false, table: false });
  t = ws.token;
  // Space owner + global admin → passport authority (services/passportAuthority.js).
  await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [ws.userId]);
  currentUser = { id: ws.userId, email: ws.email, role: 'admin' };

  const tbl = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)',
    [ws.projectId, `Agents config ${t}`]);
  tableId = tbl.lastInsertRowid;
  const col = await dbRun(
    'INSERT INTO table_columns (table_id, column_name, type, config) VALUES (?, ?, ?, ?)',
    [tableId, 'operator_id', 'select', JSON.stringify({ relation: { enabled: true } })]
  );
  relationColumnId = col.lastInsertRowid;

  rowIds.issued = await insertAgentRow({ name: 'Fixture Reviewer', slug: `fx-rev-${t}`, agent_slug: `fx-rev-${t}`, color: '#111111' });
  rowIds.revoked = await insertAgentRow({ name: 'Revoked Agent', slug: `fx-revoked-${t}` });
  rowIds.plain = await insertAgentRow({ name: 'Plain Agent', slug: `fx-plain-${t}`, color: '#222222' });
  rowIds.taken = await insertAgentRow({ name: 'Taken Agent', agent_slug: `fx-taken-${t}` });
  rowIds.raceA = await insertAgentRow({ name: 'Race A', slug: `fx-race-a-${t}` });
  rowIds.raceB = await insertAgentRow({ name: 'Race B', slug: `fx-race-b-${t}` });

  await insertUser({ user_type: 'agent', agentRowId: rowIds.issued, handle: `fx-rev-${t}`, name: 'Fixture Reviewer' });
  await insertUser({ user_type: 'agent', agentRowId: rowIds.revoked, handle: null, name: 'Revoked Agent' });
  await insertUser({ handle: `fx-human-${t}`, name: 'Human With Handle' });
});

afterAll(async () => {
  await dbRun('DELETE FROM table_rows WHERE table_id = ?', [tableId]);
  await dbRun('DELETE FROM table_columns WHERE table_id = ?', [tableId]);
  for (const id of extraUsers) await dbRun('DELETE FROM users WHERE id = ?', [id]);
  await other?.cleanup();
  await ws?.cleanup();
});

describe('PUT /api/v3/ai/agents/:agentId/configuration — validation and authorization', () => {
  it('404 for an unknown agent row', async () => {
    const res = await put(999999999, { name: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('400 for blank name, malformed slug, missing data envelope and unknown keys', async () => {
    expect((await put(rowIds.plain, { name: '   ' })).status).toBe(400);
    expect((await put(rowIds.plain, { slug: 'Bad Slug!' })).status).toBe(400);
    expect((await put(rowIds.plain, { color: 'red' })).status).toBe(400);
    expect((await put(rowIds.plain, { system_prompt: 'nope' })).status).toBe(400);
    expect((await request(app).put(`/api/v3/ai/agents/${rowIds.plain}/configuration`).send({ name: 'x' })).status).toBe(400);
    expect((await put(rowIds.plain, {})).status).toBe(400);
    expect(await rowData(rowIds.plain)).toMatchObject({ name: 'Plain Agent', slug: `fx-plain-${t}`, color: '#222222' });
  });

  it('403 for an actor without admin access in the residence space, with no writes', async () => {
    currentUser = { id: other.userId, email: other.email, role: 'user' };
    try {
      const res = await put(rowIds.plain, { name: 'Hijacked', color: '#333333' });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(await rowData(rowIds.plain)).toMatchObject({ name: 'Plain Agent', color: '#222222' });
    } finally {
      currentUser = { id: ws.userId, email: ws.email, role: 'admin' };
    }
  });

  it('403 for a space admin without a global admin role when the agent holds a passport', async () => {
    await dbRun("UPDATE users SET role = 'user' WHERE id = ?", [ws.userId]);
    try {
      const res = await put(rowIds.issued, { name: 'Not allowed' });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/passport|global admin/i);
      expect((await rowData(rowIds.issued)).name).toBe('Fixture Reviewer');
    } finally {
      await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [ws.userId]);
    }
  });
});

describe('PUT /api/v3/ai/agents/:agentId/configuration — writes', () => {
  it('renames an agent without a passport: row updated, no user created', async () => {
    const res = await put(rowIds.plain, { name: 'Plain Renamed', slug: `fx-plain2-${t}`, color: '#abcdef' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: rowIds.plain, name: 'Plain Renamed', slug: `fx-plain2-${t}`, color: '#abcdef', passport: null });
    const data = await rowData(rowIds.plain);
    expect(data).toMatchObject({ name: 'Plain Renamed', slug: `fx-plain2-${t}`, color: '#abcdef', status: 'active' });
    expect(data.agent_slug).toBeUndefined();
    const users = await dbAll("SELECT id FROM users WHERE managed_by_agent_row_id = ? AND user_type = 'agent'", [rowIds.plain]);
    expect(users).toEqual([]);
  });

  it('renames an agent with an issued passport: row, users.name and handle move together', async () => {
    const before = await dbGet("SELECT id, email FROM users WHERE managed_by_agent_row_id = ?", [rowIds.issued]);
    const res = await put(rowIds.issued, { name: 'Reviewer Two', slug: `fx-rev2-${t}` });
    expect(res.status).toBe(200);
    expect(res.body.data.passport).toMatchObject({ user_id: before.id, handle: `fx-rev2-${t}` });

    const data = await rowData(rowIds.issued);
    expect(data).toMatchObject({ name: 'Reviewer Two', slug: `fx-rev2-${t}`, agent_slug: `fx-rev2-${t}`, color: '#111111' });

    const user = await dbGet('SELECT id, email, name, handle FROM users WHERE managed_by_agent_row_id = ?', [rowIds.issued]);
    expect(user).toMatchObject({ id: before.id, email: before.email, name: 'Reviewer Two', handle: `fx-rev2-${t}` });

    // Evoke readback: the new handle resolves pointer-first to the same passport.
    const resolved = await resolveAgentUser(`@fx-rev2-${t}`);
    expect(resolved).toMatchObject({ userId: before.id, agentRowId: rowIds.issued });
    expect(resolved.agentConfig.name).toBe('Reviewer Two');
    expect(await resolveAgentUser(`@fx-rev-${t}`)).toBeNull();

    // Directory payload consumed by mention evokes.
    const list = await request(app).get(`/api/v3/ai/agents/${ws.spaceId}?limit=200`).expect(200);
    const listed = list.body.data.agents.find(a => a.id === rowIds.issued);
    expect(listed).toMatchObject({ name: 'Reviewer Two', agent_slug: `fx-rev2-${t}` });
  });

  it('name-only edit keeps the handle and syncs users.name', async () => {
    const res = await put(rowIds.issued, { name: 'Reviewer Three' });
    expect(res.status).toBe(200);
    const user = await dbGet('SELECT name, handle FROM users WHERE managed_by_agent_row_id = ?', [rowIds.issued]);
    expect(user).toEqual({ name: 'Reviewer Three', handle: `fx-rev2-${t}` });
    expect((await rowData(rowIds.issued)).slug).toBe(`fx-rev2-${t}`);
  });

  it('never issues a passport implicitly: a revoked passport stays without a handle', async () => {
    const res = await put(rowIds.revoked, { name: 'Revoked Renamed', slug: `fx-revoked2-${t}` });
    expect(res.status).toBe(200);
    expect(res.body.data.passport).toMatchObject({ handle: null });
    const user = await dbGet('SELECT name, handle FROM users WHERE managed_by_agent_row_id = ?', [rowIds.revoked]);
    expect(user).toEqual({ name: 'Revoked Renamed', handle: null });
    expect((await rowData(rowIds.revoked)).slug).toBe(`fx-revoked2-${t}`);
  });

  it('409 on a slug already used in the same agents table — nothing else is written', async () => {
    const res = await put(rowIds.issued, { name: 'Should Not Land', color: '#999999', slug: `FX-TAKEN-${t}` });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(await rowData(rowIds.issued)).toMatchObject({ name: 'Reviewer Three', color: '#111111', slug: `fx-rev2-${t}` });
    const user = await dbGet('SELECT name, handle FROM users WHERE managed_by_agent_row_id = ?', [rowIds.issued]);
    expect(user).toEqual({ name: 'Reviewer Three', handle: `fx-rev2-${t}` });
  });

  it('409 on a slug held as a global handle by another user, without leaking that user', async () => {
    const holder = await dbGet('SELECT email FROM users WHERE handle = ?', [`fx-human-${t}`]);
    const res = await put(rowIds.plain, { slug: `fx-human-${t}`, color: '#444444' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain(holder.email);
    expect((await rowData(rowIds.plain)).color).toBe('#abcdef');
  });

  it('409 when a passport handle is taken by a user without a passport link (real unique index)', async () => {
    // The advisory lock serializes per agents table; the handle index is the global backstop.
    const res = await put(rowIds.issued, { slug: `fx-human-${t}` });
    expect(res.status).toBe(409);
    const user = await dbGet('SELECT handle FROM users WHERE managed_by_agent_row_id = ?', [rowIds.issued]);
    expect(user.handle).toBe(`fx-rev2-${t}`);
  });

  it('race: two agents renamed to the same slug concurrently → exactly one wins', async () => {
    const slug = `fx-race-${t}`;
    const [a, b] = await Promise.all([
      put(rowIds.raceA, { slug, name: 'Race A2' }),
      put(rowIds.raceB, { slug, name: 'Race B2' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winners = await dbAll(
      "SELECT id, data->>'name' AS name FROM table_rows WHERE table_id = ? AND lower(data->>'slug') = ?", [tableId, slug]
    );
    expect(winners).toHaveLength(1);
    const loser = winners[0].id === rowIds.raceA ? rowIds.raceB : rowIds.raceA;
    const loserData = await rowData(loser);
    expect(loserData.name).toMatch(/^Race [AB]$/);
  });

  it('persists relation settings and color in the same request', async () => {
    const operator = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
      [tableId, generateBaseId(), JSON.stringify({ name: 'Op' }), ws.userId]
    );
    const res = await put(rowIds.plain, { operator_id: operator.lastInsertRowid, color: '#0f0f0f', icon: '🦊', crm_instructions: 'be brief' });
    expect(res.status).toBe(200);
    const data = await rowData(rowIds.plain);
    expect(data).toMatchObject({ operator_id: operator.lastInsertRowid, color: '#0f0f0f', icon: '🦊', crm_instructions: 'be brief', name: 'Plain Renamed' });
    expect(data[String(relationColumnId)]).toBe(String(operator.lastInsertRowid));
  });
});
