// Neo16 W2-S3 — the module's HTTP surface (doc 239900 §Runtime and Transaction Contract,
// "server command envelope"). Mounted by backend/modules/loader.js from module.manifest.yaml
// under /api/v3/neo16 behind core `authenticate`; core names nothing here.
//
//   POST /sessions                { data: { widget_id, request_id?, command: 'start_session',
//                                           payload: { quest_key, content_version } } }
//   POST /sessions/:id/commands   { data: { widget_id, session_id?, request_id, expected_version?,
//                                           command: 'say' | 'abandon_session', payload } }
//                                 say: { npc_key, text }   abandon_session: {} (durable close, W2-S4)
//   GET  /sessions/:id/state?widget_id=N
//
// The body never names the actor or a table: `user_id` is req.user (JWT/API key), and the
// table mapping is derived from the ACTIVE neo16 installation of the space that owns the
// widget — resolved by blueprint table NAME inside the installation's project, never from the
// widget's config (an editor can rewrite config; doc §Access). Not-found, not-installed and
// not-yours all answer 404 (no existence oracle). Every durable decision — receipt, lease,
// version, XP — lives in learning/questService.js; this file parses, authorizes, maps errors.

import express from 'express';
import { z } from 'zod';
import { dbGet, dbAll, safeJsonParse } from '../../database/connection.js';
import { hasPermission } from '../../services/EffectiveRoleService.js';
import { WIDGET_TAG_KEY, installModule, BlueprintError } from '../../services/ModuleInstaller.js';
import { success, error, unauthorized } from '../../utils/response.js';
import { apiLogger } from '../../utils/logger.js';
import { NEO16_BLUEPRINT } from './blueprint.js';
import { setupNpcAgents } from './setupNpcAgents.js';
import { ensureLearnerWorld } from './store/crmWorldStore.js';
import { defaultTownState } from './content/town.js';
import {
  startSession, submitUtterance, abandonSession, loadSessionState, QuestError, MAX_UTTERANCE_CHARS,
} from './learning/questService.js';
import { createAgentEvaluator, killCancelledRuns, AGENT_LEASE_MS } from './learning/agentRun.js';

import { getWorldSnapshot, applyWorldCommand } from './store/worldService.js';

const router = express.Router();

export const COMMANDS = Object.freeze(['start_session', 'say', 'abandon_session']);

const rowId = z.coerce.number().int().positive();
const machineKey = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

/** The envelope every POST body carries under `data`. Unknown keys are rejected. */
export const Envelope = z.object({
  widget_id: rowId,
  session_id: rowId.nullable().optional(),
  request_id: z.string().min(1).max(128).optional(),
  expected_version: z.number().int().nonnegative().nullable().optional(),
  command: z.enum(COMMANDS),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();

const StartPayload = z.object({ quest_key: machineKey, content_version: z.number().int().positive() }).strict();
const SayPayload = z.object({ npc_key: machineKey, text: z.string().trim().min(1).max(MAX_UTTERANCE_CHARS) }).strict();
const AbandonPayload = z.object({}).strict();

const notFound = () => new QuestError('widget not found', 'WIDGET_NOT_FOUND', 404);

/**
 * widget → space → active neo16 installation → table mapping, gated on the caller's
 * effective space role (viewer or better). Returns `{ widgetId, spaceId, mapping }`.
 */
async function resolveContext(widgetId, userId) {
  const row = await dbGet(
    `SELECT w.id, w.config, COALESCE(d.space_id, p.space_id) AS space_id, mi.project_id
       FROM widgets w
       JOIN dashboards d ON d.id = w.dashboard_id
       LEFT JOIN projects p ON p.id = d.project_id
       JOIN module_installations mi ON mi.space_id = COALESCE(d.space_id, p.space_id) AND mi.module_key = ? AND mi.status = 'active'
      WHERE w.id = ?`,
    [NEO16_BLUEPRINT.key, widgetId],
  );
  if (!row || safeJsonParse(row.config, {})?.[WIDGET_TAG_KEY]?.key !== NEO16_BLUEPRINT.key) throw notFound();
  if (!(await hasPermission(userId, 'viewer', { spaceId: row.space_id }))) throw notFound();

  const names = NEO16_BLUEPRINT.tables.map((t) => t.name);
  const tables = await dbAll(
    `SELECT id, name FROM universal_tables WHERE project_id = ? AND name IN (${names.map(() => '?').join(', ')})`,
    [row.project_id, ...names],
  );
  const byName = Object.fromEntries(tables.map((t) => [t.name, t.id]));
  const mapping = {};
  for (const t of NEO16_BLUEPRINT.tables) if (byName[t.name]) mapping[t.key] = { table_id: byName[t.name], name: t.name };
  return { widgetId: row.id, spaceId: row.space_id, mapping };
}

function fail(res, err, context) {
  if (err instanceof BlueprintError) return error(res, err.code, err.message, 409, err.details);
  if (err instanceof QuestError) return error(res, err.code, err.message, err.status, err.details ?? null);
  if (err instanceof z.ZodError) return error(res, 'VALIDATION_ERROR', 'invalid request', 400, err.flatten());
  apiLogger.error({ err, ...context }, '[neo16] request failed');
  return error(res, 'NEO16_INTERNAL', 'internal error', 500);
}

function actor(req, res) {
  const userId = Number(req.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    unauthorized(res, 'Authentication required');
    return null;
  }
  return userId;
}

// Owner-initiated setup for both existing URLs and newly created preset widgets.
const InstallWidget = z.object({ project_id: rowId.optional(), dry_run: z.boolean().default(false) }).strict();
router.post('/widgets/:id/install', async (req, res) => {
  const userId = actor(req, res);
  if (!userId) return;
  try {
    const widgetId = rowId.parse(req.params.id);
    const input = InstallWidget.parse(req.body?.data);
    const widget = await dbGet(
      `SELECT w.id, d.project_id, COALESCE(d.space_id, p.space_id) AS space_id
         FROM widgets w JOIN dashboards d ON d.id = w.dashboard_id
         LEFT JOIN projects p ON p.id = d.project_id WHERE w.id = ?`, [widgetId]
    );
    if (!widget || !(await hasPermission(userId, 'owner', { spaceId: widget.space_id }))) throw notFound();
    if (widget.project_id && input.project_id && Number(input.project_id) !== Number(widget.project_id)) {
      throw new QuestError('Module tables must stay in the widget project', 'PROJECT_NOT_WIDGET_PROJECT', 409);
    }
    const projectId = widget.project_id ?? input.project_id;
    if (!projectId) throw new QuestError('Select a project for module tables', 'PROJECT_REQUIRED', 400);
    const agentsArgs = { spaceId: widget.space_id, projectId, userId };
    const agentsPlan = await setupNpcAgents({ ...agentsArgs, dryRun: true });
    const installed = await installModule({ blueprint: NEO16_BLUEPRINT, spaceId: widget.space_id,
      projectId, userId, dryRun: input.dry_run, existingWidgets: { game: widgetId } });
    // Separate retriable transactions: a failed agent phase keeps the installed game/data.
    // Never uninstall to undo this; replaying this endpoint completes only missing setup.
    try {
      const npcAgents = input.dry_run ? agentsPlan : await setupNpcAgents(agentsArgs);
      return success(res, { ...installed, npc_agents: npcAgents });
    } catch (err) {
      apiLogger.error({ err, widgetId }, '[neo16] module installed; NPC setup incomplete');
      return error(res, 'NPC_SETUP_INCOMPLETE', 'Module installed; retry setup to complete NPC agents', 409,
        { module_installed: true, cause: err instanceof BlueprintError ? err.code : 'INTERNAL' });
    }
  } catch (err) { return fail(res, err, { userId, route: 'POST /widgets/:id/install' }); }
});

/** POST /sessions — start (or resume) the learner's session on a quest; their world is created on first use. */
router.post('/sessions', async (req, res) => {
  const userId = actor(req, res);
  if (!userId) return;
  try {
    const env = Envelope.parse(req.body?.data);
    if (env.command !== 'start_session' || env.session_id) {
      throw new QuestError('POST /sessions takes command "start_session" without session_id', 'COMMAND_NOT_ALLOWED', 400);
    }
    const payload = StartPayload.parse(env.payload);
    const { mapping } = await resolveContext(env.widget_id, userId);
    const { worldRowId } = await ensureLearnerWorld(mapping, { userId, worldKey: `learner-${userId}`, state: defaultTownState() });
    const started = await startSession(mapping, {
      userId, worldRowId, questKey: payload.quest_key, contentVersion: payload.content_version,
    });
    const state = await loadSessionState(mapping, { userId, sessionRowId: started.sessionRowId });
    return success(res, {
      session_id: started.sessionRowId, world_id: worldRowId, resumed: started.resumed, progress_id: started.progressRowId, state,
    }, started.resumed ? 200 : 201);
  } catch (err) {
    return fail(res, err, { userId, route: 'POST /sessions' });
  }
});

const STATUS_BY_RESULT = { applied: 200, duplicate: 200, processing: 202, stale: 409 };

/** POST /sessions/:id/commands — one command through the receipt/lease loop. */
router.post('/sessions/:id/commands', async (req, res) => {
  const userId = actor(req, res);
  if (!userId) return;
  try {
    const sessionRowId = rowId.parse(req.params.id);
    const env = Envelope.parse(req.body?.data);
    if (env.session_id != null && env.session_id !== sessionRowId) {
      throw new QuestError('data.session_id does not match the URL', 'SESSION_MISMATCH', 400);
    }
    if (env.command === 'start_session') {
      throw new QuestError('use POST /sessions to start a session', 'COMMAND_NOT_ALLOWED', 400);
    }
    if (!env.request_id) throw new QuestError('request_id is required for commands', 'REQUEST_ID_REQUIRED', 400);
    const { mapping, spaceId } = await resolveContext(env.widget_id, userId);
    const base = { userId, sessionRowId, requestId: env.request_id, expectedVersion: env.expected_version ?? null };

    let result;
    if (env.command === 'abandon_session') {
      AbandonPayload.parse(env.payload);
      // Cancelled runs are reaped after the durable close (contract 6.7), never before it.
      result = await abandonSession(mapping, base, { onCancelled: killCancelledRuns });
    } else {
      const payload = SayPayload.parse(env.payload);
      // The NPC is played by the CRM agent bound in this installation (learning/agentRun.js);
      // the lease covers the longest allowed run plus the kill margin.
      const run = createAgentEvaluator(mapping, { spaceId, npcKey: payload.npc_key });
      result = await submitUtterance(
        mapping,
        { ...base, npcKey: payload.npc_key, text: payload.text },
        { evaluate: run.evaluate, evaluatorVersion: run.evaluatorVersion, leaseMs: AGENT_LEASE_MS },
      );
    }
    return success(res, result, STATUS_BY_RESULT[result.status] ?? 200);
  } catch (err) {
    return fail(res, err, { userId, route: 'POST /sessions/:id/commands' });
  }
});

/** GET /sessions/:id/state?widget_id=N — everything a client needs to render or resume. */
router.get('/sessions/:id/state', async (req, res) => {
  const userId = actor(req, res);
  if (!userId) return;
  try {
    const sessionRowId = rowId.parse(req.params.id);
    const widgetId = rowId.parse(req.query.widget_id);
    const { mapping } = await resolveContext(widgetId, userId);
    return success(res, await loadSessionState(mapping, { userId, sessionRowId }));
  } catch (err) {
    return fail(res, err, { userId, route: 'GET /sessions/:id/state' });
  }
});

// World versions are independent of learning-session versions. GET never provisions.
const EnterWorld = z.object({ widget_id: rowId }).strict();
const WorldEnvelope = z.object({
  widget_id: rowId, request_id: z.string().min(1).max(128),
  expected_version: z.number().int().nonnegative(),
  command: z.enum(['move', 'heartbeat']), payload: z.record(z.string(), z.unknown()),
}).strict();

router.post('/worlds', async (req, res) => {
  const userId = actor(req, res);
  if (!userId) return;
  try {
    const env = EnterWorld.parse(req.body?.data);
    const { mapping } = await resolveContext(env.widget_id, userId);
    const { worldRowId, created } = await ensureLearnerWorld(mapping, {
      userId, worldKey: `learner-${userId}`, state: defaultTownState(),
    });
    return success(res, await getWorldSnapshot(mapping, { userId, worldRowId }), created ? 201 : 200);
  } catch (err) { return fail(res, err, { userId, route: 'POST /worlds' }); }
});

router.get('/worlds/:id', async (req, res) => {
  const userId = actor(req, res);
  if (!userId) return;
  try {
    const worldRowId = rowId.parse(req.params.id);
    const { mapping } = await resolveContext(rowId.parse(req.query.widget_id), userId);
    return success(res, await getWorldSnapshot(mapping, { userId, worldRowId }));
  } catch (err) { return fail(res, err, { userId, route: 'GET /worlds/:id' }); }
});

router.post('/worlds/:id/commands', async (req, res) => {
  const userId = actor(req, res);
  if (!userId) return;
  try {
    const worldRowId = rowId.parse(req.params.id);
    const env = WorldEnvelope.parse(req.body?.data);
    const { mapping } = await resolveContext(env.widget_id, userId);
    return success(res, await applyWorldCommand(mapping, {
      userId, worldRowId, requestId: env.request_id, expectedVersion: env.expected_version,
      command: env.command, payload: env.payload,
    }));
  } catch (err) { return fail(res, err, { userId, route: 'POST /worlds/:id/commands' }); }
});

export default router;
