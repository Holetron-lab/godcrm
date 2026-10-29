# Neo16 — W0 port feasibility (AI Town kernel on CRM tables)

Scope: work package **W0** of architecture decision 239900 (widget 218).
Evidence that the AI Town simulation kernel runs against ordinary CRM tables
**without Convex**: one NPC command (`moveTo`), durable save/restore, restore
identical to an uninterrupted run.

W1 adds `module.manifest.yaml` (preset seam only: no routes, no migrations — the
`16neo` preset reaches both trees through `presets.fragment.json` and the
`Neo16Widget.module.tsx` registrar, with no core `switch` case or static import)
and `blueprint.js` (tables + widget installed by the core ModuleInstaller). The
`/neo16` Socket.IO namespace in server.js is unchanged.

## Upstream pin

| | |
|---|---|
| Repository | https://github.com/a16z-infra/ai-town |
| Commit | `8e05997f2409275669c8344b84a51692e83f3f33` (2026-08-25, "Merge pull request #305 … fix/isolate-retrieved-memories") |
| License | MIT (`LICENSE`, © 2023 a16z-infra) — notice preserved in every ported file header |

## What was ported (JS, attributed per file)

| Ported file | Upstream source | Notes |
|---|---|---|
| `engine/geometry.js` | `convex/util/geometry.ts`, `convex/util/types.ts` | verbatim minus types/validators |
| `engine/minheap.js` | `convex/util/minheap.ts` | verbatim |
| `engine/movement.js` | `convex/aiTown/movement.ts` | speed/collision read from `game`; conversation guard dropped |
| `engine/world.js` | `convex/aiTown/{ids,player,agent,world,worldMap,playerDescription,agentDescription}.ts`, `convex/util/object.ts` | Agent is a record only (no LLM ops); conversations opaque; history buffers dropped |
| `engine/game.js` | `convex/aiTown/game.ts`, `convex/engine/abstractGame.ts` | `runStep` is a pure function; engine record is data; only `moveTo` input |
| `store/crmWorldStore.js` | replaces `convex/aiTown/main.ts`, `game.saveWorld`, `engine/schema.ts`, scheduler | CRM `universal_tables`/`table_rows`, row lock + version guard |

Patch inventory lives in each file header. Each dropped behaviour is a `ponytail:`
comment with the work package that brings it back.

## Measured port surface (lines, `wc -l`, upstream @ pin)

| Surface | Upstream | Ported now |
|---|---|---|
| Kernel actually ported (ids/world/map/player/movement/game/descriptions/util/abstractGame) | 1 527 TS | 695 JS (`engine/`) |
| Agent record (`agent.ts`) — serialization only | 368 TS | inside `world.js` |
| CRM store (new, replaces Convex boundary) | — | 244 JS |
| **Server code not yet ported** (conversations, agent inputs/operations, LLM memory, embeddings, historicalObject, init/crons/http/world/testing/music, util/llm…) | **4 673 TS** | 0 |
| Frontend (`src/**`, PixiJS + Convex hooks) | 2 148 TS/TSX | 0 |
| Data (`data/**`: map, characters, spritesheets) | 1 664 | 0 (synthetic 10×10 map in tests) |
| Files importing `convex/*` or `_generated` | 49 of 209 (16 of them under `src/`) | n/a |

Reading: the step/tick/pathfinding kernel is cleanly separable (it has no Convex
import of its own beyond validators) and ported at roughly half the line count.
Everything that talks to the LLM or to the Convex scheduler/DB (conversations,
agent operations, memory) is **tightly coupled** and must be re-authored against
the CRM store in W2 rather than copied. The frontend must be re-wired to a
REST/WebSocket transport (Convex `useQuery` everywhere) — W1/W2.

## Dependencies

Upstream runtime deps: `convex` (**not** adopted), `pixi.js` ^7 + `@pixi/react`
+ `pixi-viewport` (our tree already has `pixi.js` ^8 — API migration needed in
W1), `@clerk/clerk-react` (not adopted; CRM identity), `replicate` (asset gen,
not needed), `react` 18 (ours is 19). The W0 code adds **no new dependency**.

Planned for W3 (doc 239900): `ts-fsrs` — npm `5.4.2`, MIT (checked 2026-10-03).

## Asset inventory and licences (upstream `public/assets`, credits in README)

| Asset | Source / author | Licence (checked 2026-10-03) | Verdict |
|---|---|---|---|
| `rpg-tileset.png`, 16×16 game assets | George Bailey, opengameart.org/content/16x16-game-assets | CC-BY 4.0 (credit + link required) | usable with attribution |
| 16×16 RPG tileset | hilau, opengameart.org/content/16x16-rpg-tileset | **CC-BY-SA 3.0 / GPL 3.0** (dual) | ShareAlike/GPL — **do not ship**; replace |
| `tiny-rpg-forest` (gentle map originals) | ansimuz, opengameart.org/content/tiny-rpg-forest | CC0 | usable |
| UI frames | Mounir Tohami, mounirtohami.itch.io/pixel-art-gui-elements | page returns **404** — licence unverifiable | **do not ship** until verified |
| `32x32folk.png`, `player.png`, `magecity.png`, `gentle-obj.png` | not individually credited upstream | unknown | **do not ship**; own sprites or verified packs |
| `background.mp3` | not credited upstream | unknown | do not ship |
| Fonts `upheaval_pro.ttf`, `vcr_osd_mono.ttf` | not credited upstream | unknown | do not ship; use licensed fonts |

Conclusion: code is MIT and reusable; the **art/audio must be re-sourced** (we
plan our own pixel style anyway). Nothing from `public/assets` is copied here.

## Access audit — generic tables API (evidence, not a pen-test)

Routes in `backend/routes/v3/tables/`:

* `GET /tables/:id/rows`, `GET /tables/:id/rows/:rowId`, `GET …/rows/base/:baseId`
  call `checkTableAccess` **only when `req.user.projectId` is set**, i.e. for
  project-restricted API keys. A plain JWT user is not gated on read by these
  handlers (`tableRowListController.js:28`, `tableRowGetController.js:24,165`).
  `checkTableAccess` itself (`helpers.js:160`) checks project restriction only.
* Writes (`POST/PUT/DELETE rows`, `batch-update`, `batch-delete`) run
  `requireTableWriteAccess` → space owner or **editor-level** effective role
  (`helpers.js:27-57`). Any editor of the space can therefore rewrite
  `neo16_worlds.snapshot`, `state_version`, `neo16_turns.result` — the
  authoritative learning record — through generic CRUD.
* `universal_tables.access_control` exists as a column but the only enforcement
  found is space-level (`spaces.access_control` via `checkUserAccessViaTableV2`
  / `EffectiveRoleService`), not per-row/per-learner.

Remaining gaps (unchanged from doc 239900 §Access and Privacy Gate; W0 closes none):

1. Read path: no learner-ownership filter for JWT users on generic row routes.
2. Write path: editor role suffices to mutate authoritative rows; no
   "server-only" column class.
3. `created_by` / `owner_user_id` are stored but are **data, not authorization**.
4. Public widget/share paths not exercised here.

Synthetic data only; real-user pilot stays blocked on W4 negative tests.

## Verification

```
npx vitest run backend/modules/neo16 --configLoader runner
```

* `__tests__/engine.test.js` — 7 tests, no DB: round-trip, pathing around a wall,
  blocked-tile invariant, error-as-result, late input deferral, **save mid-walk →
  JSON → restore → resume == uninterrupted run**.
* `__tests__/crm-world-store.db.test.js` — 6 tests on `godcrm_test` (asserts
  `current_database() ~ _test$` over loopback before any write; ephemeral
  workspace, full cleanup): provisioning via `ModuleTableProvisioner`, one NPC
  command end-to-end, **20 lock-step transactions restore == in-memory run**,
  request_id idempotency + payload mismatch rejection, two concurrent steps
  serialize through `FOR UPDATE` (versions 1,2), rows readable as plain
  `table_rows`.

## W2 — one durable quest (doc 239900 §Learning Loop, §Runtime and Transaction Contract)

Blueprint `0.2.0` declares all seven logical tables of §Data Ownership
(`turns` gains the learning columns; `content`, `sessions`, `progress`,
`review_cards`, `npc_memories` are new — the last two are schema-only until W3)
and seeds the first quest from `content/quests.js` (natural key
`kind, content_key, content_version`; installed once even under concurrent install).

| Part | File | Role |
|---|---|---|
| Content | `content/quests.js` | DATA only. `arrange_meeting@1`: 3 NPCs (Nora, Dr. Reed, Casey), 3 goals, `confirm` requires the other two. The service reads the durable row, never the constant. |
| Evaluator contract | `learning/evaluator.js` | `EvaluationSchema` (Polyglot-Path shape: `npc_response`, `intent`, `feedback`, `grammar_errors`, `vocabulary`) + deterministic `ruleEvaluator` for tests/offline. An LLM adapter plugs in through `opts.evaluate` (W2-S3). |
| Quest loop | `learning/questService.js` | `startSession` (one ACTIVE session per learner/quest/version; resume returns it), `submitUtterance` (3 phases: receipt+lease → evaluate outside the DB → re-lock, lease/version check, server-owned goal transitions, atomic turn+session+progress commit), `loadSessionState` (reload). |

Guarantees proven in `__tests__/quest-service.db.test.js` (7 tests, `godcrm_test`):
the entire loop lands in CRM rows; goals follow content `requires` + right NPC +
confidence floor, not the model's say-so; XP for a quest is awarded **at most once
per (user, quest, version)** — duplicate `request_id` returns the saved result,
another payload with the same id is rejected, a crashed evaluator leaves a
retryable receipt, an expired lease is reclaimed and the late result commits
nothing (`stale`), two tabs serialize through `pg_advisory_xact_lock(learner)` +
session `FOR UPDATE` and a simultaneous double finish awards once; a stranger
gets 404 on world/session (no existence oracle); NPC allowlist and text bounds
are Zod-validated; learning turns (`world_id = null`) are invisible to `stepWorld`.

### W2-S3 — HTTP command envelope (`routes.js`, mounted from the manifest)

`module.manifest.yaml` now contributes one authenticated router at `/api/v3/neo16`
(core `authenticate` in front, mounted by `backend/modules/loader.js`; core names nothing).
The body never carries the actor or table ids: `user_id` is `req.user`, and the table
mapping is resolved from the space's ACTIVE `neo16` installation by blueprint table
**name** inside the installation's project — never from the widget's config.
Not-found, not-installed, not-a-neo16-widget and not-a-member all answer **404**.

| Endpoint | Body / query | Result |
|---|---|---|
| `POST /sessions` | `{ data: { widget_id, request_id?, command: 'start_session', payload: { quest_key, content_version } } }` | **201** `{ session_id, world_id, resumed: false, progress_id, state }`; **200** with `resumed: true` when the learner already has an active session on that quest. The learner's world is created on first use from `content/town.js` (one per learner, under the learner lock). |
| `POST /sessions/:id/commands` | `{ data: { widget_id, session_id?, request_id, expected_version?, command: 'say' \| 'abandon_session', payload } }` — `say` payload `{ npc_key, text ≤ 1000 }`; `abandon_session` payload `{}` (strict) | `say` → service result: `applied`/`duplicate` **200**, `processing` **202**, `stale` **409**. `abandon_session` → `applied`/`duplicate` **200** (W2-S4). |
| `GET /sessions/:id/state?widget_id=N` | — | **200** `loadSessionState` (session, quest content, applied turns, progress). |

Error body: `{ success: false, error: { code, message, details? } }`. Codes: `VALIDATION_ERROR` 400
(unknown command, extra keys, text bounds, bad ids — `details` is Zod `flatten()`),
`COMMAND_NOT_ALLOWED` / `SESSION_MISMATCH` / `REQUEST_ID_REQUIRED` 400, `WIDGET_NOT_FOUND` /
`SESSION_NOT_FOUND` / `WORLD_NOT_FOUND` / `QUEST_NOT_FOUND` 404, `UNKNOWN_NPC` 422,
`VERSION_CONFLICT` / `REQUEST_MISMATCH` / `SESSION_CLOSED` 409, `EVALUATION_FAILED` 502,
`NEO16_INTERNAL` 500 (`NOT_IMPLEMENTED` 501 was the S3 placeholder for `abandon_session` and is
gone since S4). `expected_version` (optional; `null` = no check) is compared with the session's
`state_version` only for a NEW turn — a replayed `request_id` with the same payload still returns
the saved result, including a replay of the very turn that closed the session.

Proven in `__tests__/routes.db.test.js` (4 tests, `godcrm_test`, two tenants with their own
installations): start → world + session rows, resume, state; `expected_version` gate,
duplicate → saved result, other payload → 409, completion → XP once; envelope validation writes
nothing; cross-user / cross-space / untagged widget / unknown widget / no actor fail closed.

### W2-S4 — durable `abandon_session` (slice 1)

`abandonSession` (`learning/questService.js`) closes an ACTIVE session without finishing the quest
in **one short transaction** under the same ordered locks (learner advisory lock → session
`FOR UPDATE`) and the same receipt rules as `say`: the request_id receipt is checked first (a
replay returns the saved result; a `say` id reused for abandon, or vice versa, is
`REQUEST_MISMATCH`), then `SESSION_CLOSED`, then `expected_version`. There is no outside-DB phase,
so the turn row (`input_name = 'abandon_session'`, `world_id = null`, `result.status = 'abandoned'`)
is applied in the same transaction that sets the session to `abandoned` with a version guard.
Progress is untouched: a later `start_session` on the same quest opens a new attempt on the same
progress identity. A `say` whose lease was live when the learner abandoned still lands its
dialogue but can complete no goal and award no XP (Phase C gates both on `status = 'active'`).
`loadSessionState` now returns `command` (the turn's `input_name`) per turn.

Proven in `quest-service.db.test.js` (+2 tests) and `routes.db.test.js` (+1 test): receipt /
version / stranger rules, durable rows, replay, closed-session rejection, restart as a new attempt,
abandon winning a race against an in-flight utterance on a learner with no prior XP.

### W2-S4 — LLM evaluator adapter, provider-agnostic core (slice 2a)

`learning/llmEvaluator.js` produces the same `EvaluationSchema` object as the rule evaluator,
from a model. It owns **prompt → parse → validate**; the network call is an injected transport
`complete({ system, user }) → Promise<string>`, so vitest never reaches a provider (tests inject a
deterministic fake) and the provider/model choice lives in one place — the transport wired by
`routes.js` (slice 2b, pending the owner's provider/model decision; the key will come from the
Tier-1 vault via `getSecret`, nothing hard-coded). `createLlmEvaluator({ complete, model })`
returns `{ evaluate, evaluatorVersion: 'llm-v1:<model>' }`, which plugs into `submitUtterance`
through `opts.evaluate` / `opts.evaluatorVersion`; the version is recorded on every turn.

The prompt discloses only the goals the learner can complete with THIS NPC right now (content
`requires` enforced), lists the allowed intent names (+ `small_talk`), fixes English-only
in-character replies and ≤ 2 actionable corrections, and asks for one JSON object. The learner's
text travels as the user message, never inside the system prompt. Output is parsed tolerantly
(bare object, fenced block, or prose around it) and validated strictly; any failure throws, which
`submitUtterance` turns into a `failed`, retryable receipt and `EVALUATION_FAILED` 502 — the
model still cannot complete a goal or award XP on its own.

Proven in `llm-evaluator.test.js` (3 tests, no DB) and one `quest-service.db.test.js` test driving
a turn through the loop with a fake transport (`evaluator_version = 'llm-v1:fake-1'` on the row;
prose instead of JSON → retryable failure → the retry applies once).

### W2-S4 — NPCs are CRM agents: the agent runner (slice 2c)

Owner decision (doc 239900 §"Owner Decision — Reuse CRM Agent Runtime"): the model, provider,
persona and tool policy of an NPC come from the **Agents table and the shared fleet runtime**,
not from module code or env. `learning/agentRun.js` implements `AGENT_RUNTIME_CONTRACT.md`
(slice 2b, reviewed; the three review conditions are recorded at its top):

- **Binding is data.** `neo16_content` rows of `kind = 'agent_binding'`: `content_key` = an NPC
  key (`nora`, `reed`, `casey`) or `evaluator` (installation default), `payload =
  { agent_row_id }` or `{ evaluator: 'rules' }` (explicit rule-only mode). NPC key beats
  `evaluator`. **No row → `409 AGENT_BINDING_MISSING`**; inactive / API-provider / malformed →
  `409 AGENT_BINDING_INVALID` with `details`. There is no silent rule fallback: a fresh install
  answers 409 until the owner binds an agent (Astra on Codex CLI by default is a row the owner
  writes, not a literal in code).
- **Resolution is the fleet's.** `resolveAgentUser` → `resolveAgentProvider` → `detectProvider`
  (all read-only, unmodified); only `claude-code | codex` are accepted. Persona =
  `main_instructions`; `crm_instructions` and the shared CRM/delegation prompt wrapper never
  reach an NPC. A config-only edit of the agent row (operator, model) changes the next turn.
- **The run.** Phase A receipt as before; Phase B spawns through the shared adapter with
  `messages = [learner text as user]`, `maxTurns: 1`, `agentId`/`spaceId` for the PreToolUse hook,
  **`jobId: null`** (a turn id is not a job id — see contract condition 1), the run's **`signal`**
  (AbortSignal: no spawn once aborted, kill after) and **`permissionsFailClosed: true`** (the hook
  denies on every degraded path; `AGENT_PERMS=bypass` is refused — and the runner answers
  `409 AGENT_POLICY_UNAVAILABLE` on such a host before spawning). The deadline is armed from the
  **lease** the moment the evaluator is entered — `leaseStartedAt + leaseMs − 10 s` — and only
  shortened by `min(run_timeout_min, 90 s)` once the agent is known, so lookups and adapter
  preparation spend the same budget and the kill always lands before a reclaim is possible.
  Output → tolerant JSON parse → strict `EvaluationSchema` → invocation tokens in
  `npc_response`/feedback rejected. Auth errors, invalid output, spawn errors, timeouts →
  `failed` receipt + `502`, retryable. An attempt that lost its lease meanwhile (reclaimed or
  cancelled) is answered `stale`, never reported as the turn's failure.
- **The record.** `neo16_turns.execution` carries agent / space / learner / session / turn /
  request / attempt / lease token, provider + operator, `requested_model` vs `resolved_model` +
  `model_source` (`cli_init` for claude-code; codex can only ever say `requested`), a read-only
  snapshot of `CLAUDE_FLEET_MODEL` / `CODEX_CLI_MODEL`, pid + the process **identity**
  (`proc_start_ticks`, `proc_boot_id` from `/proc`, captured at spawn), spawn/deadline/finish
  times, exit, `proc_exited` (after a kill: did it really go?), usage, cost. Writes are serialised
  and lease-guarded, so a stale attempt cannot overwrite the live one. **Every reply** — GET
  state, a duplicate `say`, abandon's `cancelled_turns` — goes through one public projection
  (`agent_row_id, provider, requested_model, resolved_model, model_source, exit, attempt`); pid,
  lease token, env snapshot and identity never leave the row. `logAgentActivity` gets one row
  per run with the same ids.
- **Kill discipline.** A pid is killed only when it is *the* process we spawned: `claude`/`codex`
  argv **and** the exact `/proc` start-ticks + boot-id recorded at spawn. A recycled pid — even a
  newer foreign CLI — never matches and is left alone (this box runs PM2 and live chat workers).
  Kill is not stop: after the signal the runner **waits** for the process to disappear (the shared
  `killProcessTree` escalates SIGTERM → SIGKILL at 5 s; wait window 7 s) before any new attempt
  may spawn; a survivor makes the retry fail with `reap_failed` instead of running two children
  on one turn. Every live run is registered in-process, so reclaim and `abandon_session` can abort
  a run that has **no pid yet** (the adapter then refuses to spawn); `abandon_session` revokes the
  leases of in-flight turns in its own transaction (`cancelled`) and then stops their runs.
- **Codex has no turn cap** (condition 2): the guard is the agent row's deny-all policy through
  the shared PreToolUse hook, now **fail-closed for NPC spawns** (`AGENT_PERMS_FAIL_CLOSED=1`:
  no token, resolver down, non-2xx, timeout, crash, bad stdin → deny; the fleet keeps its
  documented fail-open default). `__tests__/agent-permission-hook.codex.db.test.js` proves it on
  two layers against the real `/api/v3/agent-permissions/check` router on a local port: the real
  hook as a child (both dialects, every degraded path), and the real `executeCodexCli` spawning
  `__tests__/fixtures/fake-codex-cli.mjs` — a stand-in `codex` that implements the CLI's
  PreToolUse protocol and whose "tool" writes a marker file — so the block is observed on disk
  (marker absent), including with the resolver unreachable; the policy-less control agent's tool
  RUNS, so the block comes from the hook. An agent without a policy row gets silence (= allow)
  while the resolver is up — so **every NPC agent row must carry the deny policy**.

Tests: `agent-run.db.test.js` (11, real registry rows in an ephemeral project resolved by the
shared resolvers, fake adapters + fake pid registry with `/proc`-shaped identity: §9.1–9.13),
`agent-run.test.js` (10, no DB: exact identity, kill-and-wait on REAL children posing as `codex`,
one ignoring SIGTERM, no dispatcher import), the hook test (15), the routes test for the HTTP 409
and the P2 leak checks, and the quest-service test for contract 6.7 (late result `stale`).
The real CLI adapters are imported lazily on the first real run, so vitest never loads them
except in the stand-in-binary test, which exercises `executeCodexCli` itself.

Not yet: seeding a default `evaluator` binding from the owner's choice at install time (data,
pending the owner naming the agent row); staging smoke with a real Codex run.

### W2-S5 / W2-S6 — frontend panel and per-widget quest selection

The conversation/feedback panel lives in the frontend half of the module
(`src/features/widgets/components/presets/Neo16Widget/learning/`, W2-S5) and speaks only the
envelope above: fresh `request_id` per send, 502 replayed with the same id, `expected_version`
from the last state read, 409 stale → re-read and never resend, binding 409 → configuration error
without fallback.

**Which quest a widget opens (W2-S6)** is read from the widget row's own `config`:

```json
{ "quest_key": "arrange_meeting", "content_version": 1 }
```

- Both fields absent → the panel falls back to the module default `arrange_meeting@1`
  (`DEFAULT_QUEST` in `useLearningSession.ts`), so a widget placed by the installer keeps working
  with no settings — the blueprint's `widgets[].config` carries only the `$table` ids and the
  `__module` tag, never a quest.
- A present field is sent **as-is**: the client does not validate, repair or default it. An
  unknown key answers `404 QUEST_NOT_FOUND`, a malformed one `400 VALIDATION_ERROR`
  (`machineKey` = `^[a-z][a-z0-9_]*$`, version a positive integer), and the panel shows that
  error naming the requested `quest_key@content_version`.
- The core widget-settings dialog is a hand-written per-preset `switch` with no schema and no
  module slot (`modals/widget-settings/PresetSettingsRouter.tsx`), and MODULE-CONTRACT v1 forbids a
  core edit naming the module, so there is **no UI field** for this yet. Set it on the row:
  `PATCH /api/v3/widgets/:id` with `{ "config": { … } }` or the `update_widget` MCP tool.
  **`config` is replaced whole, not merged** (`WidgetService.updateWidget` stringifies the value):
  send the full object — keep `__module` and every `*_table_id` from the installed row, or the
  routes' `resolveContext` will answer 404 for the widget.

Tests: `__tests__/questConfig.test.tsx` (pure reader + the real `Neo16Widget → LearningPanel →
useLearningSession` chain against a recording transport: configured key is sent, absent config
sends the default, `QUEST_NOT_FOUND` / `VALIDATION_ERROR` reach the panel with exactly one start).

### Server world integration (conversation 3726)

[WORLD_API.md](./WORLD_API.md) defines authenticated enter/snapshot/move/heartbeat,
server-owned learner and NPC mapping, logical clocks, receipt/version behavior and
frontend integration. NPC activity/wandering runs through the ported stepWorld;
learning dialogue continues through the existing agent evaluator.
