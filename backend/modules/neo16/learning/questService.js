// Neo16 W2 — the durable quest loop on CRM tables (doc 239900 §Runtime and Transaction
// Contract, §Learning Loop).
//
// One learner utterance is processed in three phases:
//   A. short transaction — ordered locks (learner, then session), durable RECEIPT for the
//      request_id (same payload → saved result; different payload → rejected), a bounded
//      processing LEASE so a crashed/abandoned attempt can be reclaimed after it expires.
//   B. no transaction — the evaluator (rules or LLM) runs; its output is validated.
//   C. short transaction — same locks again; the lease token must still be ours, the
//      session version is re-checked, quest transitions are applied by SERVER rules
//      (right NPC, prerequisites met, confidence floor), and turn + session + progress
//      commit atomically. A stale attempt (lease reclaimed meanwhile) commits nothing.
//
// Progress identity is (user, target_kind, target_key, content_version); XP for a quest is
// awarded at most once per identity, which is what makes duplicate submits, concurrent tabs
// and retried LLM work unable to double-award. Authorization is server-side: the caller's
// user_id must own the session; nothing here trusts ids coming from a widget config.

import crypto from 'node:crypto';
import { z } from 'zod';
import { dbGet, dbAll, dbRun, withTransactionAsync } from '../../../database/connection.js';
import { EvaluationSchema, RULE_EVALUATOR_VERSION, ruleEvaluator } from './evaluator.js';
import { QUEST_KIND } from '../content/quests.js';

export const LEASE_MS = 30_000;
export const INTENT_CONFIDENCE_FLOOR = 0.6;
export const MAX_UTTERANCE_CHARS = 1000;

export class QuestError extends Error {
  constructor(message, code, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const machineKey = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);
const rowId = z.number().int().positive();

export const StartSessionInput = z.object({
  userId: rowId,
  worldRowId: rowId,
  questKey: machineKey,
  contentVersion: z.number().int().positive(),
  now: z.number().int().nonnegative().optional(),
});

export const UtteranceInput = z.object({
  userId: rowId,
  sessionRowId: rowId,
  requestId: z.string().min(1).max(128),
  npcKey: machineKey,
  text: z.string().trim().min(1).max(MAX_UTTERANCE_CHARS),
  // Optimistic concurrency from the client (envelope `expected_version`): when given, a NEW
  // turn is accepted only if the session is still at that state_version. Replays of an
  // already-applied receipt are answered before this check, so a retry keeps working.
  expectedVersion: z.number().int().nonnegative().nullable().optional(),
  now: z.number().int().nonnegative().optional(),
});

export const AbandonInput = z.object({
  userId: rowId,
  sessionRowId: rowId,
  requestId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative().nullable().optional(),
  now: z.number().int().nonnegative().optional(),
});

const parse = (d) => (typeof d === 'string' ? JSON.parse(d) : d);
const iso = (ms) => new Date(ms).toISOString();
const hashOf = (obj) => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const ABANDON_HASH = hashOf({ command: 'abandon_session' });

function requireMapping(mapping) {
  for (const k of ['turns', 'content', 'sessions', 'progress', 'worlds']) {
    if (!mapping?.[k]?.table_id) throw new QuestError(`neo16 mapping lacks table "${k}"`, 'MAPPING_INCOMPLETE', 500);
  }
}

// Doc §Runtime step 2: every writer takes the same ordered locks — learner first.
async function lockLearner(trx, userId) {
  await trx.run('SELECT pg_advisory_xact_lock(hashtext(?))', [`neo16:learner:${userId}`]);
}

async function lockSession(trx, mapping, sessionRowId, userId) {
  const row = await trx.get(`SELECT id, data FROM table_rows WHERE id = ? AND table_id = ? FOR UPDATE`, [
    sessionRowId,
    mapping.sessions.table_id,
  ]);
  const data = row ? parse(row.data) : null;
  // Not found and not-yours are the same answer: no existence oracle across learners.
  if (!data || Number(data.user_id) !== Number(userId)) {
    throw new QuestError(`session ${sessionRowId} not found`, 'SESSION_NOT_FOUND', 404);
  }
  return { id: row.id, data };
}

/**
 * Durable receipt for (session, request_id), locked. Same payload → the saved outcome
 * (`duplicate`) or its live lease (`processing`); another payload under the same id → 409.
 * Returns `{ existing, done }`: `existing` is a reclaimable turn (failed / expired lease).
 */
async function findReceipt(trx, mapping, sessionRowId, requestId, requestHash, now) {
  const row = await trx.get(
    `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'session_id' = ? AND data->>'request_id' = ? FOR UPDATE`,
    [mapping.turns.table_id, String(sessionRowId), requestId],
  );
  if (!row) return { existing: null, done: null };
  const t = parse(row.data);
  if (t.request_hash !== requestHash) {
    throw new QuestError(`request_id ${requestId} replayed with a different payload`, 'REQUEST_MISMATCH', 409);
  }
  if (t.processing_status === 'applied') return { existing: null, done: { status: 'duplicate', turn: publicTurn(row.id, t) } };
  if (t.processing_status === 'processing' && Number(t.lease_until) > now) {
    return { existing: null, done: { status: 'processing', turn: { id: row.id, lease_until: t.lease_until } } };
  }
  return { existing: { id: row.id, data: t }, done: null };
}

async function loadQuest(q, mapping, questKey, contentVersion) {
  const row = await q.get(
    `SELECT id, data FROM table_rows WHERE table_id = ?
       AND data->>'kind' = ? AND data->>'content_key' = ? AND (data->>'content_version')::int = ?`,
    [mapping.content.table_id, QUEST_KIND, questKey, contentVersion],
  );
  if (!row) throw new QuestError(`quest ${questKey}@${contentVersion} not found`, 'QUEST_NOT_FOUND', 404);
  const data = parse(row.data);
  if (data.status !== 'active') throw new QuestError(`quest ${questKey}@${contentVersion} is ${data.status}`, 'QUEST_INACTIVE', 409);
  return { id: row.id, ...data };
}

async function findProgress(trx, mapping, userId, questKey, contentVersion) {
  const row = await trx.get(
    `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'user_id' = ? AND data->>'target_kind' = ?
       AND data->>'target_key' = ? AND (data->>'content_version')::int = ? FOR UPDATE`,
    [mapping.progress.table_id, String(userId), QUEST_KIND, questKey, contentVersion],
  );
  return row ? { id: row.id, data: parse(row.data) } : null;
}

async function insertRow(trx, tableId, data, userId) {
  const res = await trx.run(`INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`, [
    tableId,
    crypto.randomUUID(),
    JSON.stringify(data),
    userId,
  ]);
  return res.lastInsertRowid;
}

async function patchRow(trx, id, patch, guard = null) {
  const sql = `UPDATE table_rows SET data = data || ?::jsonb, updated_at = NOW() WHERE id = ?` +
    (guard ? ` AND (data->>'${guard.column}')::int = ?` : '');
  const params = [JSON.stringify(patch), id];
  if (guard) params.push(guard.value);
  const res = await trx.run(sql, params);
  if (res.changes !== 1) throw new QuestError(`row ${id}: version conflict`, 'VERSION_CONFLICT', 409);
}

/**
 * Merge `patch` into the turn's `execution` record (AGENT_RUNTIME_CONTRACT §5) — but only
 * while the lease still belongs to the attempt that is writing. A late attempt whose lease was
 * reclaimed (contract 6.4) therefore cannot overwrite the live attempt's record. One atomic
 * statement, no explicit locks: the row-level guard is the fence.
 *
 * @returns {Promise<boolean>} true when the record was written, false when the lease moved on
 */
export async function patchTurnExecution(mapping, turnRowId, leaseToken, patch) {
  requireMapping(mapping);
  const res = await dbRun(
    `UPDATE table_rows
        SET data = jsonb_set(data, '{execution}', COALESCE(data->'execution', '{}'::jsonb) || ?::jsonb), updated_at = NOW()
      WHERE id = ? AND table_id = ? AND data->>'lease_token' = ?`,
    [JSON.stringify(patch), turnRowId, mapping.turns.table_id, leaseToken],
  );
  return res.changes === 1;
}

/**
 * Start (or resume) a quest session for a learner in their world. One ACTIVE session per
 * (learner, quest, version): a second call returns the existing one. A brand-new session
 * counts as one more attempt on the quest's progress row.
 *
 * @returns {Promise<{sessionRowId:number, resumed:boolean, progressRowId:number}>}
 */
export async function startSession(mapping, input) {
  requireMapping(mapping);
  const { userId, worldRowId, questKey, contentVersion, now = Date.now() } = StartSessionInput.parse(input);

  return withTransactionAsync(async (trx) => {
    await lockLearner(trx, userId);

    const world = await trx.get(`SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`, [worldRowId, mapping.worlds.table_id]);
    if (!world || Number(parse(world.data).owner_user_id) !== Number(userId)) {
      throw new QuestError(`world ${worldRowId} not found`, 'WORLD_NOT_FOUND', 404);
    }
    await loadQuest(trx, mapping, questKey, contentVersion); // must exist and be active

    const active = await trx.get(
      `SELECT id FROM table_rows WHERE table_id = ? AND data->>'user_id' = ? AND data->>'quest_key' = ?
         AND (data->>'content_version')::int = ? AND data->>'status' = 'active' ORDER BY id LIMIT 1`,
      [mapping.sessions.table_id, String(userId), questKey, contentVersion],
    );
    const progress = await findProgress(trx, mapping, userId, questKey, contentVersion);
    if (active) return { sessionRowId: active.id, resumed: true, progressRowId: progress?.id ?? null };

    const sessionRowId = await insertRow(trx, mapping.sessions.table_id, {
      user_id: userId,
      world_id: worldRowId,
      quest_key: questKey,
      content_version: contentVersion,
      status: 'active',
      started_at: iso(now),
      ended_at: null,
      state_version: 0,
      goals_done: [],
      next_input_number: 0,
      hints_used: 0,
      active_practice_seconds: 0,
    }, userId);

    let progressRowId;
    if (progress) {
      progressRowId = progress.id;
      await patchRow(trx, progress.id, { attempts: (progress.data.attempts ?? 0) + 1 });
    } else {
      progressRowId = await insertRow(trx, mapping.progress.table_id, {
        user_id: userId,
        target_kind: QUEST_KIND,
        target_key: questKey,
        content_version: contentVersion,
        status: 'in_progress',
        attempts: 1,
        completed_at: null,
        xp: 0,
        evidence_turn_id: null,
      }, userId);
    }
    return { sessionRowId, resumed: false, progressRowId };
  });
}

/** Goals the learner may complete right now with this NPC: not done, prerequisites met. */
function openGoals(quest, goalsDone, npcKey) {
  const done = new Set(goalsDone);
  return quest.payload.goals.filter(
    (g) => !done.has(g.key) && g.npc === npcKey && (g.requires ?? []).every((r) => done.has(r)),
  );
}

/**
 * Process one learner utterance addressed to an NPC. Idempotent on (session, request_id).
 *
 * @param {object} mapping   provisioner mapping (from install)
 * @param {object} input     see UtteranceInput
 * @param {object} [opts]
 * @param {(ctx:object)=>Promise<object>|object} [opts.evaluate]  evaluator; default rules. `ctx` is
 *   `{ text, npc, quest, goalsDone, turn }` where `turn = { id, leaseToken, attempt, sessionRowId,
 *   requestId, userId, previousExecution }` identifies the receipt this attempt holds, so an
 *   agent runner (learning/agentRun.js) can record its execution on the turn row and reap the
 *   previous attempt's process on reclaim (AGENT_RUNTIME_CONTRACT §3, 6.3).
 * @param {string|(()=>string)} [opts.evaluatorVersion]  a string, or a function read after the
 *   evaluator ran (the agent runner only knows the model it resolved once the run is over)
 * @param {number} [opts.leaseMs]
 * @returns {Promise<object>} `{ status: 'applied'|'duplicate'|'processing'|'stale', ... }`
 */
export async function submitUtterance(mapping, input, opts = {}) {
  requireMapping(mapping);
  const { userId, sessionRowId, requestId, npcKey, text, expectedVersion = null, now = Date.now() } = UtteranceInput.parse(input);
  const evaluate = opts.evaluate ?? ruleEvaluator;
  const versionOf = () => (typeof opts.evaluatorVersion === 'function' ? opts.evaluatorVersion() : opts.evaluatorVersion) ?? RULE_EVALUATOR_VERSION;
  const leaseMs = opts.leaseMs ?? LEASE_MS;
  const requestHash = hashOf({ npcKey, text });
  // Wall clock, taken BEFORE the lease is written: the evaluator's deadline is anchored here, so
  // everything between the receipt and the kill spends the same budget (`now` is the game clock
  // of the rows and may be injected; the runner's budget never is).
  const leaseStartedAt = Date.now();

  // ---- Phase A: receipt + lease -------------------------------------------------------
  const a = await withTransactionAsync(async (trx) => {
    await lockLearner(trx, userId);
    const session = await lockSession(trx, mapping, sessionRowId, userId);
    // Receipt before the status check: a replay of the very turn that closed this session
    // (completion, abandon) still gets its saved result instead of SESSION_CLOSED.
    const { existing, done } = await findReceipt(trx, mapping, sessionRowId, requestId, requestHash, now);
    if (done) return { done };
    if (session.data.status !== 'active') {
      throw new QuestError(`session ${sessionRowId} is ${session.data.status}`, 'SESSION_CLOSED', 409);
    }
    const quest = await loadQuest(trx, mapping, session.data.quest_key, session.data.content_version);
    if (!quest.payload.npcs.some((n) => n.key === npcKey)) {
      throw new QuestError(`npc "${npcKey}" is not in this quest`, 'UNKNOWN_NPC', 422);
    }

    const leaseToken = crypto.randomUUID();
    const stateVersion = session.data.state_version ?? 0;
    if (expectedVersion !== null && expectedVersion !== stateVersion) {
      throw new QuestError(`session ${sessionRowId} is at version ${stateVersion}, expected ${expectedVersion}`, 'VERSION_CONFLICT', 409);
    }
    if (existing) {
      // expired lease or failed attempt → reclaim (doc step 3: multiple attempts, one commit).
      // The previous attempt's execution record travels to the evaluator so a still-running
      // process can be reaped BEFORE anything new is spawned (contract 6.3: one live process per turn).
      const attempt = (existing.data.attempt ?? 1) + 1;
      await patchRow(trx, existing.id, { processing_status: 'processing', lease_until: now + leaseMs, lease_token: leaseToken, attempt });
      return { turnRowId: existing.id, leaseToken, attempt, previousExecution: existing.data.execution ?? null, quest, session };
    }

    const turnRowId = await insertRow(trx, mapping.turns.table_id, {
      world_id: null, // learning turns are not engine inputs; stepWorld never picks them up
      session_id: sessionRowId,
      request_id: requestId,
      request_hash: requestHash,
      input_number: session.data.next_input_number ?? 0,
      input_name: 'say',
      input_args: null,
      npc_key: npcKey,
      input_text: text,
      received_ts: now,
      processing_status: 'processing',
      attempt: 1,
      lease_until: now + leaseMs,
      lease_token: leaseToken,
      applied_version: null,
      response: null,
      evaluation: null,
      result: null,
    }, userId);
    await patchRow(trx, sessionRowId, { next_input_number: (session.data.next_input_number ?? 0) + 1 });
    return { turnRowId, leaseToken, attempt: 1, previousExecution: null, quest, session };
  });
  if (a.done) return a.done;

  // ---- Phase B: evaluator, outside any transaction -----------------------------------
  let evaluation;
  try {
    const raw = await evaluate({
      text,
      npc: a.quest.payload.npcs.find((n) => n.key === npcKey),
      quest: a.quest,
      goalsDone: a.session.data.goals_done ?? [],
      turn: {
        id: a.turnRowId, leaseToken: a.leaseToken, attempt: a.attempt, previousExecution: a.previousExecution, sessionRowId, requestId, userId,
        leaseStartedAt, leaseMs,
      },
    });
    evaluation = EvaluationSchema.parse(raw);
  } catch (err) {
    const fence = await withTransactionAsync(async (trx) => {
      await lockLearner(trx, userId);
      await lockSession(trx, mapping, sessionRowId, userId);
      const t = await trx.get(`SELECT data FROM table_rows WHERE id = ? FOR UPDATE`, [a.turnRowId]);
      const data = t ? parse(t.data) : null;
      if (data && data.lease_token === a.leaseToken) {
        await patchRow(trx, a.turnRowId, {
          processing_status: 'failed', lease_token: null, result: { error: String(err.message).slice(0, 500), code: err.code ?? 'EVALUATION_FAILED' },
        });
        return { ours: true };
      }
      return { ours: false, processing_status: data?.processing_status ?? null };
    });
    // An attempt that lost its lease (reclaimed, cancelled by abandon) is STALE, not failed: the
    // turn belongs to someone else now and its failure must not be reported as the turn's.
    if (!fence.ours) return { status: 'stale', turn: { id: a.turnRowId, processing_status: fence.processing_status } };
    // A configuration error (no agent bound, bound agent unusable — 409) keeps its own code so the
    // client sees WHAT to fix; anything else is a retryable evaluation failure.
    if (err instanceof QuestError) throw err;
    throw new QuestError(`evaluation failed: ${err.message}`, 'EVALUATION_FAILED', 502);
  }
  const evaluatorVersion = versionOf();

  // ---- Phase C: re-lock, re-check lease, apply atomically ----------------------------
  const applyNow = Date.now();
  return withTransactionAsync(async (trx) => {
    await lockLearner(trx, userId);
    const session = await lockSession(trx, mapping, sessionRowId, userId);
    const turnRow = await trx.get(`SELECT id, data FROM table_rows WHERE id = ? FOR UPDATE`, [a.turnRowId]);
    const turn = parse(turnRow.data);
    if (turn.processing_status !== 'processing' || turn.lease_token !== a.leaseToken) {
      return { status: 'stale', turn: { id: a.turnRowId, processing_status: turn.processing_status } };
    }

    const quest = a.quest; // content is versioned and immutable for the session
    const goalsDone = [...(session.data.goals_done ?? [])];
    let goalCompleted = null;
    if (session.data.status === 'active' && evaluation.intent.confidence >= INTENT_CONFIDENCE_FLOOR) {
      const goal = openGoals(quest, goalsDone, npcKey).find((g) => g.intent === evaluation.intent.name);
      if (goal) {
        goalsDone.push(goal.key);
        goalCompleted = goal.key;
      }
    }
    const questCompleted = session.data.status === 'active' && goalsDone.length === quest.payload.goals.length;
    const nextVersion = (session.data.state_version ?? 0) + 1;

    await patchRow(trx, a.turnRowId, {
      processing_status: 'applied',
      applied_version: nextVersion,
      lease_until: null,
      lease_token: null,
      response: { npc_response: evaluation.npc_response },
      evaluation: {
        intent: evaluation.intent,
        feedback: evaluation.feedback,
        grammar_errors: evaluation.grammar_errors,
        vocabulary: evaluation.vocabulary,
        evaluator_version: evaluatorVersion,
        goal_completed: goalCompleted,
      },
    });

    const sessionPatch = { state_version: nextVersion, goals_done: goalsDone };
    if (questCompleted) Object.assign(sessionPatch, { status: 'completed', ended_at: iso(applyNow) });
    await patchRow(trx, sessionRowId, sessionPatch, { column: 'state_version', value: session.data.state_version ?? 0 });

    let progress = await findProgress(trx, mapping, userId, quest.content_key, quest.content_version);
    let xpAwarded = 0;
    if (questCompleted && progress && progress.data.status !== 'completed') {
      xpAwarded = quest.payload.xp ?? 0;
      const patch = {
        status: 'completed', completed_at: iso(applyNow), xp: (progress.data.xp ?? 0) + xpAwarded, evidence_turn_id: a.turnRowId,
      };
      await patchRow(trx, progress.id, patch);
      progress = { id: progress.id, data: { ...progress.data, ...patch } };
    }

    return {
      status: 'applied',
      turn: { id: a.turnRowId, npc_response: evaluation.npc_response, evaluation: { ...evaluation, goal_completed: goalCompleted } },
      session: { id: sessionRowId, state_version: nextVersion, goals_done: goalsDone, status: questCompleted ? 'completed' : session.data.status },
      quest_completed: questCompleted,
      xp_awarded: xpAwarded,
      progress: progress ? { id: progress.id, status: progress.data.status, xp: progress.data.xp, attempts: progress.data.attempts } : null,
    };
  });
}

/**
 * Close an active session without finishing the quest (envelope command `abandon_session`).
 * One short transaction under the same ordered locks and receipt rules as `submitUtterance`;
 * there is no evaluator phase, so the turn is applied in the same transaction. Progress keeps
 * its attempts and status: a later `startSession` opens a new attempt on the same identity.
 * Idempotent on (session, request_id); a `say` id cannot be reused for abandon or vice versa.
 *
 * Cancellation (AGENT_RUNTIME_CONTRACT 6.7): every turn of the session still `processing` has
 * its lease revoked in the same transaction (`cancelled`, no token), so a run that is still
 * talking to a model hits the Phase C fence and commits nothing. After commit the caller may
 * reap those processes via `opts.onCancelled(turns)` — best effort, never part of the decision.
 *
 * @param {object} [opts]
 * @param {(turns: Array<{id:number, execution:object|null}>) => Promise<void>|void} [opts.onCancelled]
 * @returns {Promise<object>} `{ status: 'applied'|'duplicate', turn, session, cancelled_turns }`
 */
export async function abandonSession(mapping, input, opts = {}) {
  requireMapping(mapping);
  const { userId, sessionRowId, requestId, expectedVersion = null, now = Date.now() } = AbandonInput.parse(input);

  const result = await withTransactionAsync(async (trx) => {
    await lockLearner(trx, userId);
    const session = await lockSession(trx, mapping, sessionRowId, userId);
    const { done } = await findReceipt(trx, mapping, sessionRowId, requestId, ABANDON_HASH, now);
    if (done) return done; // abandon never leaves a reclaimable receipt: it has no outside-DB phase
    if (session.data.status !== 'active') {
      throw new QuestError(`session ${sessionRowId} is ${session.data.status}`, 'SESSION_CLOSED', 409);
    }
    const stateVersion = session.data.state_version ?? 0;
    if (expectedVersion !== null && expectedVersion !== stateVersion) {
      throw new QuestError(`session ${sessionRowId} is at version ${stateVersion}, expected ${expectedVersion}`, 'VERSION_CONFLICT', 409);
    }
    const nextVersion = stateVersion + 1;
    const inputNumber = session.data.next_input_number ?? 0;
    const turnRowId = await insertRow(trx, mapping.turns.table_id, {
      world_id: null,
      session_id: sessionRowId,
      request_id: requestId,
      request_hash: ABANDON_HASH,
      input_number: inputNumber,
      input_name: 'abandon_session',
      input_args: null,
      npc_key: null,
      input_text: null,
      received_ts: now,
      processing_status: 'applied',
      attempt: 1,
      lease_until: null,
      lease_token: null,
      applied_version: nextVersion,
      response: null,
      evaluation: null,
      result: { status: 'abandoned' },
    }, userId);
    await patchRow(trx, sessionRowId, {
      status: 'abandoned', ended_at: iso(now), state_version: nextVersion, next_input_number: inputNumber + 1,
    }, { column: 'state_version', value: stateVersion });

    // Revoke in-flight leases of this session (6.7). The learner+session locks are held, so no
    // attempt can take or renew a lease on these turns while we flip them.
    const inFlight = await trx.all(
      `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'session_id' = ? AND data->>'processing_status' = 'processing' FOR UPDATE`,
      [mapping.turns.table_id, String(sessionRowId)],
    );
    const cancelled = [];
    for (const row of inFlight) {
      const t = parse(row.data);
      const execution = t.execution ? { ...t.execution, exit: 'cancelled' } : null;
      await patchRow(trx, row.id, { processing_status: 'cancelled', lease_token: null, lease_until: null, execution, result: { status: 'cancelled' } });
      cancelled.push({ id: row.id, execution });
    }

    return {
      status: 'applied',
      turn: { id: turnRowId, input_number: inputNumber, applied_version: nextVersion },
      session: { id: sessionRowId, status: 'abandoned', state_version: nextVersion, goals_done: session.data.goals_done ?? [] },
      cancelled_turns: cancelled,
    };
  });

  if (result.status !== 'applied') return result;
  if (result.cancelled_turns.length && opts.onCancelled) {
    // The reaper needs the full records (pid, identity); the caller only ever sees the public view.
    try { await opts.onCancelled(result.cancelled_turns); } catch { /* best effort: the decision is already durable */ }
  }
  return { ...result, cancelled_turns: result.cancelled_turns.map((c) => ({ id: c.id, execution: publicExecution(c.execution) })) };
}

/** The provenance a client may see (contract §7): which agent/model answered — never pid, lease or env. */
function publicExecution(e) {
  if (!e) return null;
  const { agent_row_id, provider, requested_model, resolved_model, model_source, exit, attempt } = e;
  return { agent_row_id, provider, requested_model, resolved_model, model_source, exit, attempt };
}

/** One projection for every turn a client gets back (state, duplicate replay): no lease, hash or raw execution. */
function publicTurn(id, t) {
  return {
    id,
    input_number: t.input_number,
    command: t.input_name,
    npc_key: t.npc_key ?? null,
    text: t.input_text ?? null,
    processing_status: t.processing_status,
    attempt: t.attempt,
    applied_version: t.applied_version ?? null,
    npc_response: t.response?.npc_response ?? null,
    evaluation: t.evaluation ?? null,
    execution: publicExecution(t.execution),
  };
}

/**
 * Everything a client needs to resume: session, quest content, applied turns in order,
 * progress. Read-only; the caller must own the session.
 */
export async function loadSessionState(mapping, { userId, sessionRowId }) {
  requireMapping(mapping);
  const row = await dbGet(`SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`, [sessionRowId, mapping.sessions.table_id]);
  const session = row ? parse(row.data) : null;
  if (!session || Number(session.user_id) !== Number(userId)) {
    throw new QuestError(`session ${sessionRowId} not found`, 'SESSION_NOT_FOUND', 404);
  }
  const quest = await loadQuest({ get: dbGet }, mapping, session.quest_key, session.content_version);
  const turns = await dbAll(
    `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'session_id' = ? ORDER BY (data->>'input_number')::int`,
    [mapping.turns.table_id, String(sessionRowId)],
  );
  const progressRow = await dbGet(
    `SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'user_id' = ? AND data->>'target_kind' = ?
       AND data->>'target_key' = ? AND (data->>'content_version')::int = ?`,
    [mapping.progress.table_id, String(userId), QUEST_KIND, session.quest_key, session.content_version],
  );
  return {
    session: { id: row.id, ...session },
    quest: { id: quest.id, key: quest.content_key, version: quest.content_version, title: quest.title, ...quest.payload },
    turns: turns.map((t) => publicTurn(t.id, parse(t.data))),
    progress: progressRow ? { id: progressRow.id, ...parse(progressRow.data) } : null,
  };
}
