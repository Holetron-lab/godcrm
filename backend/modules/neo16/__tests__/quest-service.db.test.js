// Neo16 W2 — one durable quest on godcrm_test (doc 239900 W2 acceptance):
// the entire first loop writes CRM rows; reload/resume restores state from those rows;
// duplicate submits and interrupted evaluator work never double-award; two simultaneous
// tabs serialize through the ordered locks. Authorization is server-side; learning turns
// never reach the engine step.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { dbGet, dbAll, dbRun, resetAdapter, destroyAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { provisionModuleTables, seedModuleRows } from '../../../services/ModuleTableProvisioner.js';
import { NEO16_BLUEPRINT } from '../blueprint.js';
import { createWorld, stepWorld, listTurns } from '../store/crmWorldStore.js';
import { startSession, submitUtterance, abandonSession, loadSessionState, LEASE_MS, QuestError } from '../learning/questService.js';
import { ruleEvaluator } from '../learning/evaluator.js';
import { createLlmEvaluator } from '../learning/llmEvaluator.js';
import { ARRANGE_MEETING } from '../content/quests.js';
import { makeState } from './fixtures.js';

const SLOW = 30_000;
const T0 = 1_700_000_000_000;
const QUEST = { questKey: ARRANGE_MEETING.content_key, contentVersion: ARRANGE_MEETING.content_version };

let ws;
let ws2; // second learner: fresh progress identity for the concurrent-finish proof
let ws3; // third learner: fresh progress identity for the abandon-vs-utterance race
let mapping;
let worldId;
let seq = 0;
let finalReqId; // request_id of the turn that completed the first learner's quest

const parse = (d) => (typeof d === 'string' ? JSON.parse(d) : d);
const rowsOf = (key, where = '', params = []) =>
  dbAll(`SELECT id, data FROM table_rows WHERE table_id = ? ${where} ORDER BY id`, [mapping[key].table_id, ...params])
    .then((rows) => rows.map((r) => ({ id: r.id, ...parse(r.data) })));

const start = (userId = ws.userId) => startSession(mapping, { userId, worldRowId: worldId, ...QUEST, now: T0 });
// One ACTIVE session per (learner, quest, version) is the product rule, so tests that need a
// clean session abandon the learner's active one through the real command (W2-S4).
async function freshSession() {
  const s = await start();
  if (!s.resumed) return s;
  await abandonSession(mapping, { userId: ws.userId, sessionRowId: s.sessionRowId, requestId: `ab-${++seq}`, now: T0 });
  return start();
}
const say = (sessionRowId, npcKey, text, extra = {}, opts = undefined) =>
  submitUtterance(mapping, { userId: ws.userId, sessionRowId, requestId: `r-${++seq}`, npcKey, text, now: T0, ...extra }, opts);

beforeAll(async () => {
  await resetAdapter();
  // Doc 239900 §Verification: confirm the actual target before any write.
  const db = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(db.db).toMatch(/_test$/);
  expect([null, '127.0.0.1', '::1']).toContain(db.host);

  ws = await createEphemeralWorkspace({ label: 'neo16-w2', table: false, dashboard: false });
  mapping = await provisionModuleTables(ws.projectId, NEO16_BLUEPRINT, { userId: ws.userId });
  await seedModuleRows(mapping, NEO16_BLUEPRINT, { userId: ws.userId });
  ({ worldRowId: worldId } = await createWorld(mapping, {
    worldKey: 'w2-town', ownerUserId: ws.userId, state: makeState(), userId: ws.userId,
  }));
}, SLOW);

afterAll(async () => {
  if (mapping) {
    for (const t of Object.values(mapping)) await dbRun('DELETE FROM table_rows WHERE table_id = ?', [t.table_id]);
  }
  await ws3?.cleanup();
  await ws2?.cleanup();
  await ws?.cleanup();
  await destroyAdapter();
}, SLOW);

describe('Neo16 W2 — one durable quest on CRM tables (godcrm_test)', () => {
  it('the whole first loop writes CRM rows: goals gated by server rules, XP awarded on completion', async () => {
    const s = await start();
    expect(s.resumed).toBe(false);
    expect(await rowsOf('sessions')).toMatchObject([{ id: s.sessionRowId, status: 'active', goals_done: [], state_version: 0 }]);
    expect(await rowsOf('progress')).toMatchObject([{ id: s.progressRowId, status: 'in_progress', attempts: 1, xp: 0 }]);

    // Confirming with Dr. Reed BEFORE knowing time and place is understood but completes nothing
    // (content `requires` is enforced by the server, not by the evaluator's intent).
    const early = await say(s.sessionRowId, 'reed', 'Thursday at two works for me.');
    expect(early.status).toBe('applied');
    expect(early.turn.evaluation.intent.name).toBe('confirm_meeting');
    expect(early.turn.evaluation.goal_completed).toBeNull();
    expect(early.session).toMatchObject({ state_version: 1, goals_done: [] });

    const t1 = await say(s.sessionRowId, 'nora', "When is Dr. Reed free? I didn't saw her yesterday.");
    expect(t1.turn.evaluation.goal_completed).toBe('ask_time');
    expect(t1.turn.evaluation.grammar_errors).toEqual([
      expect.objectContaining({ original: "didn't saw", corrected: "didn't see" }),
    ]);
    expect(t1.turn.npc_response).toMatch(/Thursday/);
    expect(t1.xp_awarded).toBe(0);

    const t2 = await say(s.sessionRowId, 'nora', 'Where should I meet her?');
    expect(t2.turn.evaluation.goal_completed).toBe('ask_place');
    expect(t2.quest_completed).toBe(false);

    const t3 = await say(s.sessionRowId, 'reed', 'Thursday at two in Lab B works for me.');
    finalReqId = `r-${seq}`;
    expect(t3.turn.evaluation.goal_completed).toBe('confirm');
    expect(t3.quest_completed).toBe(true);
    expect(t3.xp_awarded).toBe(ARRANGE_MEETING.payload.xp);
    expect(t3.session).toMatchObject({ state_version: 4, status: 'completed' });

    // Durable rows, readable as plain CRM table data.
    const turns = await rowsOf('turns', `AND data->>'session_id' = ?`, [String(s.sessionRowId)]);
    expect(turns.map((t) => [t.input_number, t.npc_key, t.processing_status, t.applied_version])).toEqual([
      [0, 'reed', 'applied', 1], [1, 'nora', 'applied', 2], [2, 'nora', 'applied', 3], [3, 'reed', 'applied', 4],
    ]);
    expect(turns[1].evaluation).toMatchObject({ evaluator_version: 'rule-v1', goal_completed: 'ask_time' });
    expect(turns[1].lease_token).toBeNull();
    expect(await rowsOf('sessions')).toMatchObject([
      { id: s.sessionRowId, status: 'completed', goals_done: ['ask_time', 'ask_place', 'confirm'], state_version: 4, next_input_number: 4 },
    ]);
    expect(await rowsOf('progress')).toMatchObject([
      { id: s.progressRowId, status: 'completed', xp: 50, attempts: 1, evidence_turn_id: t3.turn.id },
    ]);
  }, SLOW);

  it('reload/resume: state comes back from rows; a closed session rejects input; a replay never re-awards', async () => {
    const [done] = await rowsOf('sessions', `AND data->>'status' = 'completed'`);
    const state = await loadSessionState(mapping, { userId: ws.userId, sessionRowId: done.id });
    expect(state.session).toMatchObject({ id: done.id, status: 'completed', goals_done: ['ask_time', 'ask_place', 'confirm'] });
    expect(state.quest).toMatchObject({ key: 'arrange_meeting', version: 1, goals: ARRANGE_MEETING.payload.goals });
    expect(state.turns.map((t) => t.input_number)).toEqual([0, 1, 2, 3]);
    expect(state.turns[3]).toMatchObject({ npc_key: 'reed', npc_response: expect.stringMatching(/Lab B/) });
    expect(state.progress).toMatchObject({ status: 'completed', xp: 50 });

    // Replaying the very turn that completed the session is still a duplicate, not SESSION_CLOSED.
    const replay = await submitUtterance(mapping, {
      userId: ws.userId, sessionRowId: done.id, requestId: finalReqId, npcKey: 'reed', text: 'Thursday at two in Lab B works for me.', now: T0,
    });
    expect(replay).toMatchObject({ status: 'duplicate', turn: { id: state.turns[3].id, applied_version: 4 } });
    await expect(say(done.id, 'nora', 'Hello again')).rejects.toMatchObject({ code: 'SESSION_CLOSED', status: 409 });

    // Starting the quest again is a new attempt on the SAME progress identity; resuming while it
    // is active returns the same session; finishing it again adds no XP.
    const again = await start();
    expect(again).toMatchObject({ resumed: false, progressRowId: state.progress.id });
    expect(again.sessionRowId).not.toBe(done.id);
    expect(await start()).toEqual({ sessionRowId: again.sessionRowId, resumed: true, progressRowId: state.progress.id });
    await say(again.sessionRowId, 'nora', 'When is she free?');
    await say(again.sessionRowId, 'nora', 'Where is her office?');
    const fin = await say(again.sessionRowId, 'reed', "I'll be there on Thursday.");
    expect(fin).toMatchObject({ quest_completed: true, xp_awarded: 0 });
    expect(await rowsOf('progress')).toMatchObject([{ status: 'completed', xp: 50, attempts: 2 }]);
  }, SLOW);

  it('duplicate submit: same request_id returns the saved result, no second turn; another payload is rejected', async () => {
    const s = await freshSession();
    const req = { userId: ws.userId, sessionRowId: s.sessionRowId, requestId: 'dup-1', npcKey: 'nora', text: 'When is she free?', now: T0 };
    const first = await submitUtterance(mapping, req);
    expect(first.status).toBe('applied');
    const replay = await submitUtterance(mapping, { ...req, now: T0 + 5 });
    expect(replay.status).toBe('duplicate');
    expect(replay.turn).toMatchObject({ id: first.turn.id, processing_status: 'applied', applied_version: 1 });
    await expect(submitUtterance(mapping, { ...req, text: 'Where is she?' })).rejects.toMatchObject({ code: 'REQUEST_MISMATCH' });

    const turns = await rowsOf('turns', `AND data->>'session_id' = ?`, [String(s.sessionRowId)]);
    expect(turns).toHaveLength(1);
    expect(await rowsOf('sessions', 'AND id = ?', [s.sessionRowId])).toMatchObject([{ state_version: 1, goals_done: ['ask_time'] }]);
  }, SLOW);

  it('interrupted evaluator: a failed attempt is retryable; an expired lease is reclaimed and the late result is stale', async () => {
    const s = await freshSession();
    const base = { userId: ws.userId, sessionRowId: s.sessionRowId, npcKey: 'nora', text: 'Where should I meet her?' };

    // 1. The model call throws: turn stays as a retryable receipt, nothing is applied.
    const boom = () => { throw new Error('upstream timeout'); };
    await expect(submitUtterance(mapping, { ...base, requestId: 'crash', now: T0 }, { evaluate: boom }))
      .rejects.toMatchObject({ code: 'EVALUATION_FAILED', status: 502 });
    let [turn] = await rowsOf('turns', `AND data->>'request_id' = 'crash'`);
    expect(turn).toMatchObject({ processing_status: 'failed', attempt: 1, lease_token: null });
    expect(await rowsOf('sessions', 'AND id = ?', [s.sessionRowId])).toMatchObject([{ state_version: 0 }]);

    // Same request_id retried → the receipt is reclaimed (attempt 2), applied exactly once.
    const retry = await submitUtterance(mapping, { ...base, requestId: 'crash', now: T0 + 1 });
    expect(retry).toMatchObject({ status: 'applied', turn: { id: turn.id } });
    [turn] = await rowsOf('turns', `AND data->>'request_id' = 'crash'`);
    expect(turn).toMatchObject({ processing_status: 'applied', attempt: 2, applied_version: 1 });

    // 2. A hung model call: while the lease is live the duplicate reports `processing`; after it
    //    expires a second attempt reclaims the receipt; the late first result commits NOTHING.
    let release;
    const gate = new Promise((r) => { release = r; });
    const hanging = async (ctx) => { await gate; return ruleEvaluator(ctx); };
    const slow = submitUtterance(mapping, { ...base, requestId: 'hang', text: 'When is she free?', now: T0 }, { evaluate: hanging });
    await new Promise((r) => setTimeout(r, 50)); // let phase A of `slow` commit its lease
    const live = await submitUtterance(mapping, { ...base, requestId: 'hang', text: 'When is she free?', now: T0 + 1 });
    expect(live.status).toBe('processing');
    const reclaimed = await submitUtterance(mapping, { ...base, requestId: 'hang', text: 'When is she free?', now: T0 + LEASE_MS + 1 });
    expect(reclaimed).toMatchObject({ status: 'applied', turn: { evaluation: { goal_completed: 'ask_time' } } });
    release();
    expect(await slow).toMatchObject({ status: 'stale', turn: { processing_status: 'applied' } });

    const turns = await rowsOf('turns', `AND data->>'session_id' = ?`, [String(s.sessionRowId)]);
    expect(turns.map((t) => [t.request_id, t.processing_status, t.attempt, t.applied_version])).toEqual([
      ['crash', 'applied', 2, 1], ['hang', 'applied', 2, 2],
    ]);
    expect(await rowsOf('sessions', 'AND id = ?', [s.sessionRowId])).toMatchObject([
      { state_version: 2, goals_done: ['ask_place', 'ask_time'] },
    ]);
  }, SLOW);

  it('two tabs: concurrent utterances serialize; a simultaneous double finish awards XP once', async () => {
    // A learner who has never finished this quest, so the XP award itself is under test.
    ws2 = await createEphemeralWorkspace({ label: 'neo16-w2-b', table: false, dashboard: false });
    const { worldRowId: world2 } = await createWorld(mapping, {
      worldKey: 'w2-town-b', ownerUserId: ws2.userId, state: makeState(), userId: ws2.userId,
    });
    const s = await startSession(mapping, { userId: ws2.userId, worldRowId: world2, ...QUEST, now: T0 });
    const tab = (requestId, npcKey, text) =>
      submitUtterance(mapping, { userId: ws2.userId, sessionRowId: s.sessionRowId, requestId, npcKey, text, now: T0 });

    const [a, b] = await Promise.all([tab('tab-a2', 'nora', 'Where should I meet her?'), tab('tab-a', 'nora', 'When is she free?')]);
    expect([a.status, b.status]).toEqual(['applied', 'applied']);
    expect([a.session.state_version, b.session.state_version].sort()).toEqual([1, 2]);

    // Both tabs confirm at the same instant: exactly one completes the quest and gets the XP.
    const [c, d] = await Promise.all([tab('tab-c', 'reed', "I'll be there on Thursday."), tab('tab-d', 'reed', 'Sounds good, Thursday at two.')]);
    const finishes = [c, d].filter((r) => r.quest_completed);
    expect(finishes).toHaveLength(1);
    expect([c, d].map((r) => r.xp_awarded).sort()).toEqual([0, 50]);
    expect([c, d].map((r) => r.session.state_version).sort()).toEqual([3, 4]);

    const session = (await rowsOf('sessions', 'AND id = ?', [s.sessionRowId]))[0];
    expect(session).toMatchObject({ status: 'completed', state_version: 4, next_input_number: 4 });
    expect([...session.goals_done].sort()).toEqual(['ask_place', 'ask_time', 'confirm']);
    const turns = await rowsOf('turns', `AND data->>'session_id' = ?`, [String(s.sessionRowId)]);
    expect(turns.map((t) => t.input_number).sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(turns.map((t) => t.applied_version)).size).toBe(4);
    // One progress row for this learner, XP exactly once; the first learner's row is untouched.
    expect(await rowsOf('progress', `AND data->>'user_id' = ?`, [String(ws2.userId)])).toMatchObject([
      { status: 'completed', xp: 50, attempts: 1, evidence_turn_id: finishes[0].turn.id },
    ]);
    expect(await rowsOf('progress', `AND data->>'user_id' = ?`, [String(ws.userId)])).toMatchObject([{ status: 'completed', xp: 50 }]);
  }, SLOW);

  it('authorization and validation are server-side: no cross-learner reads/writes, NPC allowlist, bounded text', async () => {
    const stranger = Number(ws.userId) + 1_000_000;
    const session = { id: (await freshSession()).sessionRowId };

    await expect(start(stranger)).rejects.toMatchObject({ code: 'WORLD_NOT_FOUND', status: 404 });
    await expect(loadSessionState(mapping, { userId: stranger, sessionRowId: session.id })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await expect(submitUtterance(mapping, { userId: stranger, sessionRowId: session.id, requestId: 'x', npcKey: 'nora', text: 'hi' }))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND', status: 404 });
    await expect(say(session.id, 'bob', 'hi')).rejects.toMatchObject({ code: 'UNKNOWN_NPC', status: 422 });
    await expect(say(session.id, 'nora', 'x'.repeat(1001))).rejects.toThrow(/too_big|1000/);
    await expect(say(session.id, 'nora', '   ')).rejects.toThrow();
    expect(new QuestError('m', 'C')).toMatchObject({ status: 400 });

    // No rows were created by the rejected calls.
    expect(await rowsOf('turns', `AND data->>'session_id' = ? AND data->>'request_id' = 'x'`, [String(session.id)])).toEqual([]);
  }, SLOW);

  it('abandon_session: durable close under the same locks; replay is a duplicate; the quest restarts as a new attempt', async () => {
    const s = await freshSession();
    await say(s.sessionRowId, 'nora', 'When is she free?');
    const sayReqId = `r-${seq}`;
    const [before] = await rowsOf('progress', `AND data->>'user_id' = ?`, [String(ws.userId)]);
    const abandon = (requestId, extra = {}) => abandonSession(mapping, { userId: ws.userId, sessionRowId: s.sessionRowId, requestId, now: T0 + 10, ...extra });

    // Receipt rules: a `say` id cannot be reused for abandon; expected_version gates; strangers get 404.
    await expect(abandon(sayReqId)).rejects.toMatchObject({ code: 'REQUEST_MISMATCH', status: 409 });
    await expect(abandon('ab-x', { expectedVersion: 0 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    await expect(abandon('ab-x', { userId: Number(ws.userId) + 1_000_000 })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND', status: 404 });
    expect(await rowsOf('sessions', 'AND id = ?', [s.sessionRowId])).toMatchObject([{ status: 'active', state_version: 1 }]);

    const ab = await abandon('ab-x', { expectedVersion: 1 });
    expect(ab).toMatchObject({
      status: 'applied', turn: { input_number: 1, applied_version: 2 }, session: { id: s.sessionRowId, status: 'abandoned', state_version: 2, goals_done: ['ask_time'] },
    });
    expect(await rowsOf('sessions', 'AND id = ?', [s.sessionRowId])).toMatchObject([
      { status: 'abandoned', state_version: 2, next_input_number: 2, ended_at: new Date(T0 + 10).toISOString() },
    ]);
    const turns = await rowsOf('turns', `AND data->>'session_id' = ?`, [String(s.sessionRowId)]);
    expect(turns.map((t) => [t.input_name, t.processing_status, t.applied_version])).toEqual([['say', 'applied', 1], ['abandon_session', 'applied', 2]]);
    expect(turns[1]).toMatchObject({ id: ab.turn.id, world_id: null, npc_key: null, input_text: null, lease_token: null, result: { status: 'abandoned' } });

    // Replay → saved result, no new row. The closed session rejects a new say and a NEW abandon alike.
    expect(await abandon('ab-x')).toMatchObject({ status: 'duplicate', turn: { id: ab.turn.id, processing_status: 'applied' } });
    await expect(say(s.sessionRowId, 'nora', 'Where should I meet her?')).rejects.toMatchObject({ code: 'SESSION_CLOSED', status: 409 });
    await expect(abandon('ab-y')).rejects.toMatchObject({ code: 'SESSION_CLOSED', status: 409 });
    expect(await rowsOf('turns', `AND data->>'session_id' = ?`, [String(s.sessionRowId)])).toHaveLength(2);
    expect(await stepWorld(mapping, worldId, T0, { random: () => 0.5 })).toMatchObject({ completedInputs: [] });

    // Progress is untouched by abandoning; starting again is one more attempt on the same identity.
    expect(await rowsOf('progress', `AND data->>'user_id' = ?`, [String(ws.userId)])).toMatchObject([before]);
    const next = await start();
    expect(next).toMatchObject({ resumed: false, progressRowId: before.id });
    expect(next.sessionRowId).not.toBe(s.sessionRowId);
    expect(await rowsOf('progress', 'AND id = ?', [before.id])).toMatchObject([{ attempts: before.attempts + 1, xp: before.xp }]);

    const state = await loadSessionState(mapping, { userId: ws.userId, sessionRowId: s.sessionRowId });
    expect(state.session).toMatchObject({ status: 'abandoned', state_version: 2 });
    expect(state.turns.map((t) => [t.command, t.npc_key])).toEqual([['say', 'nora'], ['abandon_session', null]]);
  }, SLOW);

  it('abandon beats an in-flight utterance: its lease is revoked, the late result is stale, no XP (contract 6.7)', async () => {
    ws3 = await createEphemeralWorkspace({ label: 'neo16-w2-c', table: false, dashboard: false });
    const { worldRowId: world3 } = await createWorld(mapping, {
      worldKey: 'w2-town-c', ownerUserId: ws3.userId, state: makeState(), userId: ws3.userId,
    });
    const s = await startSession(mapping, { userId: ws3.userId, worldRowId: world3, ...QUEST, now: T0 });
    const utter = (requestId, npcKey, text, opts) =>
      submitUtterance(mapping, { userId: ws3.userId, sessionRowId: s.sessionRowId, requestId, npcKey, text, now: T0 }, opts);
    await utter('c-1', 'nora', 'When is she free?');
    await utter('c-2', 'nora', 'Where should I meet her?');

    // The confirming utterance has its lease and is waiting on the model when the learner abandons.
    let release;
    const gate = new Promise((r) => { release = r; });
    const hanging = async (ctx) => { await gate; return ruleEvaluator(ctx); };
    const slow = utter('c-3', 'reed', 'Thursday at two in Lab B works for me.', { evaluate: hanging });
    await new Promise((r) => setTimeout(r, 50));
    const onCancelled = vi.fn();
    const ab = await abandonSession(mapping, { userId: ws3.userId, sessionRowId: s.sessionRowId, requestId: 'c-ab', now: T0 }, { onCancelled });
    expect(ab.session).toMatchObject({ status: 'abandoned', state_version: 3, goals_done: ['ask_time', 'ask_place'] });
    // The in-flight turn lost its lease inside the abandon transaction; the caller is told which.
    expect(ab.cancelled_turns).toHaveLength(1);
    // The reaper gets the full record; the caller gets the public projection of the same turn.
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(onCancelled.mock.calls[0][0].map((c) => c.id)).toEqual(ab.cancelled_turns.map((c) => c.id));
    expect(ab.cancelled_turns[0]).toEqual({ id: expect.any(Number), execution: null });
    release();
    const late = await slow;
    expect(late).toMatchObject({ status: 'stale', turn: { id: ab.cancelled_turns[0].id, processing_status: 'cancelled' } });

    expect(await rowsOf('sessions', 'AND id = ?', [s.sessionRowId])).toMatchObject([{ status: 'abandoned', goals_done: ['ask_time', 'ask_place'] }]);
    expect(await rowsOf('progress', `AND data->>'user_id' = ?`, [String(ws3.userId)])).toMatchObject([{ status: 'in_progress', xp: 0, attempts: 1, evidence_turn_id: null }]);
    const turns = await rowsOf('turns', `AND data->>'session_id' = ?`, [String(s.sessionRowId)]);
    expect(turns.map((t) => [t.input_name, t.processing_status])).toEqual([
      ['say', 'applied'], ['say', 'applied'], ['say', 'cancelled'], ['abandon_session', 'applied'],
    ]);
    expect(turns[2]).toMatchObject({ lease_token: null, result: { status: 'cancelled' } });
    // A replay of the cancelled request_id is a fresh attempt on a closed session, not a duplicate.
    await expect(utter('c-3', 'reed', 'Thursday at two in Lab B works for me.')).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
  }, SLOW);

  it('LLM adapter through the loop: a fake transport drives a turn; its version is recorded; bad output is a retryable failure', async () => {
    const s = await freshSession();
    const calls = [];
    const llm = createLlmEvaluator({
      model: 'fake-1',
      complete: async ({ system, user }) => { calls.push({ system, user }); return JSON.stringify(ruleEvaluator({ text: user })); },
    });
    const opts = { evaluate: llm.evaluate, evaluatorVersion: llm.evaluatorVersion };

    const t1 = await say(s.sessionRowId, 'nora', 'When is she free?', {}, opts);
    expect(t1).toMatchObject({ status: 'applied', turn: { evaluation: { goal_completed: 'ask_time' } } });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain('Nora Blake');
    expect(calls[0].user).toBe('When is she free?');
    const [turn] = await rowsOf('turns', `AND data->>'session_id' = ? AND data->>'input_number' = '0'`, [String(s.sessionRowId)]);
    expect(turn.evaluation).toMatchObject({ evaluator_version: 'llm-v1:fake-1', goal_completed: 'ask_time', intent: { name: 'ask_time' } });

    // The model answers prose instead of JSON: receipt stays retryable, nothing is applied; the retry with rules applies once.
    const broken = createLlmEvaluator({ model: 'fake-1', complete: async () => 'Sorry, I cannot help with that.' });
    const req = { userId: ws.userId, sessionRowId: s.sessionRowId, requestId: 'llm-bad', npcKey: 'nora', text: 'Where should I meet her?', now: T0 };
    await expect(submitUtterance(mapping, req, { evaluate: broken.evaluate, evaluatorVersion: broken.evaluatorVersion }))
      .rejects.toMatchObject({ code: 'EVALUATION_FAILED', status: 502 });
    expect(await rowsOf('turns', `AND data->>'request_id' = 'llm-bad'`)).toMatchObject([{ processing_status: 'failed', attempt: 1 }]);
    expect(await rowsOf('sessions', 'AND id = ?', [s.sessionRowId])).toMatchObject([{ state_version: 1 }]);
    const retry = await submitUtterance(mapping, { ...req, now: T0 + 1 });
    expect(retry).toMatchObject({ status: 'applied', turn: { evaluation: { goal_completed: 'ask_place' } } });
    expect(await rowsOf('turns', `AND data->>'request_id' = 'llm-bad'`)).toMatchObject([
      { processing_status: 'applied', attempt: 2, evaluation: { evaluator_version: 'rule-v1' } },
    ]);
  }, SLOW);

  it('learning turns never reach the engine step: stepWorld sees no pending inputs from the quest', async () => {
    const before = (await rowsOf('turns')).length;
    expect(before).toBeGreaterThan(0);
    const step = await stepWorld(mapping, worldId, T0, { random: () => 0.5 });
    expect(step.completedInputs).toEqual([]);
    expect(await listTurns(mapping, worldId)).toEqual([]); // engine turns are keyed by world_id; learning turns carry none
  }, SLOW);
});
