// Authenticated boundary over the ported world store. No browser actor, player,
// table mapping or wall clock is trusted. All mutations use learner → world locks.
import { z } from 'zod';
import { dbGet, withTransactionAsync } from '../../../database/connection.js';
import { QuestError } from '../learning/questService.js';
import { enqueueInput, stepWorld, requestHash } from './crmWorldStore.js';
import { TOWN_NPCS } from '../content/town.js';

export const WorldCommand = z.discriminatedUnion('command', [
  z.object({ command: z.literal('move'), payload: z.object({
    destination: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict().nullable(),
  }).strict() }),
  z.object({ command: z.literal('heartbeat'), payload: z.object({}).strict() }),
]);
const Identity = z.object({ userId: z.number().int().positive(), worldRowId: z.number().int().positive() });
const Receipt = z.object({ requestId: z.string().min(1).max(128), expectedVersion: z.number().int().nonnegative() });
const parse = (data) => typeof data === 'string' ? JSON.parse(data) : data;

async function ownedWorld(mapping, { userId, worldRowId }, trx = null) {
  Identity.parse({ userId, worldRowId });
  const row = await (trx ? trx.get : dbGet)(
    `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ? ${trx ? 'FOR UPDATE' : ''}`,
    [worldRowId, mapping.worlds.table_id],
  );
  const data = row ? parse(row.data) : null;
  if (!data || Number(data.owner_user_id) !== userId) throw new QuestError('world not found', 'WORLD_NOT_FOUND', 404);
  return { id: row.id, data };
}

/** Explicit public projection: no operation state, agent persona, receipts or learning text. */
function publicWorld({ id, data }, userId) {
  const { snapshot } = data;
  const learner = snapshot.world.players.find((p) => p.human === String(userId));
  if (!learner) throw new QuestError('enter world to create learner', 'WORLD_NOT_READY', 409);
  return {
    world_id: id, state_version: data.state_version, simulated_at: data.current_time,
    learner_player_id: learner.id,
    npcs: TOWN_NPCS.filter((n) => snapshot.world.players.some((p) => p.id === n.playerId))
      .map((n) => ({ npc_key: n.key, player_id: n.playerId, name: n.name })),
    snapshot: {
      worldMap: snapshot.worldMap,
      playerDescriptions: snapshot.playerDescriptions,
      world: {
        players: snapshot.world.players.map(({ id, human, position, facing, speed, pathfinding, activity }) =>
          ({ id, human, position, facing, speed, pathfinding, activity })),
        agents: snapshot.world.agents.map(({ id, playerId }) => ({ id, playerId })),
      },
    },
  };
}

export async function getWorldSnapshot(mapping, identity) {
  return publicWorld(await ownedWorld(mapping, identity), identity.userId);
}

export async function applyWorldCommand(mapping, input, { now = Date.now, random } = {}) {
  const identity = Identity.parse(input);
  const { requestId, expectedVersion } = Receipt.parse(input);
  const { command, payload } = WorldCommand.parse(input);
  return withTransactionAsync(async (trx) => {
    await trx.run('SELECT pg_advisory_xact_lock(hashtext(?))', [`neo16:learner:${identity.userId}`]);
    const world = await ownedWorld(mapping, identity, trx);
    const { data } = world;
    const learner = data.snapshot.world.players.find((p) => p.human === String(identity.userId));
    if (!learner) throw new QuestError('enter world to create learner', 'WORLD_NOT_READY', 409);
    const name = command === 'move' ? 'moveTo' : 'heartbeat';
    const args = { playerId: learner.id, ...(command === 'move' ? { destination: payload.destination } : {}) };
    const hash = requestHash(name, args);
    const receipt = await trx.get(
      `SELECT data FROM table_rows WHERE table_id = ? AND data->>'world_id' = ?
       AND data->>'request_id' = ? AND data->>'session_id' IS NULL`,
      [mapping.turns.table_id, String(world.id), requestId],
    );
    if (receipt) {
      const saved = parse(receipt.data);
      if (saved.request_hash !== hash) throw new QuestError('request payload changed', 'REQUEST_MISMATCH', 409);
      if (saved.result?.world) return { ...saved.result, status: 'duplicate' };
    }
    if (data.status !== 'active') throw new QuestError('world is closed', 'WORLD_CLOSED', 409);
    if (data.state_version !== expectedVersion) throw new QuestError('world version changed', 'VERSION_CONFLICT', 409);
    if (payload.destination) {
      const { x, y } = payload.destination;
      const map = data.snapshot.worldMap;
      if (x >= map.width || y >= map.height || map.objectTiles.some((layer) => layer[x][y] !== -1)) {
        throw new QuestError('destination is blocked', 'DESTINATION_BLOCKED', 422);
      }
    }
    // Logical time advances at most one second per active-client step. Restarts
    // retain this clock, but never simulate hours of absence. Input is timestamped
    // in this clock, so a new command cannot wait behind a wall-clock backlog.
    const wallNow = now();
    const clock = data.current_time ?? wallNow;
    const previousHeartbeat = data.snapshot.runtime?.last_active_at ?? wallNow;
    const stepAt = clock + Math.min(1000, Math.max(0, wallNow - previousHeartbeat));
    const turn = await enqueueInput(mapping, { ...identity, requestId, name, args, receivedTs: clock, trx });
    const step = await stepWorld(mapping, world.id, stepAt, { trx, random });
    const completed = step.completedInputs.find((done) => done.inputId === turn.turnRowId);
    if (!completed || completed.returnValue.kind !== 'ok') throw new QuestError('world command could not apply', 'WORLD_COMMAND_FAILED', 409);
    const updated = await ownedWorld(mapping, identity, trx);
    updated.data.snapshot.runtime = { last_active_at: Math.max(wallNow, previousHeartbeat) };
    await trx.run('UPDATE table_rows SET data = data || ?::jsonb WHERE id = ?',
      [JSON.stringify({ snapshot: updated.data.snapshot }), world.id]);
    const result = { status: 'applied', request_id: requestId, world: publicWorld(updated, identity.userId) };
    await trx.run('UPDATE table_rows SET data = data || ?::jsonb WHERE id = ?',
      [JSON.stringify({ result }), turn.turnRowId]);
    return result;
  });
}
