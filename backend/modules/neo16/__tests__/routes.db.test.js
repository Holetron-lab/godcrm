// Neo16 W2-S3 — the HTTP envelope over the durable quest loop, on godcrm_test:
// the server derives actor and tables (never from the body), validates the command allowlist,
// text bounds and expected_version, reuses the receipt layer (duplicate → saved result, other
// payload → 409), closes a session durably on `abandon_session` (W2-S4), and fails CLOSED across
// users and spaces. Auth is the core middleware's job; here it is a stub that sets req.user
// exactly as `authenticate` does.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbGet, dbAll, dbRun, resetAdapter, destroyAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { installModule, uninstallModule } from '../../../services/ModuleInstaller.js';
import { createWidget } from '../../../services/WidgetService.js';
import { NEO16_BLUEPRINT } from '../blueprint.js';
import { stepWorld } from '../store/crmWorldStore.js';
import { ARRANGE_MEETING } from '../content/quests.js';
import { AGENT_BINDING_KIND, EVALUATOR_BINDING_KEY } from '../learning/agentRun.js';
import router, { COMMANDS } from '../routes.js';

const SLOW = 30_000;
const QUEST = { quest_key: ARRANGE_MEETING.content_key, content_version: ARRANGE_MEETING.content_version };

let currentUser = null;
const app = express();
app.use(express.json());
app.use('/api/v3/neo16', (req, _res, next) => { if (currentUser) req.user = currentUser; next(); }, router);

/** Two learners in two spaces, each with their own installation + widget. */
const tenants = [];
let seq = 0;

/** Explicit rule-only evaluator binding (AGENT_RUNTIME_CONTRACT §4): data, not a code fallback. */
const RULES_BINDING = {
  kind: AGENT_BINDING_KIND, content_key: EVALUATOR_BINDING_KEY, content_version: 1, title: 'rules', status: 'active', payload: { evaluator: 'rules' },
};

async function setupTenant(label) {
  const ws = await createEphemeralWorkspace({ label, table: false, dashboard: false });
  const installed = await installModule({ blueprint: NEO16_BLUEPRINT, spaceId: ws.spaceId, projectId: ws.projectId, userId: ws.userId });
  const binding = await dbRun('INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)', [
    installed.mapping.content.table_id, `binding-${label}`, JSON.stringify(RULES_BINDING), ws.userId,
  ]);
  return { ws, mapping: installed.mapping, widgetId: installed.widgets[0].widget_id, bindingRowId: binding.lastInsertRowid };
}

async function teardownTenant({ ws }) {
  await uninstallModule({ moduleKey: NEO16_BLUEPRINT.key, spaceId: ws.spaceId, purge: true, userId: ws.userId });
  await dbRun('DELETE FROM module_installations WHERE module_key = ? AND space_id = ?', [NEO16_BLUEPRINT.key, ws.spaceId]);
  await dbRun('DELETE FROM widgets WHERE dashboard_id IN (SELECT id FROM dashboards WHERE space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM dashboards WHERE space_id = ?', [ws.spaceId]);
  await ws.cleanup();
}

const as = (tenant) => { currentUser = { id: tenant.ws.userId, email: tenant.ws.email }; };
const start = (tenant, extra = {}) => request(app).post('/api/v3/neo16/sessions')
  .send({ data: { widget_id: tenant.widgetId, command: 'start_session', payload: QUEST, ...extra } });
const command = (tenant, sessionId, body) => request(app).post(`/api/v3/neo16/sessions/${sessionId}/commands`)
  .send({ data: { widget_id: tenant.widgetId, request_id: `r-${++seq}`, ...body } });
const say = (tenant, sessionId, npc_key, text, extra = {}) => command(tenant, sessionId, { command: 'say', payload: { npc_key, text }, ...extra });
const state = (tenant, sessionId, widgetId = tenant.widgetId) =>
  request(app).get(`/api/v3/neo16/sessions/${sessionId}/state`).query(widgetId == null ? {} : { widget_id: widgetId });
const rowsOf = (tenant, key, where = '', params = []) => dbAll(
  `SELECT id, data FROM table_rows WHERE table_id = ? ${where} ORDER BY id`, [tenant.mapping[key].table_id, ...params],
).then((rows) => rows.map((r) => ({ id: r.id, ...(typeof r.data === 'string' ? JSON.parse(r.data) : r.data) })));

beforeAll(async () => {
  await resetAdapter();
  // Doc 239900 §Verification: confirm the actual target before any write.
  const db = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(db.db).toMatch(/_test$/);
  expect([null, '127.0.0.1', '::1']).toContain(db.host);
  tenants.push(await setupTenant('neo16-s3-a'), await setupTenant('neo16-s3-b'));
}, SLOW);

afterAll(async () => {
  for (const t of tenants) await teardownTenant(t);
  await destroyAdapter();
}, SLOW);

describe('Neo16 W2-S3 — /api/v3/neo16 command envelope (godcrm_test)', () => {
  it('POST /sessions creates the learner world + session from the envelope; resume returns the same session', async () => {
    const [a] = tenants;
    as(a);
    const res = await start(a);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const { session_id, world_id, resumed, progress_id, state: st } = res.body.data;
    expect(resumed).toBe(false);
    expect(st.session).toMatchObject({ id: session_id, user_id: a.ws.userId, world_id, status: 'active', state_version: 0 });
    expect(st.quest).toMatchObject({ key: 'arrange_meeting', version: 1 });
    expect(st.progress).toMatchObject({ id: progress_id, status: 'in_progress', attempts: 1 });

    // The world is this learner's own, created server-side from the module's default town.
    expect(await rowsOf(a, 'worlds')).toMatchObject([{ id: world_id, owner_user_id: a.ws.userId, status: 'active' }]);
    const step = await stepWorld(a.mapping, world_id, 1_700_000_000_000);
    expect(step.stateVersion).toBe(1);

    const again = await start(a);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ session_id, world_id, resumed: true });
    expect(await rowsOf(a, 'worlds')).toHaveLength(1);

    const got = await state(a, session_id);
    expect(got.status).toBe(200);
    expect(got.body.data.session.id).toBe(session_id);
    expect(got.body.data.turns).toEqual([]);
  }, SLOW);

  it('say: expected_version gates new turns; duplicate request_id returns the saved result; another payload is 409', async () => {
    const [a] = tenants;
    as(a);
    const { session_id } = (await start(a)).body.data;

    const t1 = await say(a, session_id, 'nora', "When is Dr. Reed free? I didn't saw her yesterday.", { expected_version: 0 });
    expect(t1.status).toBe(200);
    expect(t1.body.data).toMatchObject({ status: 'applied', session: { state_version: 1, goals_done: ['ask_time'] } });
    expect(t1.body.data.turn.evaluation.grammar_errors[0]).toMatchObject({ corrected: "didn't see" });

    const stale = await say(a, session_id, 'nora', 'Where should I meet her?', { expected_version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const reqId = `dup-${++seq}`;
    const first = await say(a, session_id, 'nora', 'Where should I meet her?', { request_id: reqId, expected_version: 1 });
    expect(first.body.data).toMatchObject({ status: 'applied', session: { state_version: 2 } });
    // Same request_id + same payload, even with the (now old) expected_version: the saved result, no new turn.
    const replay = await say(a, session_id, 'nora', 'Where should I meet her?', { request_id: reqId, expected_version: 1 });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ status: 'duplicate', turn: { id: first.body.data.turn.id } });
    const mismatch = await say(a, session_id, 'nora', 'Something else entirely', { request_id: reqId });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('REQUEST_MISMATCH');

    // No expected_version → no optimistic check.
    const fin = await say(a, session_id, 'reed', 'Thursday at two in Lab B works for me.');
    expect(fin.body.data).toMatchObject({ status: 'applied', quest_completed: true, xp_awarded: 50 });

    expect((await rowsOf(a, 'turns', `AND data->>'session_id' = ?`, [String(session_id)])).map((t) => t.processing_status))
      .toEqual(['applied', 'applied', 'applied']);
    const got = await state(a, session_id);
    expect(got.body.data.session).toMatchObject({ status: 'completed', state_version: 3 });
    expect(got.body.data.progress).toMatchObject({ status: 'completed', xp: 50 });
  }, SLOW);

  it('abandon_session: durable close through the envelope; replay returns the saved result; the quest restarts', async () => {
    const [a] = tenants;
    as(a);
    const { session_id, progress_id } = (await start(a)).body.data; // the previous session completed → a new attempt
    await say(a, session_id, 'nora', 'When is she free?');
    const abandon = (body) => command(a, session_id, { command: 'abandon_session', payload: {}, ...body });

    const stale = await abandon({ request_id: 'ab-http', expected_version: 0 });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'VERSION_CONFLICT']);
    const ab = await abandon({ request_id: 'ab-http', expected_version: 1 });
    expect(ab.status).toBe(200);
    expect(ab.body.data).toMatchObject({ status: 'applied', session: { id: session_id, status: 'abandoned', state_version: 2 } });
    const replay = await abandon({ request_id: 'ab-http' });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ status: 'duplicate', turn: { id: ab.body.data.turn.id } });
    const closed = await say(a, session_id, 'nora', 'Where should I meet her?');
    expect([closed.status, closed.body.error.code]).toEqual([409, 'SESSION_CLOSED']);

    const got = await state(a, session_id);
    expect(got.body.data.session).toMatchObject({ status: 'abandoned', state_version: 2 });
    expect(got.body.data.turns.map((t) => t.command)).toEqual(['say', 'abandon_session']);
    expect(await rowsOf(a, 'turns', `AND data->>'session_id' = ?`, [String(session_id)])).toHaveLength(2);

    // A new session on the same quest: same progress row, one more attempt, no XP change.
    const again = await start(a);
    expect(again.status).toBe(201);
    expect(again.body.data.session_id).not.toBe(session_id);
    expect(again.body.data.state.progress).toMatchObject({ id: progress_id, status: 'completed', xp: 50, attempts: 3 });
    // Leave the learner on a clean active session for the next tests.
    expect((await abandon({ request_id: 'ab-http-2' })).status).toBe(409); // old session: still closed
    const fresh = await command(a, again.body.data.session_id, { command: 'abandon_session', payload: {} });
    expect(fresh.body.data.status).toBe('applied');
  }, SLOW);

  it('validates the envelope: command allowlist, payload shape, text bounds, URL/body session match; abandon payload is strict', async () => {
    const [a] = tenants;
    as(a);
    const { session_id } = (await start(a)).body.data; // the previous session was abandoned → a new attempt
    expect(COMMANDS).toEqual(['start_session', 'say', 'abandon_session']);

    const bad = async (p, code, status = 400) => {
      const res = await p;
      expect([res.status, res.body.error?.code]).toEqual([status, code]);
    };
    await bad(request(app).post('/api/v3/neo16/sessions').send({}), 'VALIDATION_ERROR');
    await bad(request(app).post('/api/v3/neo16/sessions').send({ data: { widget_id: a.widgetId, command: 'say', payload: QUEST } }), 'COMMAND_NOT_ALLOWED');
    await bad(start(a, { payload: { quest_key: 'Bad Key', content_version: 1 } }), 'VALIDATION_ERROR');
    await bad(start(a, { payload: { ...QUEST, extra: 1 } }), 'VALIDATION_ERROR');
    await bad(start(a, { payload: { quest_key: 'no_such_quest', content_version: 1 } }), 'QUEST_NOT_FOUND', 404);
    await bad(command(a, session_id, { command: 'dance', payload: {} }), 'VALIDATION_ERROR');
    await bad(command(a, session_id, { command: 'start_session', payload: QUEST }), 'COMMAND_NOT_ALLOWED');
    await bad(command(a, session_id, { command: 'say', payload: { npc_key: 'nora', text: 'hi' }, session_id: session_id + 1 }), 'SESSION_MISMATCH');
    await bad(request(app).post(`/api/v3/neo16/sessions/${session_id}/commands`)
      .send({ data: { widget_id: a.widgetId, command: 'say', payload: { npc_key: 'nora', text: 'hi' } } }), 'REQUEST_ID_REQUIRED');
    await bad(say(a, session_id, 'nora', 'x'.repeat(1001)), 'VALIDATION_ERROR');
    await bad(say(a, session_id, 'nora', '   '), 'VALIDATION_ERROR');
    await bad(say(a, session_id, 'bob', 'hi'), 'UNKNOWN_NPC', 422);
    await bad(command(a, session_id, { command: 'say', payload: { npc_key: 'nora', text: 'hi' }, user_id: 1 }), 'VALIDATION_ERROR');
    await bad(command(a, session_id, { command: 'abandon_session', payload: { reason: 'bored' } }), 'VALIDATION_ERROR');
    await bad(request(app).post(`/api/v3/neo16/sessions/${session_id}/commands`)
      .send({ data: { widget_id: a.widgetId, command: 'abandon_session', payload: {} } }), 'REQUEST_ID_REQUIRED');
    await bad(state(a, session_id, null), 'VALIDATION_ERROR');

    // None of the rejected calls wrote a turn.
    expect(await rowsOf(a, 'turns', `AND data->>'session_id' = ?`, [String(session_id)])).toEqual([]);
  }, SLOW);

  it('say fails closed without an agent binding: 409 AGENT_BINDING_MISSING with details, a failed receipt, no rule fallback (W2-S4 2c)', async () => {
    const [a] = tenants;
    as(a);
    const { session_id } = (await start(a)).body.data;
    await dbRun(`UPDATE table_rows SET data = data || '{"status":"disabled"}'::jsonb WHERE id = ?`, [a.bindingRowId]);
    try {
      const res = await say(a, session_id, 'nora', 'When is she free?', { request_id: 'nobind' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'AGENT_BINDING_MISSING', details: { npc_key: 'nora' } });
      expect(await rowsOf(a, 'turns', `AND data->>'request_id' = 'nobind'`)).toMatchObject([
        { processing_status: 'failed', attempt: 1, result: { code: 'AGENT_BINDING_MISSING' } },
      ]);
      expect(await rowsOf(a, 'sessions', 'AND id = ?', [session_id])).toMatchObject([{ state_version: 0, goals_done: [] }]);
    } finally {
      await dbRun(`UPDATE table_rows SET data = data || '{"status":"active"}'::jsonb WHERE id = ?`, [a.bindingRowId]);
    }
    // Binding restored → the same request_id is reclaimed and applied once.
    const retry = await say(a, session_id, 'nora', 'When is she free?', { request_id: 'nobind' });
    expect(retry.body.data).toMatchObject({ status: 'applied', turn: { evaluation: { goal_completed: 'ask_time' } } });
    expect(await rowsOf(a, 'turns', `AND data->>'request_id' = 'nobind'`)).toMatchObject([{ processing_status: 'applied', attempt: 2 }]);
    expect((await command(a, session_id, { command: 'abandon_session', payload: {} })).body.data.status).toBe('applied');
  }, SLOW);

  it('P2: no reply leaks the stored turn — duplicate `say`, abandon `cancelled_turns` and GET state carry the public projection only', async () => {
    const [a] = tenants;
    as(a);
    const { session_id } = (await start(a)).body.data;
    const reqId = `leak-${++seq}`;
    const first = await say(a, session_id, 'nora', 'When is she free?', { request_id: reqId });
    expect(first.status).toBe(200);
    const turnId = first.body.data.turn.id;
    // A full execution record as the agent runner writes it (pid, lease token, env snapshot, process identity).
    const secret = {
      pid: 424242, lease_token: 'LEASE-SECRET', proc_start_ticks: 123456, proc_boot_id: 'BOOT-SECRET', proc_exited: true,
      env_overrides_seen: { CLAUDE_FLEET_MODEL: 'ENV-SECRET', CODEX_CLI_MODEL: null }, spawned_at: 'SPAWN-SECRET', deadline_at: 'DEADLINE-SECRET',
      agent_row_id: 7, agent_user_id: 99, binding: 'evaluator', provider: 'codex', operator_id: 5,
      requested_model: 'gpt-6-astra', resolved_model: 'gpt-6-astra', model_source: 'requested', exit: 'ok', attempt: 1,
    };
    const publicView = { agent_row_id: 7, provider: 'codex', requested_model: 'gpt-6-astra', resolved_model: 'gpt-6-astra', model_source: 'requested', exit: 'ok', attempt: 1 };
    const leaks = ['LEASE-SECRET', 'BOOT-SECRET', 'ENV-SECRET', 'SPAWN-SECRET', 'DEADLINE-SECRET', '424242', 'request_hash', 'lease_until', 'proc_', 'agent_user_id'];
    await dbRun(`UPDATE table_rows SET data = jsonb_set(data, '{execution}', ?::jsonb) WHERE id = ?`, [JSON.stringify(secret), turnId]);

    const replay = await say(a, session_id, 'nora', 'When is she free?', { request_id: reqId });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ status: 'duplicate' });
    expect(replay.body.data.turn).toEqual({
      id: turnId, input_number: 0, command: 'say', npc_key: 'nora', text: 'When is she free?', processing_status: 'applied', attempt: 1,
      applied_version: 1, npc_response: expect.any(String), evaluation: expect.any(Object), execution: publicView,
    });
    for (const s of leaks) expect(JSON.stringify(replay.body), s).not.toContain(s);

    // An in-flight turn with a live lease and a full record (as a run on another server would leave it), then abandon over HTTP.
    const inflight = await dbRun('INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)', [
      a.mapping.turns.table_id, `inflight-${seq}`, JSON.stringify({
        world_id: null, session_id, request_id: `inflight-${seq}`, request_hash: 'h', input_number: 1, input_name: 'say', npc_key: 'reed', input_text: 'hi',
        received_ts: Date.now(), processing_status: 'processing', attempt: 1, lease_until: Date.now() + 60_000, lease_token: 'LEASE-SECRET',
        applied_version: null, response: null, evaluation: null, result: null, execution: { ...secret, exit: null, proc_exited: null },
      }), a.ws.userId,
    ]);
    await dbRun(`UPDATE table_rows SET data = data || '{"next_input_number":2}'::jsonb WHERE id = ?`, [session_id]);
    const ab = await command(a, session_id, { command: 'abandon_session', payload: {} });
    expect(ab.status).toBe(200);
    expect(ab.body.data).toMatchObject({ status: 'applied', session: { status: 'abandoned' } });
    expect(ab.body.data.cancelled_turns).toEqual([{ id: inflight.lastInsertRowid, execution: { ...publicView, exit: 'cancelled' } }]);
    for (const s of leaks) expect(JSON.stringify(ab.body), s).not.toContain(s);
    // The row itself keeps the full record for the reaper; only the wire is redacted.
    expect(await rowsOf(a, 'turns', 'AND id = ?', [inflight.lastInsertRowid])).toMatchObject([{ processing_status: 'cancelled', execution: { pid: 424242, exit: 'cancelled' } }]);

    const got = await state(a, session_id);
    expect(got.status).toBe(200);
    expect(got.body.data.turns.map((t) => [t.processing_status, t.execution?.exit ?? null])).toEqual([['applied', 'ok'], ['cancelled', 'cancelled'], ['applied', null]]);
    for (const s of leaks) expect(JSON.stringify(got.body), s).not.toContain(s);
  }, SLOW);

  it('fails closed across users and spaces: foreign widget, foreign session, untagged widget, unknown widget, no actor', async () => {
    const [a, b] = tenants;
    as(a);
    const sessionA = (await start(a)).body.data.session_id;
    as(b);
    const startedB = await start(b);
    expect(startedB.status).toBe(201);
    const sessionB = startedB.body.data.session_id;

    const closed = async (p, code) => {
      const res = await p;
      expect([res.status, res.body.error?.code]).toEqual([404, code]);
    };
    // b is not a member of a's space: a's widget does not exist for b.
    await closed(start(b, { widget_id: a.widgetId }), 'WIDGET_NOT_FOUND');
    await closed(say(a /* widget of a */, sessionA, 'nora', 'hi'), 'WIDGET_NOT_FOUND');
    await closed(state(b, sessionA, a.widgetId), 'WIDGET_NOT_FOUND');
    // b's own widget, a's session id: the session is not in b's tables → not found, no oracle.
    await closed(say(b, sessionA, 'nora', 'hi'), 'SESSION_NOT_FOUND');
    await closed(state(b, sessionA), 'SESSION_NOT_FOUND');
    // Nothing leaked into either tenant's tables.
    expect(await rowsOf(a, 'turns', `AND data->>'session_id' = ?`, [String(sessionA)])).toEqual([]);
    expect(await rowsOf(b, 'turns')).toEqual([]);

    as(a);
    await closed(state(a, sessionB), 'SESSION_NOT_FOUND');
    await closed(start(a, { widget_id: 999_999_999 }), 'WIDGET_NOT_FOUND');
    // A plain widget in a's own space is not a neo16 handle even though the installation exists.
    const dash = await dbGet('SELECT id FROM dashboards WHERE space_id = ? ORDER BY id LIMIT 1', [a.ws.spaceId]);
    const plain = await createWidget({ dashboard_id: dash.id, widget_type: 'preset', preset_name: 'table', title: 'plain', config: {}, created_by: a.ws.userId });
    await closed(start(a, { widget_id: plain.id }), 'WIDGET_NOT_FOUND');
    await dbRun('DELETE FROM widgets WHERE id = ?', [plain.id]);

    const before = { sessions: await rowsOf(a, 'sessions'), worlds: await rowsOf(a, 'worlds') };
    currentUser = null;
    const anon = await start(a);
    expect(anon.status).toBe(401);
    expect(await rowsOf(a, 'sessions')).toEqual(before.sessions);
    expect(await rowsOf(a, 'worlds')).toEqual(before.worlds);
  }, SLOW);
});
