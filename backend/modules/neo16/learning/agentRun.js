// Neo16 W2-S4 slice 2c (+ fix round) — the agent runner (AGENT_RUNTIME_CONTRACT.md §3–§7).
//
// An NPC turn is answered by a CRM AGENT (a row of the Agents table): its identity, operator,
// model, persona (`main_instructions`) and tool policy are the shared fleet's; Neo16 only owns
// WHICH agent plays which NPC (a `neo16_content` row of kind `agent_binding`) and the run record
// on the turn row (`neo16_turns.execution`). The shared CLI adapters are CALLED (with two additive
// options, `signal` and `permissionsFailClosed`), and the shared job dispatcher is not used at all
// — contract §2 lists the five conflicts.
//
// Process lifecycle rules (2c review, fix round):
//   * `jobId: null` to the adapters — a job id would become MCP_JOB_ID, and the MCP server drains
//     `agent_jobs.pending_invocations` of whatever LIVE job has that id (mcp-server.js:161).
//   * Tools are denied fail-CLOSED for NPC runs: the adapters get `permissionsFailClosed: true`,
//     which refuses AGENT_PERMS=bypass and makes the PreToolUse hook deny on every degraded path
//     (no token, resolver down, timeout, crash). `maxTurns: 1` additionally caps claude-code.
//   * The deadline is anchored to the LEASE (Phase A), not to the moment the agent was resolved:
//     binding/agent lookups and adapter preparation all spend the same budget, so a kill always
//     lands KILL_MARGIN_MS before the lease can be reclaimed.
//   * Cancellation reaches a run that has no pid yet: every live run is in `activeRuns`, and
//     `abandon` / reclaim abort its controller → the adapter refuses to spawn (AbortSignal) and a
//     spawn that raced the abort is killed on arrival.
//   * A pid is killed only when it is OUR process: identity = /proc start ticks + boot id (exact)
//     + a claude/codex argv. A recycled pid — even a newer foreign CLI — never matches.
//   * Kill ≠ stop: after a kill the runner waits for the process to actually disappear (SIGTERM,
//     then the shared SIGKILL at 5 s) before another attempt may spawn; a process that outlives
//     the wait makes the retry fail (`reap_failed`) instead of running two children on one turn.
//
// Every durable decision still belongs to questService: this file produces an `EvaluationSchema`
// object (or throws), and the Phase C fence decides whether it counts.

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dbAll } from '../../../database/connection.js';
import { resolveAgentUser } from '../../../services/agent-users.js';
import { resolveAgentProvider, detectProvider } from '../../../services/chat/agent-execution-shared/provider-resolution.js';
import { killProcessTree } from '../../../services/labs/ai-execution/process-management.js';
import { isAuthError } from '../../../services/agent-job/auth-error.js';
import { logAgentActivity } from '../../../services/AgentActivityLogger.js';
import { EvaluationSchema, RULE_EVALUATOR_VERSION, ruleEvaluator } from './evaluator.js';
import { buildPrompt, parseModelJson, LLM_EVALUATOR_VERSION } from './llmEvaluator.js';
import { QuestError, patchTurnExecution } from './questService.js';

export const AGENT_BINDING_KIND = 'agent_binding';
export const EVALUATOR_BINDING_KEY = 'evaluator';
/** Longest a learner waits for one NPC reply; the agent's own `run_timeout_min` can only shorten it. */
export const NEO16_MAX_RUN_MS = 90_000;
/** The kill fires this long before the lease can be reclaimed (contract §6). */
export const KILL_MARGIN_MS = 10_000;
export const AGENT_LEASE_MS = NEO16_MAX_RUN_MS + KILL_MARGIN_MS;

// Same expression as invocation-dispatcher `hasInvocationTokens`. Copied on purpose: the module
// must never import the dispatcher (contract 6.10) — a test pins that.
const INVOCATION_TOKEN_RE = /<<@[a-z0-9_-]+>>|<<\/[a-z][a-z0-9_-]*(?:\/\d+)?>>/i;

const parse = (d) => (typeof d === 'string' ? JSON.parse(d) : d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A run that did not produce a usable evaluation; `exit` is recorded on the turn (contract §5). */
export class RunError extends QuestError {
  constructor(exit, message) {
    super(message, 'EVALUATION_FAILED', 502);
    this.exit = exit;
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Binding: which agent answers for this NPC (contract §4)
// ---------------------------------------------------------------------------------------------

/**
 * NPC-specific binding first, then the installation's `evaluator` binding. Fails CLOSED: no row →
 * 409 `AGENT_BINDING_MISSING`, never a silent switch to rules. Rule-only mode is explicit data:
 * `payload = { evaluator: 'rules' }`.
 *
 * @returns {Promise<{kind:'rules', bindingKey:string} | {kind:'agent', bindingKey:string, agentRowId:number}>}
 */
export async function resolveBinding(mapping, npcKey) {
  const rows = await dbAll(
    `SELECT data FROM table_rows WHERE table_id = ? AND data->>'kind' = ? AND data->>'status' = 'active'
       AND data->>'content_key' IN (?, ?) ORDER BY (data->>'content_version')::int DESC`,
    [mapping.content.table_id, AGENT_BINDING_KIND, npcKey, EVALUATOR_BINDING_KEY],
  );
  const byKey = {};
  for (const r of rows) {
    const d = parse(r.data);
    byKey[d.content_key] ??= d; // highest version wins
  }
  const b = byKey[npcKey] ?? byKey[EVALUATOR_BINDING_KEY];
  if (!b) {
    throw new QuestError(
      `no agent is bound to NPC "${npcKey}" (add a neo16_content row: kind=${AGENT_BINDING_KIND}, content_key="${npcKey}" or "${EVALUATOR_BINDING_KEY}")`,
      'AGENT_BINDING_MISSING', 409, { npc_key: npcKey },
    );
  }
  const payload = b.payload ?? {};
  if (payload.evaluator === 'rules') return { kind: 'rules', bindingKey: b.content_key };
  const agentRowId = Number(payload.agent_row_id);
  if (!Number.isInteger(agentRowId) || agentRowId <= 0) {
    throw new QuestError(`binding "${b.content_key}" has no agent_row_id`, 'AGENT_BINDING_INVALID', 409, { binding: b.content_key });
  }
  return { kind: 'agent', bindingKey: b.content_key, agentRowId };
}

/**
 * Agent row → user → operator/model → provider flags, all through the shared resolvers, read-only.
 * Anything that is not an ACTIVE CLI agent is a configuration error the owner must see (409).
 */
export async function resolveBoundAgent(agentRowId, spaceId, deps = defaultDeps) {
  const agent = await deps.resolveAgentUser(agentRowId);
  if (!agent || agent.agentConfig?.status !== 'active') {
    throw new QuestError(`agent ${agentRowId} is missing or not active`, 'AGENT_BINDING_INVALID', 409, { agent_row_id: agentRowId });
  }
  const resolved = await deps.resolveAgentProvider(agent.agentConfig, { spaceId });
  const flags = deps.detectProvider(resolved.provider, resolved.model);
  if (!flags.isCliAgent) {
    throw new QuestError(
      `agent ${agentRowId} runs on provider "${resolved.provider}"; Neo16 needs a CLI agent (claude-code | codex)`,
      'AGENT_BINDING_INVALID', 409, { agent_row_id: agentRowId, provider: resolved.provider },
    );
  }
  const timeoutMin = Number(agent.agentConfig.run_timeout_min);
  const persona = typeof agent.agentConfig.main_instructions === 'string' ? agent.agentConfig.main_instructions.trim() : '';
  return {
    agentRowId,
    agentUserId: agent.userId,
    provider: flags.isCodex ? 'codex' : 'claude-code',
    operatorId: agent.agentConfig.operator_id ?? null,
    requestedModel: resolved.model,
    persona,
    runTimeoutMs: Number.isFinite(timeoutMin) && timeoutMin > 0 ? timeoutMin * 60_000 : null,
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Processes: identity, inspection, kill-and-wait (contract 6.3 / 6.7)
// ---------------------------------------------------------------------------------------------

let BOOT_ID = null;
function bootId() {
  if (BOOT_ID === null) {
    try { BOOT_ID = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { BOOT_ID = ''; }
  }
  return BOOT_ID;
}

/**
 * What the kernel says about a pid right now: liveness, argv and the process IDENTITY — start
 * time in clock ticks since boot (`/proc/<pid>/stat` field 22) plus the boot id. Within one boot
 * `(pid, start ticks)` names exactly one process, so a recycled pid can never be mistaken for the
 * child we spawned, whatever it runs. Not alive (or a zombie) → `{ alive: false }`.
 */
export async function inspectPid(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return { alive: false };
  try {
    const [stat, cmdline] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/cmdline`, 'utf8')]);
    // Fields after the parenthesised comm: index 0 = state (field 3), index 19 = starttime (field 22).
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (fields[0] === 'Z' || fields[0] === 'X') return { alive: false };
    const startTicks = Number(fields[19]);
    if (!Number.isInteger(startTicks)) return { alive: false };
    return { alive: true, args: cmdline.split('\0').filter(Boolean).join(' '), startTicks, bootId: bootId() };
  } catch {
    return { alive: false };
  }
}

/** The identity fields `inspectPid` reports, as stored on `execution` at spawn. */
const identityOf = (info) => ({ proc_start_ticks: info?.alive ? info.startTicks ?? null : null, proc_boot_id: info?.alive ? info.bootId ?? null : null });

function isCliArgv(args) {
  const codexBin = String(process.env.CODEX_CLI_BIN || 'codex').split('/').pop();
  return args.split(/\s+/).slice(0, 3).some((arg) => {
    const base = arg.split('/').pop();
    return /^(claude|codex)(\.m?js|\.cjs)?$/i.test(base) || base === codexBin;
  });
}

/** Exact identity match: same start ticks AND same boot as recorded at spawn. No identity recorded → never. */
function sameProcess(info, execution) {
  const ticks = Number(execution?.proc_start_ticks);
  const boot = execution?.proc_boot_id;
  return Number.isInteger(ticks) && typeof boot === 'string' && boot !== '' && info.startTicks === ticks && info.bootId === boot;
}

/**
 * True only when the live process IS the one recorded on the execution: a claude/codex argv and
 * the exact start-ticks + boot-id identity captured right after spawn. A pid recycled by a later
 * process — including a newer foreign CLI — differs in start ticks and is left alone. This box
 * runs PM2 and live chat workers.
 */
export function isOurCliProcess(info, execution) {
  if (!info?.alive || typeof info.args !== 'string') return false;
  return isCliArgv(info.args) && sameProcess(info, execution);
}

/** Poll until `stillLive(info)` is false or the reap timeout passes. @returns {Promise<boolean>} exited */
async function waitForExit(pid, stillLive, d) {
  const until = Date.now() + d.reapTimeoutMs;
  for (;;) {
    if (!stillLive(await d.inspectPid(pid))) return true;
    if (Date.now() >= until) return false;
    await sleep(d.pollMs);
  }
}

/** Runs alive in THIS server process, by turn id: the only way to cancel a run that has no pid yet. */
const activeRuns = new Map(); // turn id → Set<run>
const runsOf = (turnId) => activeRuns.get(Number(turnId)) ?? new Set();

/**
 * Make sure nothing of a previous attempt is still executing before a new attempt spawns
 * (contract 6.3: one live process per turn). In-process runs are aborted and awaited (their own
 * abort path kills and waits); a detached orphan (server restarted in between) is matched by exact
 * identity, killed, and awaited until it is gone. A process that outlives the wait throws
 * `reap_failed` — the retry must not spawn alongside it.
 *
 * @param {object} execution  the previous attempt's record (pid, identity, turn_id)
 * @param {object} [deps]
 * @param {object} [except]   the calling run (never reaps itself)
 * @returns {Promise<boolean>} true when something was stopped
 */
export async function reapExecution(execution, deps = defaultDeps, except = null) {
  const d = { ...defaultDeps, ...deps };
  const inProcess = [...runsOf(execution?.turn_id)].filter((r) => r !== except);
  for (const run of inProcess) run.controller.abort('reclaimed');
  const outcomes = await Promise.all(inProcess.map((run) => run.done));
  if (outcomes.some((o) => o.exited === false)) {
    throw new RunError('reap_failed', `previous attempt's process is still alive after kill; refusing to spawn a second one`);
  }
  let stopped = inProcess.length > 0;

  const pid = Number(execution?.pid);
  if (!Number.isInteger(pid) || pid <= 1) return stopped;
  if (!isOurCliProcess(await d.inspectPid(pid), execution)) return stopped; // dead, recycled, or not ours
  d.kill(pid);
  stopped = true;
  if (!(await waitForExit(pid, (info) => isOurCliProcess(info, execution), d))) {
    throw new RunError('reap_failed', `previous attempt's process ${pid} is still alive after kill; refusing to spawn a second one`);
  }
  return stopped;
}

/**
 * `abandonSession` → `opts.onCancelled`: stop every cancelled turn's run. In-process runs are
 * aborted (no spawn if none yet; kill + wait inside the run); detached orphans are killed after
 * the identity check. Best effort, after the durable close — the decision never depends on it.
 */
export async function killCancelledRuns(turns, deps = defaultDeps) {
  const d = { ...defaultDeps, ...deps };
  let stopped = 0;
  for (const t of turns ?? []) {
    const runs = runsOf(t.id);
    for (const run of runs) { run.controller.abort('cancelled'); stopped++; }
    if (runs.size) continue;
    const pid = Number(t.execution?.pid);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    const info = await d.inspectPid(pid).catch(() => ({ alive: false }));
    if (isOurCliProcess(info, t.execution)) { d.kill(pid); stopped++; }
  }
  return stopped;
}

// ---------------------------------------------------------------------------------------------
// 3. The run
// ---------------------------------------------------------------------------------------------

export const defaultDeps = Object.freeze({
  resolveAgentUser,
  resolveAgentProvider,
  detectProvider,
  // Loaded on first real run only: vitest injects fakes and never pulls the CLI adapters in.
  adapters: Object.freeze({
    'claude-code': async (params) => (await import('../../../services/labs/ai-execution/cli-providers.js')).executeClaudeCode(params),
    codex: async (params) => (await import('../../../services/labs/ai-execution/cli-providers.js')).executeCodexCli(params),
  }),
  kill: (pid) => killProcessTree(pid),
  inspectPid,
  logActivity: logAgentActivity,
  maxRunMs: NEO16_MAX_RUN_MS,
  /** How long a kill may take to become an exit: the shared killProcessTree escalates to SIGKILL at 5 s. */
  reapTimeoutMs: 7_000,
  pollMs: 100,
  beforeSpawn: null, // test seam: a throw here is "crash between receipt and spawn" (contract 6.2)
});

function classify(err) {
  if (err instanceof RunError) return err;
  const exit = err?.code === 'ENOENT' || /spawn/i.test(String(err?.message)) ? 'spawn_error' : 'adapter_error';
  return new RunError(exit, String(err?.message ?? err));
}

/**
 * One attempt's control block: an AbortController whose timer is armed from the LEASE the moment
 * the evaluator is entered (before any lookup), registered in `activeRuns` so a cancel can reach
 * it before a pid exists. `shorten` lets the resolved agent's `run_timeout_min` / the module cap
 * bring the deadline closer, never later.
 */
function openRun(turn, d) {
  const controller = new AbortController();
  let finish;
  const done = new Promise((r) => { finish = r; });
  const armedAt = Date.now();
  const leaseEnd = Number(turn?.leaseStartedAt) + Number(turn?.leaseMs);
  let deadlineAt = Number.isFinite(leaseEnd) ? leaseEnd - KILL_MARGIN_MS : armedAt + d.maxRunMs;
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort('timeout'), Math.max(0, deadlineAt - Date.now()));
    timer.unref?.();
  };
  arm();
  const run = {
    turnId: Number.isInteger(Number(turn?.id)) ? Number(turn.id) : null,
    controller,
    signal: controller.signal,
    done,
    get deadlineAt() { return deadlineAt; },
    budgetMs: () => deadlineAt - armedAt,
    shorten(ms) {
      if (Number.isFinite(ms) && Date.now() + ms < deadlineAt) { deadlineAt = Date.now() + ms; arm(); }
    },
    abortError() {
      const reason = controller.signal.reason;
      return reason === 'timeout'
        ? new RunError('timeout', `agent run exceeded ${run.budgetMs()} ms`)
        : new RunError('cancelled', `run ${reason ?? 'cancelled'} before it could commit`);
    },
    /** Set by the run after an abort: did the child actually exit within the reap window? */
    exited: null,
    close() {
      clearTimeout(timer);
      if (run.turnId != null) {
        const set = activeRuns.get(run.turnId);
        set?.delete(run);
        if (set && set.size === 0) activeRuns.delete(run.turnId);
      }
      finish({ exited: run.exited });
    },
  };
  if (run.turnId != null) {
    if (!activeRuns.has(run.turnId)) activeRuns.set(run.turnId, new Set());
    activeRuns.get(run.turnId).add(run);
  }
  return run;
}

async function runAgent(mapping, ctx, agent, { spaceId, binding }, d, run) {
  const { turn, text } = ctx;
  const { signal } = run;
  const prompt = buildPrompt(ctx);
  const systemPrompt = agent.persona ? `${agent.persona}\n\n${prompt.system}` : prompt.system;
  const t0 = Date.now();

  // Contract §5 — the record that makes a run attributable; grows at spawn and at exit.
  const rec = {
    attempt: turn.attempt,
    agent_row_id: agent.agentRowId,
    agent_user_id: agent.agentUserId,
    binding: binding.bindingKey,
    space_id: spaceId,
    learner_user_id: turn.userId,
    session_id: turn.sessionRowId,
    turn_id: turn.id,
    request_id: turn.requestId,
    lease_token: turn.leaseToken,
    provider: agent.provider,
    operator_id: agent.operatorId,
    requested_model: agent.requestedModel,
    resolved_model: null,
    model_source: null,
    env_overrides_seen: { CLAUDE_FLEET_MODEL: process.env.CLAUDE_FLEET_MODEL ?? null, CODEX_CLI_MODEL: process.env.CODEX_CLI_MODEL ?? null },
    pid: null,
    proc_start_ticks: null,
    proc_boot_id: null,
    proc_exited: null,
    spawned_at: null,
    deadline_at: null,
    finished_at: null,
    exit: null,
  };
  // Writes of the record are SERIALISED: the spawn patch is fired from a callback and the exit
  // patch follows; on a pool, two independent UPDATEs may land in either order, and a late spawn
  // snapshot (exit: null) must never overwrite the exit. Snapshot at call time, apply in order.
  let writes = Promise.resolve(false);
  const record = (patch) => {
    const snapshot = { ...patch };
    writes = writes.then(() => patchTurnExecution(mapping, turn.id, turn.leaseToken, snapshot), () => false)
      .catch(() => false);
    return writes;
  };

  let identity = Promise.resolve();
  const onSpawn = (pid) => {
    const now = new Date();
    Object.assign(rec, { pid, spawned_at: now.toISOString(), deadline_at: new Date(run.deadlineAt).toISOString() });
    // Capture the identity while the child is certainly alive (the read STARTS synchronously, right
    // inside the spawn callback); the record follows in order.
    identity = Promise.resolve(d.inspectPid(pid))
      .then((info) => Object.assign(rec, identityOf(info)), () => {})
      .then(() => record(rec));
    // A spawn that raced the abort (adapter ignored the signal): nothing may run past the deadline.
    if (signal.aborted) d.kill(pid);
  };

  let error = null;
  let result = null;
  let evaluation = null;
  try {
    if (d.beforeSpawn) await d.beforeSpawn(rec);
    if (signal.aborted) throw run.abortError();
    const execute = d.adapters[agent.provider];
    const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(run.abortError()), { once: true }));
    result = await Promise.race([
      execute({
        model: agent.requestedModel,
        messages: [{ role: 'user', content: text }], // learner text is a USER message, never system
        systemPrompt,
        maxTurns: 1,
        agentId: agent.agentRowId,
        spaceId,
        jobId: null,
        signal,
        permissionsFailClosed: true,
        onSpawn,
      }),
      aborted,
    ]);
    if (isAuthError(result?.content)) throw new RunError('auth_error', 'CLI reported an authentication error');
    let parsed;
    try {
      parsed = EvaluationSchema.parse(parseModelJson(result?.content));
    } catch (e) {
      throw new RunError('invalid_output', `model output is not a valid evaluation: ${String(e.message).slice(0, 200)}`);
    }
    if ([parsed.npc_response, ...parsed.feedback.map((f) => f.message)].some((s) => INVOCATION_TOKEN_RE.test(s))) {
      throw new RunError('invalid_output', 'model output contains an invocation token');
    }
    evaluation = parsed;
  } catch (err) {
    error = signal.aborted && !result ? run.abortError() : classify(err);
  } finally {
    // Kill ≠ stop: after an abort, wait until the child is really gone (bounded by reapTimeoutMs)
    // so the next attempt never spawns beside it. Identity (when captured) is the match; a pid
    // we spawned moments ago and never identified is matched by liveness alone.
    if (signal.aborted && !result) {
      await identity;
      if (rec.pid) {
        d.kill(rec.pid);
        const stillLive = (info) => (rec.proc_start_ticks != null ? info?.alive === true && sameProcess(info, rec) : info?.alive === true);
        rec.proc_exited = await waitForExit(rec.pid, stillLive, d);
        run.exited = rec.proc_exited;
      }
    }
  }

  const resolvedModel = result?.model ?? null;
  Object.assign(rec, {
    finished_at: new Date().toISOString(),
    exit: error ? error.exit : 'ok',
    resolved_model: resolvedModel,
    model_source: result?.modelSource ?? null,
    usage: result?.usage ? { promptTokens: result.usage.promptTokens ?? 0, completionTokens: result.usage.completionTokens ?? 0 } : null,
    cost_usd: result?.costUsd ?? 0,
    evaluator_version: `${LLM_EVALUATOR_VERSION}:${resolvedModel ?? agent.requestedModel}`,
    error: error ? error.message.slice(0, 300) : null,
  });
  // Guarded by the lease token: a late attempt cannot overwrite the live one's record (6.4).
  await identity;
  const recorded = await record(rec);

  await d.logActivity({
    agent_id: agent.agentRowId,
    action: error ? 'task_failed' : 'task_completed',
    details: `[neo16 s:${turn.sessionRowId} t:${turn.id} a:${turn.attempt}] ${rec.exit} provider=${agent.provider} ` +
      `model=${resolvedModel ?? agent.requestedModel} (${rec.model_source ?? 'requested'})${recorded ? '' : ' stale-record'}` +
      (rec.proc_exited === false ? ' process-still-alive' : ''),
    success: !error,
    duration_ms: Date.now() - t0,
    tokens_used: rec.usage ? rec.usage.promptTokens + rec.usage.completionTokens : undefined,
    cost_usd: rec.cost_usd,
    error_message: error ? error.message : undefined,
  }).catch(() => { /* telemetry never decides anything */ });

  if (error) throw error;
  return { evaluation, resolvedModel };
}

/**
 * The evaluator `submitUtterance` runs in Phase B for one (NPC, learner) turn. Resolution is
 * lazy — binding and agent are read when the turn actually runs — so a replay of an already
 * applied receipt never depends on today's configuration. The deadline, however, is armed first
 * thing from the lease (`ctx.turn.leaseStartedAt` + `leaseMs` − KILL_MARGIN_MS), so resolution
 * and adapter preparation cannot push the kill past the lease.
 *
 * @param {object} mapping  provisioner mapping of the installation
 * @param {{ spaceId:number, npcKey:string }} scope  the installation's space and the NPC addressed
 * @param {object} [deps]   test seams (fake adapters, fake pid registry, kill spy); see `defaultDeps`
 * @returns {{ evaluate:(ctx:object)=>Promise<object>, evaluatorVersion:()=>string }}
 */
export function createAgentEvaluator(mapping, { spaceId, npcKey }, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  let version = RULE_EVALUATOR_VERSION;
  return {
    evaluatorVersion: () => version,
    async evaluate(ctx) {
      const run = openRun(ctx.turn, d);
      try {
        const binding = await resolveBinding(mapping, npcKey);
        if (binding.kind === 'rules') {
          version = RULE_EVALUATOR_VERSION;
          return ruleEvaluator(ctx);
        }
        // The hook is the only tool guard for codex; a host running with AGENT_PERMS=bypass has none.
        if ((process.env.AGENT_PERMS || '').toLowerCase() === 'bypass') {
          throw new QuestError('AGENT_PERMS=bypass is set on this host; NPC runs require the permission hook', 'AGENT_POLICY_UNAVAILABLE', 409, { reason: 'AGENT_PERMS=bypass' });
        }
        const agent = await resolveBoundAgent(binding.agentRowId, spaceId, d);
        version = `${LLM_EVALUATOR_VERSION}:${agent.requestedModel}`;
        run.shorten(Math.min(agent.runTimeoutMs ?? Infinity, d.maxRunMs));
        // One live process per turn (6.3): the previous attempt must be GONE before we spawn.
        if (ctx.turn?.previousExecution) await reapExecution(ctx.turn.previousExecution, d, run);
        if (run.signal.aborted) throw run.abortError();
        const out = await runAgent(mapping, ctx, agent, { spaceId, binding }, d, run);
        version = `${LLM_EVALUATOR_VERSION}:${out.resolvedModel ?? agent.requestedModel}`;
        return out.evaluation;
      } finally {
        run.close();
      }
    },
  };
}
