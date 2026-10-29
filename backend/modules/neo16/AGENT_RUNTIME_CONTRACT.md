# Neo16 × CRM agent runtime — job / result / cancellation contract (W2-S4 slice 2b)

Status: **implemented in slice 2c** (`learning/agentRun.js`, bindings, lease/kill, tests §9)
after the orchestrator's review of 2b (doc 239900 row 240420), **revised in the fix round after
the architect's CHANGES review of `688d42b5`** (five items, see "Fix round" below). Shared
runtime: the two CLI adapters gained two optional, additive parameters (`signal`,
`permissionsFailClosed`) and the permission hook an opt-in fail-closed mode; nothing else is
changed. Source of direction: doc 239900 §"Owner Decision — Reuse CRM Agent Runtime
(2026-10-04)" (table 100864 rows 240408/240409). Verified against worktree
`/root/wt-neo16-w2s4-developer-ralph` (`feat/neo16-w2s4-developer-ralph`, base `main`
`da1ec6cf`) on 2026-10-04. GitNexus index is at `932e66b8` (2 commits behind); every line
reference below was re-read from source, the index was used only for upstream blast radius.

### Review conditions accepted for 2c (orchestrator, 2026-10-04) — binding on the implementation

1. **`jobId: null` to both adapters.** §8 of the 2b draft proposed `jobId = turn row id` for
   `MCP_JOB_ID`. Rejected: after every tool call the MCP server runs
   `takeJobMessages(context.jobId)` (`backend/mcp-server.js:161`), which reads
   `agent_jobs WHERE id = $1 FOR UPDATE` and drains `pending_invocations` of a LIVE job with that
   id. A turn id colliding with a stranger's live job would pull their chat messages into an NPC
   run. `agentRun.js` passes `jobId: null`; the claude adapter then sets no `MCP_JOB_ID`, the codex
   adapter binds an empty one (`Number('') || null` → no inbox).
2. **`maxTurns: 1` protects claude-code only.** The codex adapter has no turn cap. For a codex NPC
   the guards are: the agent row's deny policy through the shared PreToolUse hook (same script,
   codex dialect: deny is honoured verbatim), **the hook's fail-closed mode for NPC spawns**
   (fix round P1-1), and the run deadline. Proven by `__tests__/agent-permission-hook.codex.db.test.js`
   on two layers against the REAL `/api/v3/agent-permissions/check` router on a throw-away local
   port: (a) the REAL hook script as a child, both dialects — a `_command_policies` deny-all row
   → deny JSON for an MCP tool and for Bash, and with `AGENT_PERMS_FAIL_CLOSED=1` every degraded
   path (no token, unreachable, non-2xx, timeout, crash, bad stdin) → deny; (b) the REAL
   `executeCodexCli` spawning a stand-in `codex` (`__tests__/fixtures/fake-codex-cli.mjs`) that
   implements the CLI's PreToolUse protocol — the tool call is observed BLOCKED on disk (its
   marker file is never written) for the policy agent, and for any agent while the resolver is
   down; the policy-less control agent's tool runs. An agent without the row gets silence
   (= allow) while the resolver is up. **Consequence: every NPC agent row must carry a deny-all
   policy** — the runner cannot add one for it. `AGENT_PERMS=bypass` is refused for NPC runs by
   the adapter (`permissionsFailClosed`) and answered `409 AGENT_POLICY_UNAVAILABLE` by the runner.
3. **Kill by pid only after inspection — of the exact process.** Before `kill` on reclaim (6.3)
   or cancel (6.7), `inspectPid` (`/proc/<pid>/stat` + `cmdline`) must show a live process whose
   argv is a `claude`/`codex` CLI **and whose start ticks and boot id equal the identity captured
   at spawn** (`execution.proc_start_ticks`, `execution.proc_boot_id`). Within one boot
   `(pid, start ticks)` names exactly one process, so a recycled pid — including a NEWER foreign
   CLI — never matches and is left alone (fix round P1-2; the 2c rule "not older than
   `spawned_at` − 2 s" was wrong and is withdrawn). A record without identity is never killed.
   The in-process deadline/cancel kill (6.5/6.7) targets the pid the adapter reported while its
   promise is still pending, so it needs no argv check; it still waits for the exit (condition 4).
4. **Kill ≠ stop (fix round P1-4).** After any kill the runner waits until the process is gone
   (poll `inspectPid`, window `reapTimeoutMs` = 7 s ≥ the shared SIGTERM→SIGKILL escalation at
   5 s) before a new attempt may spawn. A survivor makes the reclaim fail (`reap_failed`, 502,
   retryable) and leaves the previous record (pid, identity) on the row for the next retry.
5. **Nothing spawns after the deadline or a cancel (fix round P1-3).** Every live run holds an
   AbortController registered in-process by turn id. Its timer is armed from the LEASE
   (`leaseStartedAt + leaseMs − KILL_MARGIN_MS`) when the evaluator is entered — before binding and
   agent lookups — and only shortened by the agent's `run_timeout_min` / the module cap. Reclaim
   and `abandon_session` abort the controller; the adapters receive the signal and refuse to spawn
   once it is aborted (checked immediately before `fork`), a spawn that still arrives is killed
   on report, and an attempt that lost its lease is answered `stale`, not `failed`.

## 0. Decision in one paragraph

An NPC/evaluator run reuses the CRM agent **identity, configuration, provider resolution,
tool policy and CLI adapters**, but it does **not** go through `createAndDispatchJob`.
The integration point is one level lower: `resolveAgentUser` → `resolveAgentProvider` +
`detectProvider` → `executeClaudeCode | executeCodexCli`, called by a Neo16-owned runner
(`learning/agentRun.js`, to be written in slice 2c). The durable record of a run is the
**Neo16 turn row** (`neo16_turns.execution`), not an `agent_jobs` row. Reasons are in §2;
every one of them is a hard conflict in the shared dispatcher, not a preference.

Calling a shared symbol is not modifying it. Slice 2c needs **zero edits** to
`createAndDispatchJob` (CRITICAL), `processJobLocally` (HIGH), `resolveAgentProvider`
(HIGH), `detectProvider` (CRITICAL), `reserveAgentJob` (HIGH), `finishOrContinueJob`
(HIGH) or the CLI adapters (`executeClaudeCode` HIGH, `executeCodexCli` LOW). Two optional
additive changes are listed in §8 and are **not** part of 2c unless approved.

## 1. Verified facts about the shared path (what the contract is built on)

| Fact | Where |
|---|---|
| `agent_jobs.conversation_id` and `agent_row_id` are `NOT NULL`; admission locks the `conversations` row `FOR UPDATE` and throws without one | `deploy/selfhost/schema.sql:432-456`, `backend/services/agent-job/single-active.js:5-19` |
| Single-active is keyed on `(conversation, agent)`; a second input while a job is live becomes `pending_invocations` and is **continued on the same job** after the CLI exits | `single-active.js:10-18`, `create.js:670-686` |
| `processJobLocally` loads chat history, writes every step and the final text into `messages` via `saveStepMessage`, and runs the invocation dispatcher on thinking, streamed text and final text | `create.js:225`, `:339-430`, `:622-642` |
| Failure path retries the same job up to `MAX_ATTEMPTS=3` with a 5 s delay; startup recovery re-dispatches with a "[SYSTEM CONTINUATION …]" prompt; watchdog kills jobs past `timeout_at` (120 min) | `create.js:827-838`, `lifecycle.js:289-327`, `watchdog.js:60-93`, `shared.js:23` |
| CLI adapters take `{ model, messages, systemPrompt, maxTurns, onEvent, onSpawn, agentId, spaceId, jobId }` and return `{ content, usage, model, requestedModel, modelSource, finishReason, costUsd }`; hard timeout 120 min inside the adapter | `cli-providers.js:30-31`, `:356-369`, `:594-595`, `:838-854`, `:857-864` |
| `executeClaudeCode`: `--max-turns` (default 100), PreToolUse permission hook + Stop reservation hook via `--settings`, `AGENT_ID`/`SPACE_ID`/`MCP_JOB_ID` in child env, model from `system/init` event (`modelSource: cli_init`), else `cli_result`, else `requested` | `cli-providers.js:98-116`, `:152-153`, `:182-186`, `:232-255`, `:340-346` |
| `executeCodexCli`: same hooks via `-c hooks.*`, `--approve-for-me`, MCP env bound per job, `-o` last-message file, model is **never** echoed back → `modelSource: 'requested'` always | `cli-providers.js:633-665`, `:838-854` |
| Model precedence: `CLAUDE_FLEET_MODEL` (default **`opus`**, not `auto`) overrides the stored model for every claude-code run; `CODEX_CLI_MODEL` overrides, else only `gpt-6-astra` is forwarded | `cli-providers.js:127-137`, `:659-664` |
| Codex worktree allocation only for `CODE_ROLES` slugs in space 11 on .128 → NPC agents in space 70 get **no** worktree | `codex-workspace.js:18-24` |
| `resolveAgentProvider(agentConfig, { spaceId, modelIdOverride })` is a pure read: operator row → key/provider, numeric `model` → Models row `model_id`; `isLocal` for `claude-code`/`codex` | `provider-resolution.js:33-174` |
| `resolveAgentUser(rowId)` → `{ userId, agentRowId, agentConfig, user }` | `agent-users.js:261` |
| Agents table 1784 carries `operator_id`, `model`, `main_instructions`, `crm_instructions`, `max_tokens`, `max_iterations`, `default_budget_json`, `run_timeout_min` (1..180, no consumer in this tree yet) | `get_table_schema(1784)`, grep `run_timeout_min` = 0 hits in `backend/` |
| Invocation tokens are only dispatched by `_maybeDispatchFromAgentText` (agent-job) and `_maybeDispatchFromThinking` (agent-loop); detector regex `hasInvocationTokens` | `create.js:30-42`, `invocation-dispatcher.js:250-253` |
| `logAgentActivity` is a chat-independent telemetry sink (table 1701) | `AgentActivityLogger.js:66` |
| `killProcessTree`, `trackChildProcess`, `untrackChildProcess` are exported; adapters already track every child | `process-management.js:21,134,142` |

## 2. Why not `createAndDispatchJob` (five hard conflicts)

1. **Needs a conversation.** NOT NULL column + `FOR UPDATE` on `conversations`. A Neo16 run has
   a learner/session/turn, not a conversation. Creating a hidden conversation per learner only
   to satisfy the row makes every other conflict below real.
2. **Writes game dialogue into chat history.** Steps, thinking and the final JSON land in
   `messages`; the acceptance gate forbids game dialogue in unrelated chat history.
3. **Dispatches invocation tokens from model output.** Final text, streamed text and thinking
   are all scanned; a learner typing `<<@orchestrator>>` to an NPC would reach the fleet.
4. **Continuation and retry contradict the receipt.** A second `say` during a live run is
   appended as `pending_invocations` and continued on the *same* job (one attempt, two
   turns); the catch path re-runs the same job 3× with a 5 s gap (late results with no
   lease fence); startup recovery re-dispatches with a continuation prompt that breaks the
   structured-output contract.
5. **120-minute timeout vs. a 30-second lease.** Neither the adapter timeout nor the
   watchdog is tunable per run; the lease would be reclaimed ~240× before the job gave up.

Making the dispatcher generic (a `kind`/result-sink option that skips chat writes, history,
dispatch, continuation and retry) is a refactor of a CRITICAL symbol with 4 direct callers
and 5 process groups. It is the correct long-term shape but it is **not** required for Neo16
acceptance, so it is deferred (§8).

## 3. Roles — who creates what

| Actor | Creates / owns |
|---|---|
| `questService.submitUtterance` Phase A (transaction) | the **receipt** (turn row, `processing`, `lease_token`, `attempt`) — unchanged from slice 1 |
| `learning/agentRun.js` (new, module) | the **run**: resolves binding → agent → provider; spawns the CLI; records `execution` on the turn row at `onSpawn` and at exit; enforces the run deadline; returns the validated `EvaluationSchema` or throws |
| `questService.submitUtterance` Phase C (transaction) | the **commit**: lease fence by `(processing_status, lease_token)`, server-side goal/XP decisions — unchanged |
| `questService.abandonSession` | the **cancellation**: closes the session and *revokes* in-flight leases of that session (§6.7) |
| shared runtime | identity (`resolveAgentUser`), operator/model (`resolveAgentProvider`), CLI process, hooks/tool policy, process tracking, `logAgentActivity` telemetry |

Nothing is written to `agent_jobs`, `messages`, `conversations`. Nothing is read from a
widget config. `user_id` is still `req.user` only.

## 4. Binding (which agent plays which NPC / evaluates)

- Binding rows live in the installation's **`neo16_content`** table (already provisioned):
  `kind = 'agent_binding'`, `content_key = <npc_key> | 'evaluator'`, `content_version = 1`,
  `status = 'active'`, `payload = { agent_row_id }`. Installation-scoped data, no literal
  ids in module source, no copy of the Agents registry. (`module_installations` has no
  config column — migration 091 — so the content table is the only installation-owned
  JSON store without a schema change.)
- Default provisioning (Astra on Codex CLI) is **data** written by the installer/seed from the
  operator's choice, never a fallback literal in code. If no binding row exists, the run
  **fails closed** with `AGENT_BINDING_MISSING` (409); it does not fall back to the rule
  evaluator. A deliberately configured rule-only mode is `payload = { evaluator: 'rules' }`
  on the `evaluator` binding — explicit, visible, test-friendly.
- Resolution at run time (every run, no cache beyond the request): `resolveAgentUser(agent_row_id)`
  must return a row with `status = 'active'`; `resolveAgentProvider(agentConfig, { spaceId })`
  + `detectProvider` must yield `isCliAgent = true`. Anything else → `AGENT_BINDING_INVALID`
  (409) with `{ agent_row_id, provider }` in details. No silent switch to an API provider.
- The agent row's `main_instructions` is the NPC persona (owner edits it in the Agents table).
  Neo16 appends its own bounded context (quest title/intro, goals open *for this NPC now*,
  output shape — `llmEvaluator.buildPrompt`). `crm_instructions` and the shared
  `buildAgentSystemPrompt` wrapper (CRM/delegation/skills blocks) are **not** used: an NPC
  must not be told how to delegate or which CRM tools exist. This is a documented deviation
  from "instructions belong to agent configuration": persona yes, CRM operating manual no.
- Tool policy stays the shared one: the PreToolUse hook (`scripts/agent-permission-hook.js`)
  runs with `AGENT_ID` = bound agent row, `SPACE_ID` = installation space; NPC agents get a
  deny-all `_command_policies`/tools profile in their own rows. Neo16 additionally passes
  `maxTurns: 1` so a tool call cannot start a loop even if policy is misconfigured.

## 5. Execution record on the turn row (`neo16_turns.execution`, JSON)

```json
{
  "attempt": 2,
  "agent_row_id": 230001, "agent_user_id": 5123,
  "space_id": 70, "learner_user_id": 1, "session_id": 195700, "turn_id": 195812,
  "request_id": "c-3", "lease_token": "…",
  "provider": "codex", "operator_id": 227864,
  "requested_model": "gpt-6-astra", "resolved_model": "gpt-6-astra", "model_source": "requested",
  "env_overrides_seen": { "CLAUDE_FLEET_MODEL": null, "CODEX_CLI_MODEL": null },
  "pid": 41233, "proc_start_ticks": 270656607, "proc_boot_id": "9d1a9403-…", "proc_exited": null,
  "spawned_at": "…", "finished_at": "…", "deadline_at": "…",
  "exit": "ok | invalid_output | timeout | spawn_error | adapter_error | auth_error | cancelled | reap_failed",
  "usage": { "promptTokens": 0, "completionTokens": 0 }, "cost_usd": 0,
  "evaluator_version": "llm-v1:gpt-6-astra", "binding": "nora | evaluator", "error": null
}
```

As implemented: `exit` has no `stale` value — a stale attempt simply cannot write the record
(lease guard), so the row keeps the live attempt's exit; `adapter_error` is any adapter
rejection that is not a spawn failure; `reap_failed` is a retry that refused to spawn because the
previous attempt's process outlived the kill window (the record stays the previous attempt's).
`proc_start_ticks` / `proc_boot_id` are the process identity captured at spawn (condition 3);
`proc_exited` is set after a kill (`true` gone, `false` survived the window). `evaluator_version`
uses the **resolved** model when the CLI reported one (`cli_init`), else the requested id.
Clients get ONE redacted projection everywhere a turn is returned — `GET /sessions/:id/state`, a
duplicate `say` replay, abandon's `cancelled_turns` (fix round P2): `agent_row_id, provider,
requested_model, resolved_model, model_source, exit, attempt` — never pid, lease token, env
snapshot or identity.

`attempt`, `request_id`, `lease_token` tie the record to the receipt; `agent_row_id`,
`space_id`, `learner_user_id`, `session_id`, `turn_id` make every run attributable (gate:
"agent, space, learner, session, turn/request, attempt"). `logAgentActivity` gets the same
ids in `details` (`[neo16 s:195700 t:195812 a:2]`) so the shared activity table sees the run.

## 6. Sequence and failure matrix

Lease for the agent path (as implemented): the binding and the agent are resolved **lazily, in
Phase B** — so a replay of an already applied receipt never depends on today's configuration —
which means the lease must be known before the agent is. Therefore
`AGENT_LEASE_MS = NEO16_MAX_RUN_MS (90 s) + KILL_MARGIN_MS (10 s)` is a module constant passed by
`routes.js`. The deadline timer is armed **from the lease** the moment the evaluator is entered
(`ctx.turn.leaseStartedAt` is the wall clock Phase A took before writing the lease; deadline =
`leaseStartedAt + leaseMs − KILL_MARGIN_MS`), and is only brought CLOSER by
`min(run_timeout_min × 60 000, NEO16_MAX_RUN_MS)` once the agent row is known. Binding/agent
lookups and adapter preparation therefore spend the same budget as the model call; the 10 s
margin is guaranteed, not assumed. The timer aborts the run's AbortController: the adapter sees
the signal (no spawn after it; the tree is killed if already spawned), the runner then WAITS for
the exit (condition 4) and marks the turn `failed/timeout`, so the receipt is reclaimable at
once, not after the lease.

| # | Event | Behaviour |
|---|---|---|
| 6.1 | Normal | A: receipt+lease → run: spawn, `execution.pid` patched under `lease_token` guard (short tx) → exit: parse → `EvaluationSchema` → C: fence + commit. Client sees `202 processing` on a concurrent poll, `200 applied` at the end. |
| 6.2 | Crash **between Phase A commit and spawn** | Turn stays `processing` with a lease. No child exists. On the next client retry of the same `request_id` (or any time after `lease_until`), Phase A reclaims it (`attempt+1`) and spawns again. Nothing is lost, nothing runs twice. |
| 6.3 | Crash **after spawn** (server dies, detached child survives) | The child keeps running but its result pipe is gone, so it can never commit (no DB write path exists outside the server promise). On reclaim, Phase A hands the previous `execution` to the evaluator; `reapExecution` first aborts any in-process run of that turn and awaits it, then matches the recorded pid by **exact identity** (condition 3), kills it and **waits for the exit** (condition 4) **before** the new spawn. A survivor → `reap_failed`, no spawn. Rule: *one live process per turn.* |
| 6.4 | **Late completion** (first attempt finishes after reclaim) | Phase C sees `lease_token ≠ ours` → `{ status: 'stale' }`, nothing committed (existing slice-1 fence). An attempt whose run was aborted by the reclaim is answered `stale` through the same fence in the failure path. `execution` is not overwritten by a stale attempt: the exit patch is also guarded by `lease_token`. |
| 6.5 | **CLI deadline** | The lease-anchored timer aborts the run: no spawn if none happened yet (the adapter checks the signal before `fork`; a spawn that still arrives is killed on report), otherwise kill + wait for the exit. Then `failed` + `exit: 'timeout'` under the lease guard, `EVALUATION_FAILED` (502, retryable). Receipt is reclaimable immediately (status `failed`), the client may retry the same `request_id`. |
| 6.6 | **Invalid output / auth error / spawn error** | Same as 6.5 with `exit` = `invalid_output` / `auth_error` (adapter rejects or `isAuthError(content)`) / `spawn_error`. Never a partial commit. |
| 6.7 | **`abandon_session` while a run is live** | In the abandon transaction (already under learner+session locks) every turn of the session with `processing_status = 'processing'` gets `processing_status = 'cancelled'`, `lease_token = null`, `execution.exit = 'cancelled'`, `result.status = 'cancelled'`; after commit `routes.js` calls `killCancelledRuns` with the FULL records: an in-process run (pid or not yet) is aborted — so a run still resolving its agent never spawns — and a detached orphan is killed after the identity check. The caller's `cancelled_turns` carry the public projection only (P2). The running attempt is answered `stale`. XP cannot be awarded (session not active + fence). |
| 6.8 | **Two tabs, same turn** | Same `request_id` + payload → second tab gets `202 processing` (receipt) until the first commits, then `200 duplicate`. Different payload → `409 REQUEST_MISMATCH`. Different `request_id` on the same session → serialised by learner advisory lock + `FOR UPDATE`; two runs may be live for two different turns of one learner — allowed, each has its own lease and pid. |
| 6.9 | **Server restart recovery** | No agent_jobs row → shared recovery never re-dispatches a Neo16 run (good: a continuation prompt would be wrong here). Orphan children are reaped lazily by 6.3 on the next retry, and eagerly by the shared graceful-shutdown child kill where it applies. |
| 6.10 | **Learner text contains `<<@slug>>`** | Text reaches the model as a user message only. Model output is parsed as JSON, validated by `EvaluationSchema`; `npc_response`/`feedback` strings matching `hasInvocationTokens` are **rejected** (`invalid_output`) as defense in depth. The module never imports the invocation dispatcher. |

## 7. Model provenance — requested vs. resolved, without touching global env

Recorded on every run (§5): `requested_model` (= `resolveAgentProvider().model`, i.e. the
agent row / Models row), `resolved_model` + `model_source` (= adapter result), and a
read-only snapshot `env_overrides_seen` of `CLAUDE_FLEET_MODEL` / `CODEX_CLI_MODEL` as the
server process saw them. Neo16 never sets or unsets these variables.

How to **prove** the effective model per provider:

- **claude-code**: `model_source = 'cli_init'` is the CLI's own statement (`system/init`
  event). Test: fake transport emits `init` with model `X` while the binding requests `Y` →
  execution shows `requested_model: Y, resolved_model: X, model_source: cli_init`. Smoke on
  staging: bind an agent to Opus with `CLAUDE_FLEET_MODEL` at its box default (`opus`) and
  read `resolved_model` from the turn row; then (owner-run, not agent) with `auto` to see
  the stored id win. Both are observations, not a fleet change.
- **codex**: the CLI never echoes a model; `model_source = 'requested'` is the honest label
  and the execution record must **not** be presented as "observed". Additional evidence
  available without code change: the adapter's spawn log line carries `requestedModel` and
  `passedModel` (`cli-providers.js:674-686`); `passedModel = null` means the config.toml
  default ran. If observed provenance for codex becomes a requirement, the only source is
  the thread/turn JSONL metadata — an adapter change (§8), not a Neo16 one.
- Telemetry must label the pair as `requested` vs `observed (cli_init|cli_result)` and never
  collapse them; the doc 239900 gate says a table label alone is not acceptance evidence.

## 8. Shared symbols: called vs. modified (fresh `impact`, 2026-10-04, index @ 932e66b8)

| Symbol | Risk (upstream) | Slice 2c | Note |
|---|---|---|---|
| `createAndDispatchJob` | CRITICAL — 4 direct, 20 symbols, 5 process groups | **not called, not modified** | §2 |
| `processJobLocally` | HIGH — 12 symbols | not called | chat-coupled |
| `reserveAgentJob`, `finishOrContinueJob` | HIGH | not called | conversation-keyed |
| `resolveAgentProvider` | HIGH — 5 direct, 15 symbols | **called**, unmodified | read-only |
| `detectProvider` | CRITICAL — 8 direct, 29 symbols | **called**, unmodified | pure function |
| `resolveAgentUser` | (not re-run; `agent-users.js:261`) | **called**, unmodified | |
| `executeClaudeCode` | HIGH — 2 direct, 9 symbols | **called**; **additively modified in the fix round** | `maxTurns: 1`, **`jobId: null`** (review condition 1 — a turn id is NOT a job id); new optional `signal` (abort → no spawn / kill) and `permissionsFailClosed` (bypass refused, `AGENT_PERMS_FAIL_CLOSED=1` to the hook). Callers passing neither see byte-identical behaviour. |
| `executeCodexCli` | LOW — 1 direct, 2 symbols | **called**; **additively modified in the fix round** | same two options; `jobId: null`; no turn cap → fail-closed deny policy + deadline (condition 2); no worktree for space 70 (§1) |
| `scripts/agent-permission-hook.js` | shared by every CLI spawn | **modified: opt-in fail-closed** | `AGENT_PERMS_FAIL_CLOSED=1` turns the four degraded paths into deny; unset → the documented fleet fail-open, pinned by tests |
| `resolveAgentUser`, `resolveAgentProvider`, `detectProvider`, `killProcessTree`, `isAuthError`, `logAgentActivity` | — | **called**, unmodified | imported statically by `agentRun.js`; the CLI adapters are imported lazily on the first real run so vitest never loads them |
| `killProcessTree`, `logAgentActivity` | not re-run (leaf utilities) | **called**, unmodified | |
| `submitUtterance`, `abandonSession` | LOW — no callers outside module | **modified** (module-owned) | lease derivation, `execution` patches, lease revoke on abandon |

Deferred, approval-gated, **not** in 2c:

- (a) Per-call `timeoutMs` on the two adapters (today a hard 120 min). Additive param;
  `executeClaudeCode` HIGH, `executeCodexCli` LOW. Largely superseded by the `signal` option
  shipped in the fix round (the caller's own timer aborts the run and kills the tree); a
  numeric timeout would only save callers from owning a timer.
- (b) Codex observed-model provenance from JSONL metadata. `executeCodexCli` LOW.
- (c) Generic `createAndDispatchJob` kind/result-sink. CRITICAL. Only if a second module
  needs the same shape; Neo16 alone does not justify it.

Any change to (a)–(c) is shown to the orchestrator and the owner before commit.

## 9. Acceptance for slice 2c (proven on `godcrm_test`)

Where each item lives: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 (table counts) → `__tests__/agent-run.db.test.js`
(real registry rows in an ephemeral project, resolved by the shared resolvers; fake adapters,
fake pid registry, kill spy); 10 (no dispatcher import) and the inspect-before-kill rules on a
live child → `__tests__/agent-run.test.js`; review condition 2 → `__tests__/agent-permission-hook.codex.db.test.js`;
the HTTP 409 for a missing binding → `__tests__/routes.db.test.js`.

1. Binding row → agent row → provider: a config-only change of `operator_id`/`model` on the
   bound agent changes the next run's `requested_model`/`provider` with no module rebuild
   (fake adapter asserts the params it received).
2. Missing / inactive / non-CLI binding → explicit 409, no rule fallback, no spawn.
3. Crash between receipt and spawn (test injects a throw after Phase A) → reclaim on retry,
   exactly one spawn per live attempt; alive-pid kill on reclaim (fake pid registry).
4. Late completion → `stale`, `execution` untouched by the stale attempt.
5. Deadline → `failed/timeout`, kill called once, retry succeeds with `attempt+1`.
6. Invalid JSON, auth-error text, invocation token in `npc_response` → `invalid_output` /
   `auth_error`, 502, retryable; XP never awarded.
7. Abandon during a live run → turn `cancelled`, late result `stale`, no XP, pid kill called.
8. Two learners in parallel → independent locks, independent executions, no cross-read of
   turns (existing 404 tests extended to execution records).
9. Provenance: claude fake with `init` model ≠ requested → `cli_init` recorded; codex fake →
   `requested` recorded and reported as such.
10. No row in `agent_jobs`/`messages`/`conversations` before vs. after a full quest (count
    assertions), the invocation dispatcher module is never imported by `backend/modules/neo16`.

Fix round (architect's CHANGES on `688d42b5`), all on `godcrm_test` / real children:

11. Delayed spawn → the adapter sees the aborted signal and does not spawn; an adapter that spawns
    anyway after the deadline has its child killed on report (`agent-run.db` §9.11).
12. Abandon while the run is still resolving (no pid) → cancelled, adapter never called; lease
    budget spent during preparation → `timeout` before any spawn, inside the kill margin (§9.12).
13. Kill ≠ stop on a detached orphan: survivor → `reap_failed`, no spawn, record kept; slow death →
    spawn only after the exit; a newer foreign CLI on the recycled pid is left alive (§9.13);
    real `codex`-named children, one ignoring SIGTERM, reaped through the real `killProcessTree`
    with the exit awaited (`agent-run.test`).
14. Fail-closed hook: every degraded path → deny in both dialects; the tool is blocked by the CLI
    itself through the real `executeCodexCli` + stand-in binary, also with the resolver down;
    `AGENT_PERMS=bypass` refused before spawn (`agent-permission-hook.codex.db`).
15. No reply leaks the stored turn: duplicate `say`, `cancelled_turns`, GET state (`routes.db` P2).
