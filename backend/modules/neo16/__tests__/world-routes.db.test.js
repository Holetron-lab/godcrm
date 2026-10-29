import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbGet, dbAll, dbRun, resetAdapter, destroyAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { installModule, uninstallModule } from '../../../services/ModuleInstaller.js';
import { NEO16_BLUEPRINT } from '../blueprint.js';
import router from '../routes.js';
import { Game } from '../engine/game.js';

const tenants = [];
const app = express();
app.use(express.json());
app.use('/api/v3/neo16', (req, _res, next) => {
  if (req.headers['x-test-user']) req.user = { id: Number(req.headers['x-test-user']) };
  next();
}, router);
const api = (t, method, path) => request(app)[method](`/api/v3/neo16${path}`).set('x-test-user', String(t.ws.userId));
const enter = (t) => api(t, 'post', '/worlds').send({ data: { widget_id: t.widgetId } });
const get = (t, id) => api(t, 'get', `/worlds/${id}`).query({ widget_id: t.widgetId });
const command = (t, id, body) => api(t, 'post', `/worlds/${id}/commands`).send({ data: { widget_id: t.widgetId, ...body } });
const dataOf = async (id) => (await dbGet('SELECT data FROM table_rows WHERE id = ?', [id])).data;

beforeAll(async () => {
  await resetAdapter();
  const target = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(target.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(target.host);
  for (const label of ['neo16-world-a', 'neo16-world-b']) {
    const ws = await createEphemeralWorkspace({ label, table: false, dashboard: false });
    const installed = await installModule({ blueprint: NEO16_BLUEPRINT, spaceId: ws.spaceId, projectId: ws.projectId, userId: ws.userId });
    tenants.push({ ws, mapping: installed.mapping, widgetId: installed.widgets[0].widget_id });
    // Verify actual provisioned schema before writing fixture content.
    const columns = await dbAll('SELECT column_name FROM table_columns WHERE table_id = ?', [installed.mapping.content.table_id]);
    const binding = { kind: 'agent_binding', content_key: 'evaluator', content_version: 1, title: 'rules', status: 'active', payload: { evaluator: 'rules' } };
    for (const field of Object.keys(binding)) expect(columns.map((c) => c.column_name)).toContain(field);
    await dbRun('INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
      [installed.mapping.content.table_id, `binding-${ws.token}`, JSON.stringify(binding), ws.userId]);
  }
}, 30_000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const { ws } of tenants) {
    await uninstallModule({ moduleKey: 'neo16', spaceId: ws.spaceId, purge: true, userId: ws.userId });
    await dbRun('DELETE FROM module_installations WHERE module_key = ? AND space_id = ?', ['neo16', ws.spaceId]);
    await dbRun('DELETE FROM widgets WHERE dashboard_id IN (SELECT id FROM dashboards WHERE space_id = ?)', [ws.spaceId]);
    await dbRun('DELETE FROM dashboards WHERE space_id = ?', [ws.spaceId]);
    await ws.cleanup();
  }
  await destroyAdapter();
}, 30_000);

describe('authorized learner world HTTP contract', () => {
  it('enters one durable world concurrently, exposes learner and NPC mapping; GET is read-only', async () => {
    const [a] = tenants;
    const results = await Promise.all([enter(a), enter(a), enter(a)]);
    for (const r of results) expect([200, 201]).toContain(r.status);
    const world = results[0].body.data;
    expect(new Set(results.map((r) => r.body.data.world_id)).size).toBe(1);
    expect(world.npcs.map((n) => n.npc_key)).toEqual(['nora', 'reed', 'casey']);
    expect(world.snapshot.world.players.find((p) => p.id === world.learner_player_id)).toMatchObject({ human: String(a.ws.userId) });
    for (const npc of world.npcs) expect(world.snapshot.world.players.some((p) => p.id === npc.player_id)).toBe(true);
    const before = await dataOf(world.world_id);
    expect((await get(a, world.world_id)).body.data).toEqual(world);
    expect(await dataOf(world.world_id)).toEqual(before);
    expect(JSON.stringify(world)).not.toMatch(/lease_token|execution|agentDescriptions|inProgressOperation/);
  });

  it('move is durable and idempotent; heartbeat advances via engine and reload restores the snapshot', async () => {
    const [a] = tenants;
    const initial = (await enter(a)).body.data;
    const move = { command: 'move', request_id: 'move-once', expected_version: initial.state_version, payload: { destination: { x: 4, y: 1 } } };
    const first = await command(a, initial.world_id, move);
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('applied');
    const after = await dataOf(initial.world_id);
    const duplicate = await command(a, initial.world_id, move);
    expect(duplicate.body.data).toEqual({ ...first.body.data, status: 'duplicate' });
    expect(await dataOf(initial.world_id)).toEqual(after);
    const mismatch = await command(a, initial.world_id, { ...move, payload: { destination: { x: 4, y: 2 } } });
    expect(mismatch.body.error.code).toBe('REQUEST_MISMATCH');
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 4000);
    try {
      const hb = await command(a, initial.world_id, { command: 'heartbeat', request_id: 'hb-once', expected_version: first.body.data.world.state_version, payload: {} });
      expect(hb.status).toBe(200);
      const world = hb.body.data.world;
      expect(world.snapshot.world.players.find((p) => p.id === world.learner_player_id).position.x).toBeGreaterThan(1);
      expect((await get(a, initial.world_id)).body.data).toEqual(world);
      const resumed = (await enter(a)).body.data;
      expect(resumed).toEqual(world);
    } finally { clock.mockRestore(); }
  });

  it('two tabs serialize: same version produces one command and a conflict; same id replays once', async () => {
    const [a] = tenants;
    const w = (await enter(a)).body.data;
    const base = { command: 'heartbeat', expected_version: w.state_version, payload: {} };
    const results = await Promise.all(['tab-a', 'tab-b'].map((request_id) => command(a, w.world_id, { ...base, request_id })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('VERSION_CONFLICT');
    const fresh = (await get(a, w.world_id)).body.data;
    const identical = { ...base, request_id: 'two-identical', expected_version: fresh.state_version };
    const duplicates = await Promise.all([command(a, w.world_id, identical), command(a, w.world_id, identical)]);
    expect(duplicates.map((r) => r.body.data.status).sort()).toEqual(['applied', 'duplicate']);
    expect((await get(a, w.world_id)).body.data.state_version).toBe(fresh.state_version + 1);
  });

  it('rejects foreign worlds even inside an authorized installation, foreign spaces, and forged actor/player/time', async () => {
    const [a, b] = tenants;
    const w = (await enter(a)).body.data;
    const bw = (await enter(b)).body.data;
    expect((await get(b, w.world_id)).status).toBe(404);
    expect((await api(b, 'get', `/worlds/${w.world_id}`).query({ widget_id: a.widgetId })).status).toBe(404);
    // Same installation, but a row owned by the other learner (no space-role shortcut).
    await dbRun(`UPDATE table_rows SET data = jsonb_set(data, '{owner_user_id}', ?::jsonb) WHERE id = ?`, [String(b.ws.userId), w.world_id]);
    try {
      expect((await get(a, w.world_id)).status).toBe(404);
      expect((await command(a, w.world_id, { command: 'heartbeat', request_id: 'foreign', expected_version: w.state_version, payload: {} })).status).toBe(404);
    } finally { await dbRun(`UPDATE table_rows SET data = jsonb_set(data, '{owner_user_id}', ?::jsonb) WHERE id = ?`, [String(a.ws.userId), w.world_id]); }
    expect((await request(app).get(`/api/v3/neo16/worlds/${bw.world_id}`).query({ widget_id: b.widgetId })).status).toBe(401);
    const base = { command: 'move', request_id: 'invalid', expected_version: w.state_version, payload: { destination: { x: 8, y: 6 } } };
    expect((await command(a, w.world_id, { ...base, user_id: b.ws.userId })).status).toBe(400);
    expect((await command(a, w.world_id, { ...base, payload: { player_id: 'p:1', destination: { x: 2, y: 2 } } })).status).toBe(400);
    expect((await command(a, w.world_id, { ...base, now: 9e15 })).status).toBe(400);
    expect((await command(a, w.world_id, base)).body.error.code).toBe('DESTINATION_BLOCKED');
    expect((await command(a, w.world_id, { ...base, payload: { destination: { x: 100, y: 100 } } })).status).toBe(422);
  });

  it('rolls back both receipt and world on a simulation failure, then retries the same request safely', async () => {
    const [a] = tenants;
    const w = (await enter(a)).body.data;
    const before = await dataOf(w.world_id);
    const body = { command: 'heartbeat', request_id: 'crash-retry', expected_version: w.state_version, payload: {} };
    const tick = vi.spyOn(Game.prototype, 'tick').mockImplementationOnce(() => { throw new Error('simulated crash after receipt insert'); });
    try { expect((await command(a, w.world_id, body)).status).toBe(500); }
    finally { tick.mockRestore(); }
    expect(await dataOf(w.world_id)).toEqual(before);
    expect(await dbAll("SELECT id FROM table_rows WHERE table_id = ? AND data->>'request_id' = ?", [a.mapping.turns.table_id, 'crash-retry'])).toHaveLength(0);
    expect((await command(a, w.world_id, body)).body.data.status).toBe('applied');
  });

  it('caps catch-up after a day offline and immediately processes new movement in logical time', async () => {
    const [a] = tenants;
    const before = (await enter(a)).body.data;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86400_000);
    try {
      const body = { command: 'move', request_id: 'after-long-offline', expected_version: before.state_version, payload: { destination: { x: 6, y: 1 } } };
      const r = await command(a, before.world_id, body);
      expect(r.status).toBe(200);
      expect(r.body.data.world.simulated_at - before.simulated_at).toBeLessThanOrEqual(1000);
      const learner = r.body.data.world.snapshot.world.players.find((p) => p.id === before.learner_player_id);
      expect(learner.pathfinding.destination).toEqual({ x: 6, y: 1 });
      const immediately = await command(a, before.world_id, { ...body, command: 'heartbeat', request_id: 'same-clock', expected_version: r.body.data.world.state_version, payload: {} });
      expect(immediately.body.data.world.simulated_at).toBe(r.body.data.world.simulated_at);
    } finally { clock.mockRestore(); }
  });

  it('adds a missing learner to an existing world without resetting NPC position or session progress', async () => {
    const [b] = tenants;
    const w = (await enter(b)).body.data;
    const saved = await dataOf(w.world_id);
    saved.snapshot.world.players = saved.snapshot.world.players.filter((p) => p.id !== w.learner_player_id);
    saved.snapshot.playerDescriptions = saved.snapshot.playerDescriptions.filter((p) => p.playerId !== w.learner_player_id);
    saved.snapshot.world.players[0].position = { x: 4, y: 4 };
    await dbRun('UPDATE table_rows SET data = ?::jsonb WHERE id = ?', [JSON.stringify(saved), w.world_id]);
    const repaired = (await enter(b)).body.data;
    expect(repaired.world_id).toBe(w.world_id);
    expect(repaired.snapshot.world.players.filter((p) => p.human)).toHaveLength(1);
    expect(repaired.snapshot.world.players[0].position).toEqual({ x: 4, y: 4 });
    expect(repaired.state_version).toBe(w.state_version + 1);
  });

  it('quest shares the same world; dialogue and XP survive movement, heartbeat, and reload', async () => {
    const [b] = tenants;
    const world = (await enter(b)).body.data;
    const start = await api(b, 'post', '/sessions').send({ data: { widget_id: b.widgetId, command: 'start_session', payload: { quest_key: 'arrange_meeting', content_version: 1 } } });
    expect(start.body.data.world_id).toBe(world.world_id);
    const id = start.body.data.session_id;
    for (const [i, npc_key, text] of [[0, 'nora', 'When is she free?'], [1, 'nora', 'Where should I meet her?'], [2, 'reed', 'Thursday at two in Lab B works for me.']]) {
      const r = await api(b, 'post', `/sessions/${id}/commands`).send({ data: { widget_id: b.widgetId, command: 'say', request_id: `quest-${i}`, expected_version: i, payload: { npc_key, text } } });
      expect(r.status).toBe(200);
    }
    const hb = await command(b, world.world_id, { command: 'heartbeat', request_id: 'after-quest', expected_version: world.state_version, payload: {} });
    expect(hb.status).toBe(200);
    const state = await api(b, 'get', `/sessions/${id}/state`).query({ widget_id: b.widgetId });
    expect(state.body.data.progress).toMatchObject({ status: 'completed', xp: 50 });
    expect(state.body.data.turns).toHaveLength(3);
    expect((await get(b, world.world_id)).body.data).toEqual(hb.body.data.world);
  });
});
