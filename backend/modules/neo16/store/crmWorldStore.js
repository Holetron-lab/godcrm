// Neo16 W0 — CRM-owned durable store for the ported AI Town engine.
//
// Replaces the Convex boundary of AI Town (`worlds`/`engines`/`inputs` tables,
// `internal.aiTown.game.saveWorld`, scheduler) with ordinary CRM universal
// tables, so progress is visible in normal CRM table views and the browser
// never talks to PostgreSQL (architecture doc 239900 §Data Ownership).
//
// Two logical tables, provisioned through the existing ModuleTableProvisioner:
//   worlds (neo16_worlds) — one row per world: engine record + full snapshot.
//   turns  (neo16_turns)  — one row per accepted command (AI Town "input").
//
// Concurrency contract (doc 239900 §Runtime, steps 2/4): every writer locks the
// world row FOR UPDATE first, then the turns it touches; the world UPDATE is
// additionally guarded by `state_version` so a stale step can never commit.
// There is no JavaScript Map or in-process scheduler — restart recovery is
// "load the row and step again".

import crypto from 'node:crypto';
import { dbGet, dbAll, dbRun, withTransactionAsync } from '../../../database/connection.js';
import { provisionModuleTables } from '../../../services/ModuleTableProvisioner.js';
import { Game, runStep } from '../engine/game.js';
import { addLearner } from '../content/town.js';
import { NEO16_BLUEPRINT } from '../blueprint.js';

// W1 moved the table declarations into the module blueprint; the store keeps the W0 name.
export const NEO16_W0_BLUEPRINT = NEO16_BLUEPRINT;

/** Provision (or reuse) the two W0 tables inside a CRM project. Returns the provisioner mapping. */
export function provisionNeo16Tables(projectId, opts = {}) {
  return provisionModuleTables(projectId, NEO16_W0_BLUEPRINT, opts);
}

function parseData(data) {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export function requestHash(name, args) {
  return crypto.createHash('sha256').update(JSON.stringify({ name, args })).digest('hex');
}

/**
 * Create a world row from a serialized GameState. Engine record starts fresh.
 * @returns {Promise<{worldRowId: number}>}
 */
export async function createWorld(mapping, { worldKey, ownerUserId, state, userId = null, trx = null }) {
  const data = {
    world_key: worldKey,
    owner_user_id: ownerUserId,
    status: 'active',
    state_version: 0,
    current_time: null,
    last_step_ts: null,
    processed_input_number: null,
    next_input_number: 0,
    snapshot: state,
  };
  const res = await (trx ? trx.run : dbRun)(
    `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
    [mapping.worlds.table_id, crypto.randomUUID(), JSON.stringify(data), userId],
  );
  return { worldRowId: res.lastInsertRowid };
}

/**
 * The learner's own active world in this installation, created from `state` on first use.
 * Serialized through the same learner advisory lock the quest loop takes
 * (learning/questService.js `lockLearner`), so two tabs starting at once get ONE world.
 *
 * @returns {Promise<{worldRowId: number, created: boolean}>}
 */
export async function ensureLearnerWorld(mapping, { userId, worldKey, state }) {
  return withTransactionAsync(async (trx) => {
    await trx.run('SELECT pg_advisory_xact_lock(hashtext(?))', [`neo16:learner:${userId}`]);
    const row = await trx.get(
      `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'owner_user_id' = ? AND data->>'status' = 'active' ORDER BY id LIMIT 1 FOR UPDATE`,
      [mapping.worlds.table_id, String(userId)],
    );
    if (row) {
      const data = parseData(row.data);
      if (addLearner(data.snapshot, userId)) {
        await trx.run('UPDATE table_rows SET data = data || ?::jsonb, updated_at = NOW() WHERE id = ?',
          [JSON.stringify({ snapshot: data.snapshot, state_version: data.state_version + 1 }), row.id]);
      }
      return { worldRowId: row.id, created: false };
    }
    state = structuredClone(state);
    addLearner(state, userId);
    const { worldRowId } = await createWorld(mapping, { worldKey, ownerUserId: userId, state, userId, trx });
    return { worldRowId, created: true };
  });
}

/** Read a world row (no lock). Returns `{ id, data }` with `data` parsed, or null. */
export async function loadWorld(mapping, worldRowId) {
  const row = await dbGet(`SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`, [
    worldRowId,
    mapping.worlds.table_id,
  ]);
  return row ? { id: row.id, data: parseData(row.data) } : null;
}

/** All turns of a world ordered by input number (no lock). */
export async function listTurns(mapping, worldRowId) {
  const rows = await dbAll(
    `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'world_id' = ?
     ORDER BY (data->>'input_number')::int`,
    [mapping.turns.table_id, String(worldRowId)],
  );
  return rows.map((r) => ({ id: r.id, data: parseData(r.data) }));
}

/**
 * Durably accept a command for a world. Idempotent on (world, request_id):
 * the same request replayed returns the original turn; the same request_id
 * with a different payload is rejected (doc 239900 §Runtime step 2).
 *
 * @returns {Promise<{turnRowId: number, inputNumber: number, duplicate: boolean}>}
 */
export async function enqueueInput(mapping, { worldRowId, requestId, name, args, receivedTs, userId = null, trx: outerTrx = null }) {
  if (typeof requestId !== 'string' || !requestId) throw new Error('enqueueInput: request_id required');
  if (typeof name !== 'string' || !name) throw new Error('enqueueInput: input name required');
  const hash = requestHash(name, args ?? null);

  const apply = async (trx) => {
    const world = await trx.get(
      `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ? FOR UPDATE`,
      [worldRowId, mapping.worlds.table_id],
    );
    if (!world) throw new Error(`enqueueInput: world ${worldRowId} not found`);
    const worldData = parseData(world.data);

    const existing = await trx.get(
      `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'world_id' = ? AND data->>'request_id' = ? AND data->>'session_id' IS NULL`,
      [mapping.turns.table_id, String(worldRowId), requestId],
    );
    if (existing) {
      const d = parseData(existing.data);
      if (d.request_hash !== hash) {
        throw new Error(`enqueueInput: request_id ${requestId} replayed with a different payload`);
      }
      return { turnRowId: existing.id, inputNumber: d.input_number, duplicate: true };
    }

    const inputNumber = worldData.next_input_number ?? 0;
    const turn = {
      world_id: worldRowId,
      request_id: requestId,
      request_hash: hash,
      input_number: inputNumber,
      input_name: name,
      input_args: args ?? null,
      received_ts: receivedTs,
      processing_status: 'pending',
      applied_version: null,
      result: null,
    };
    const res = await trx.run(
      `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
      [mapping.turns.table_id, crypto.randomUUID(), JSON.stringify(turn), userId],
    );
    await trx.run(
      `UPDATE table_rows SET data = data || ?::jsonb, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify({ next_input_number: inputNumber + 1 }), worldRowId],
    );
    return { turnRowId: res.lastInsertRowid, inputNumber, duplicate: false };
  };
  return outerTrx ? apply(outerTrx) : withTransactionAsync(apply);
}

/**
 * Run one engine step for a world: lock → load snapshot + pending turns →
 * simulate up to `now` → persist snapshot, engine record and turn results
 * atomically, guarded by state_version.
 *
 * @returns {Promise<{stateVersion: number, completedInputs: Array, simulated: {from:number,to:number}}>}
 */
export async function stepWorld(mapping, worldRowId, now, { random, trx: outerTrx = null } = {}) {
  const apply = async (trx) => {
    const world = await trx.get(
      `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ? FOR UPDATE`,
      [worldRowId, mapping.worlds.table_id],
    );
    if (!world) throw new Error(`stepWorld: world ${worldRowId} not found`);
    const data = parseData(world.data);
    if (data.status !== 'active') throw new Error(`stepWorld: world ${worldRowId} is ${data.status}`);

    const game = new Game(data.snapshot, { random });

    const pending = await trx.all(
      `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'world_id' = ?
         AND data->>'processing_status' = 'pending' AND data->>'session_id' IS NULL
       ORDER BY (data->>'input_number')::int LIMIT ? FOR UPDATE`,
      [mapping.turns.table_id, String(worldRowId), game.maxInputsPerStep],
    );
    const inputs = pending.map((r) => {
      const d = parseData(r.data);
      return { id: r.id, number: d.input_number, name: d.input_name, args: d.input_args, received: d.received_ts };
    });

    const engine = {
      currentTime: data.current_time ?? undefined,
      lastStepTs: data.last_step_ts ?? undefined,
      processedInputNumber: data.processed_input_number ?? undefined,
      generationNumber: data.state_version,
    };
    const step = runStep(game, engine, now, inputs);

    const patch = {
      state_version: step.engine.generationNumber,
      current_time: step.engine.currentTime,
      last_step_ts: step.engine.lastStepTs ?? null,
      processed_input_number: step.engine.processedInputNumber ?? null,
      snapshot: { ...game.serialize(), ...(data.snapshot.runtime ? { runtime: data.snapshot.runtime } : {}) },
    };
    const upd = await trx.run(
      `UPDATE table_rows SET data = data || ?::jsonb, updated_at = NOW()
       WHERE id = ? AND (data->>'state_version')::int = ?`,
      [JSON.stringify(patch), worldRowId, data.state_version],
    );
    if (upd.changes !== 1) {
      throw new Error(`stepWorld: version conflict on world ${worldRowId} (expected ${data.state_version})`);
    }

    for (const done of step.completedInputs) {
      await trx.run(
        `UPDATE table_rows SET data = data || ?::jsonb, updated_at = NOW() WHERE id = ?`,
        [
          JSON.stringify({ processing_status: 'applied', applied_version: patch.state_version, result: done.returnValue }),
          done.inputId,
        ],
      );
    }

    return { stateVersion: patch.state_version, completedInputs: step.completedInputs, simulated: step.simulated };
  };
  return outerTrx ? apply(outerTrx) : withTransactionAsync(apply);
}
