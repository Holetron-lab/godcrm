// Neo16 W0 — integration: the ported engine persisted in ordinary CRM tables on
// godcrm_test. Every write goes through table_rows of tables provisioned by
// ModuleTableProvisioner in an ephemeral project; nothing touches a master.
//
// Verifies the W0 acceptance from doc 239900: one NPC command, durable
// save/restore without Convex, restore equals an uninterrupted run, duplicate
// request handling, and that rows are visible as plain CRM table data.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbGet, dbAll, dbRun, resetAdapter, destroyAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import {
  provisionNeo16Tables, createWorld, loadWorld, listTurns, enqueueInput, stepWorld, NEO16_W0_BLUEPRINT,
} from '../store/crmWorldStore.js';
import { Game, runStep } from '../engine/game.js';
import { makeState, NPC_PLAYER_ID, EAST_SIDE } from './fixtures.js';

const T0 = 1_700_000_000_000;
const STEP = 2_000;
const noRandom = () => 0.5;
const SLOW = 20_000;

let ws;
let mapping;

beforeAll(async () => {
  await resetAdapter();
  // Doc 239900 §Verification: confirm the actual target before any write.
  const db = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(db.db).toMatch(/_test$/);
  expect([null, '127.0.0.1', '::1']).toContain(db.host);

  ws = await createEphemeralWorkspace({ label: 'neo16-w0', table: false, dashboard: false });
  mapping = await provisionNeo16Tables(ws.projectId, { userId: ws.userId });
}, SLOW);

afterAll(async () => {
  if (mapping) {
    for (const t of Object.values(mapping)) {
      await dbRun('DELETE FROM table_rows WHERE table_id = ?', [t.table_id]);
    }
  }
  await ws?.cleanup(); // deletes universal_tables of the project, project, space, user
  await destroyAdapter();
}, SLOW);

async function seedWorld(key) {
  const { worldRowId } = await createWorld(mapping, {
    worldKey: key, ownerUserId: ws.userId, state: makeState(), userId: ws.userId,
  });
  return worldRowId;
}

describe('Neo16 W0 — CRM tables as the durable world store (godcrm_test)', () => {
  it('provisions ordinary universal tables in the project, no bespoke schema', async () => {
    const expected = NEO16_W0_BLUEPRINT.tables.map((t) => t.name).sort();
    expect(Object.keys(mapping).sort()).toEqual(NEO16_W0_BLUEPRINT.tables.map((t) => t.key).sort());
    const tables = await dbAll(
      `SELECT id, name, table_type FROM universal_tables WHERE project_id = ? AND name LIKE 'neo16_%' ORDER BY name`,
      [ws.projectId],
    );
    expect(tables.map((t) => t.name)).toEqual(expected);
    const cols = await dbAll('SELECT column_name FROM table_columns WHERE table_id = ? ORDER BY order_index', [mapping.worlds.table_id]);
    expect(cols.map((c) => c.column_name)).toEqual(NEO16_W0_BLUEPRINT.tables[0].columns.map((c) => c.column_name));
    // idempotent re-provision reuses, never duplicates
    const again = await provisionNeo16Tables(ws.projectId, { userId: ws.userId });
    expect(again.worlds.table_id).toBe(mapping.worlds.table_id);
    expect(again.worlds.created).toBe(false);
  }, SLOW);

  it('one NPC command: enqueue moveTo → step → NPC moved, turn applied, snapshot saved', async () => {
    const worldId = await seedWorld('w0-move');
    const q = await enqueueInput(mapping, {
      worldRowId: worldId, requestId: 'req-1', name: 'moveTo',
      args: { playerId: NPC_PLAYER_ID, destination: EAST_SIDE }, receivedTs: T0, userId: ws.userId,
    });
    expect(q.duplicate).toBe(false);
    expect(q.inputNumber).toBe(0);

    const s1 = await stepWorld(mapping, worldId, T0, { random: noRandom });
    expect(s1.stateVersion).toBe(1);
    expect(s1.completedInputs).toEqual([{ inputId: q.turnRowId, returnValue: { kind: 'ok', value: null } }]);

    const s2 = await stepWorld(mapping, worldId, T0 + STEP, { random: noRandom });
    expect(s2.stateVersion).toBe(2);
    expect(s2.completedInputs).toEqual([]); // consumed exactly once

    const world = await loadWorld(mapping, worldId);
    const npc = world.data.snapshot.world.players.find((p) => p.id === NPC_PLAYER_ID);
    expect(npc.position).not.toEqual({ x: 2, y: 2 });
    expect(npc.pathfinding?.state.kind).toBe('moving');
    expect(world.data.state_version).toBe(2);
    expect(world.data.current_time).toBe(s2.simulated.to);
    expect(world.data.next_input_number).toBe(1);

    const turns = await listTurns(mapping, worldId);
    expect(turns).toHaveLength(1);
    expect(turns[0].data).toMatchObject({
      request_id: 'req-1', input_name: 'moveTo', processing_status: 'applied', applied_version: 1,
      result: { kind: 'ok', value: null },
    });
  }, SLOW);

  it('restore from CRM rows and continue → identical to an uninterrupted in-memory run', async () => {
    const worldId = await seedWorld('w0-restore');
    await enqueueInput(mapping, {
      worldRowId: worldId, requestId: 'req-1', name: 'moveTo',
      args: { playerId: NPC_PLAYER_ID, destination: EAST_SIDE }, receivedTs: T0, userId: ws.userId,
    });
    // 20 steps, each a separate transaction: every step restores from the row and persists back.
    for (let i = 0; i < 20; i++) {
      await stepWorld(mapping, worldId, T0 + i * STEP, { random: noRandom });
    }
    const world = await loadWorld(mapping, worldId);

    const reference = new Game(makeState(), { random: noRandom });
    let eng = { generationNumber: 0 };
    for (let i = 0; i < 20; i++) {
      const inputs = i === 0
        ? [{ id: 'x', number: 0, name: 'moveTo', args: { playerId: NPC_PLAYER_ID, destination: EAST_SIDE }, received: T0 }]
        : [];
      eng = runStep(reference, eng, T0 + i * STEP, inputs).engine;
    }

    expect(world.data.snapshot).toEqual(reference.serialize());
    expect(world.data.state_version).toBe(eng.generationNumber);
    expect(world.data.current_time).toBe(eng.currentTime);
    expect(world.data.processed_input_number).toBe(0);
    const npc = world.data.snapshot.world.players.find((p) => p.id === NPC_PLAYER_ID);
    expect(npc.position).toEqual(EAST_SIDE);
  }, SLOW);

  it('a replayed request_id is a no-op; the same id with another payload is rejected', async () => {
    const worldId = await seedWorld('w0-idem');
    const first = await enqueueInput(mapping, {
      worldRowId: worldId, requestId: 'dup', name: 'moveTo',
      args: { playerId: NPC_PLAYER_ID, destination: EAST_SIDE }, receivedTs: T0,
    });
    const replay = await enqueueInput(mapping, {
      worldRowId: worldId, requestId: 'dup', name: 'moveTo',
      args: { playerId: NPC_PLAYER_ID, destination: EAST_SIDE }, receivedTs: T0 + 1,
    });
    expect(replay).toEqual({ ...first, duplicate: true });
    await expect(enqueueInput(mapping, {
      worldRowId: worldId, requestId: 'dup', name: 'moveTo',
      args: { playerId: NPC_PLAYER_ID, destination: { x: 1, y: 1 } }, receivedTs: T0,
    })).rejects.toThrow(/different payload/);
    expect(await listTurns(mapping, worldId)).toHaveLength(1);
  }, SLOW);

  it('two concurrent steps on one world serialize through the row lock, no lost update', async () => {
    const worldId = await seedWorld('w0-race');
    const results = await Promise.allSettled([
      stepWorld(mapping, worldId, T0, { random: noRandom }),
      stepWorld(mapping, worldId, T0 + STEP, { random: noRandom }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const versions = results.map((r) => r.value.stateVersion).sort();
    expect(versions).toEqual([1, 2]);
    const world = await loadWorld(mapping, worldId);
    expect(world.data.state_version).toBe(2);
  }, SLOW);

  it('rows are plain CRM table data: readable with the generic table_rows shape', async () => {
    const worldId = await seedWorld('w0-visible');
    const raw = await dbGet('SELECT table_id, base_id, data, created_by FROM table_rows WHERE id = ?', [worldId]);
    expect(raw.table_id).toBe(mapping.worlds.table_id);
    expect(raw.base_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(raw.created_by)).toBe(Number(ws.userId));
    const data = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data;
    expect(data.world_key).toBe('w0-visible');
    expect(data.snapshot.world.players).toHaveLength(1);
  }, SLOW);
});
