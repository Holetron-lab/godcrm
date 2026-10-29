# Staging browser broker–worker contract v1

Scope: conversation 3660 / backend job 22049. Implementation only; not installed,
activated, granted, integrated into main, or accepted by QA. Existing offline
local-qa and staging.preflight channels keep their separate grants/semantics.
No UI source or infrastructure/installer files are changed.

## MCP / authenticated routes

All routes are mounted below the existing ops gate router, before user auth, and
require a verified `ops_gate` JWT from the trusted launcher. A normal user JWT,
missing token or missing numeric dispatch_job_id cannot authorize a browser run.
The current running agent_jobs row and conversation space are checked per call
and every 500ms during execution. Identity/role are re-read through the existing
agent table resolver. Scope is Development space 11.

| MCP name | POST below /api/v3/ops | Strict JSON input |
| --- | --- | --- |
| ops_browser_preflight | /browser/preflight | {"suite_id":"axe-v1"} |
| ops_browser_run | /browser/run | {"suite_id":"axe-v1"} |
| ops_browser_artifact | /browser/artifact | {"run_id":"UUID","artifact_id":"UUID"} |

Suite enum: `computed-contrast-v1`, `axe-v1`, `trace-metrics-v1`, `clipboard-v1`.
No additional properties, URL, command, script, args, image, mounts, credentials,
job, repo or SHA are accepted. Definitions live in tool-definitions/ops.js;
executable Zod schemas live in stagingBrowserContract.js. Registry rows/tool
assignments are NOT created. Runtime IDs remain unassigned until the issuance gate.

Preflight returns ALLOW plus server-resolved job/SHA/pins/capabilities/expiry.
It is not an authorization token. Every run repeats preflight and authorization.
Failures: HTTP 400/401/403/409/429 with error.decision=DENY; unavailable profile,
worker, migration, pins, capabilities or cleanup: BLOCKED, usually 503. Tool
handlers return the data/error object. Success returns PASS/FAIL, durable run_id,
SHA/pins, structured report and cleaned=true. Nonzero/absent evidence is not PASS.
No raw error messages, worker logs or client extras are stored in run receipts.

## Separate server-owned binding, no issuance in this change

Migration `100_ops_staging_browser.js` defines ops_browser_grants and
ops_browser_runs. Apply via the separately authorized migration/install process.
No migration has been applied to production by this task. The migration test uses
an isolated schema inside a rolled-back transaction on actual godcrm_test.

A future authorized provisioner must resolve the actual launcher worktree and
candidate, then create an expiring immutable binding in ops_browser_grants:
job_id (numeric agent_jobs.id as text), agent_id, space_id=11, active role, repo,
candidate_sha, suite_ids, pins, issued_by, expires_at, deadline_seconds (default
180, max 300). TTL <=1h. Provisioning is NOT exposed to agents or added here.
Change bindings by revoking and replacing, never by updating an active binding.
Repo must be the job's allocated /root/wt-* top-level directory, resolved by the
trusted provisioner, not prompt text. Broker rejects symlink repo paths and
checks HEAD on each run. Worker must use a committed snapshot of this SHA, never
execute mutable worktree scripts/dependencies. Staging served candidate must be
independently verified by the worker; a bundle hash alone is not a backend SHA.

The launcher consults this table only when no old ops/staging grant exists, and
only for the exact dispatched job. Missing browser table fails closed without
breaking existing grant-token issuance. No launcher allocation change is needed.

Runs are registered transactionally before execute: exact UUID, worker_id,
job/grant, suite, SHA, pins and absolute deadline. A partial unique index allows
one active worker per job across broker processes, including cleanup_pending.
There is a lifetime limit of 20 registered runs per job. Worker must independently
limit retained artifact storage to 2MiB/run, 40MiB/job, TTL <=1h and remove expired
artifacts without following symlinks. No raw logs published.

## Installation seam owned by sysadmin

These fixed paths are OUTSIDE worktrees; this commit does not create them:

- /opt/godcrm-staging-browser/manifest.json: exact pins object, <=16KiB.
- /etc/godcrm-staging-browser/channel.key: 64 lowercase hex chars, mode 0600.
- /run/godcrm-staging-browser/worker.sock: Unix socket for the independent service.

All ancestors and final paths must be root-owned, no symlinks, no group/world
write. Key additionally has no group/other permissions. No agent-controlled path
or environment override. Installer must select a versioned immutable deployment
and publish the fixed manifest/socket, without a symlink at these checked paths.
The pins object has exactly executor, image, dependencies, seccomp, egress,
suites, installation. Image uses sha256:<64hex>, all others plain 64hex SHA256.
The installation pin identifies an immutable installation manifest excluding
this self-referential pins file. Document the digest recipe in the installer.
Every executable and transitive module must be covered by executor/installation
pins. Dependencies include the lockfile, browser and axe provenance. Suites pin
covers the reviewed fixed scenario registry, routes, selectors and fixtures.

Worker must verify its *actual* installed pins against requests; echoes are not
evidence. Preflight actively verifies Chromium sandbox/non-root prerequisites,
TLS, network policy and independent reaper readiness WITHOUT launching a browser.
If readiness cannot be established without a separate installation acceptance,
return an unavailable result; never claim capabilities on an untested install.

## Signed IPC

Node net Unix stream, one UTF-8 JSON line/request and reply. Max reply 65536 bytes,
including framing. HMAC-SHA256 uses the channel key's UTF-8 hex text as key.
Canonical body JSON sorts object keys recursively (existing canonicalJson/signBody
in stagingExecutionBroker.js), preserves array order, no whitespace. ASCII keys,
IDs/enums/digests; timestamps and measurements are finite numbers. Do not sign
raw JSON.stringify order. The signature is lowercase hex.

Request `{body:{v:1,nonce:UUID,issued_at:EPOCH_MS,...operation},sig:HEX}`.
Reply `{body:{v:1,nonce:SAME,op:SAME,result:VALUE},sig:HEX}`. Unknown reply fields,
wrong signature, nonce or operation fail closed. Worker rejects extra request
keys and stale issued_at (>5s), caches nonce/run ID replay state durably for the
maximum run/cleanup lifetime. Socket ACL and key are server-only. Do not expose
this socket or channel key to containers/agents. Peer credentials are an
additional worker-side check; HMAC alone does not replace private installation.

Operations:

1. **preflight**: pins, suite_id, candidate_sha, job_id. No browser allocation.
   Return `{pins,capabilities,candidate_sha,database:"godcrm_test"}` exactly.
   Capabilities: sandbox, non_root, tls_verified, network_enforced, durable_reaper,
   computed_styles, axe, trace_metrics, isolated_clipboard, sanitized_artifacts
   (all true), cleanup_ms positive <=10000. Pin/suite/version mismatch blocks.
2. **run**: run_id, worker_id=`godcrm-browser-<run UUID>`, job_id, agent_id,
   space_id, role, repo, candidate_sha, pins, suite_id, deadline_at=EPOCH_MS,
   cleanup_ms=10000, writes=false. Worker durably registers exact identity before
   allocating ANY child/container/profile. It validates deadline <=300s and grant
   context, uses the fixed staging target https://dev.godcrm.ai / godcrm_test,
   then returns `{run_id,worker_id,report}`. Report schema is in contract JS.
   Worker suites read only; clipboard round-trip uses a private browser profile
   and synthetic value. No DB/Access/member fixture writes are enabled.
3. **cleanup**: run_id, worker_id only. Idempotently remove precisely that recorded
   worker and private profile/clipboard; reply `{run_id,worker_id,cleaned:true}`
   only after verification. Unknown IDs cannot select processes. No broad pkill,
   PM2 operations, host-wide cleanup or deletion of another run's artifacts.
4. **artifact**: run_id, worker_id, artifact_id, job_id, pins. Return the exact typed
   object accepted by browserArtifactSchema: kind, checks and fixed-action trace.
   No raw trace zip/HAR, HTML, URL, selector, screenshot, headers, cookies, tokens,
   PII or clipboard values. Per-response canonical artifact JSON must fit under
   60KiB (transport includes framing). Descriptor sha256/bytes cover canonical
   artifact JSON, not the envelope; UUID handles, never paths. Retain sanitized
   artifacts after worker cleanup, bounded by expiry/quota. Broker checks live
   owner/job/grant, completed run, pins, schema, digest, byte length and kind.

## Deadline, revocation, death and reaper

The common absolute deadline counts from broker run entry, including preflight;
180s default, capped by grant expiry and 300s. Worker independently enforces it.
Each preflight/artifact RPC is capped at 5s. No browser per-step timeout may
extend the overall deadline. Broker polls identity/job/grant every 500ms; missing,
changed, expired, revoked or unreadable authorization aborts the run connection.
HTTP response disconnect aborts it too. EOF must cause worker cleanup even when
the broker is killed. A separate cleanup RPC gets at most 10s; cleanup is mandatory
on PASS, FAIL, malformed output, cancellation, timeout and socket failure.

Worker must own the crash reaper independently of CRM, with durable registration
before launch, heartbeat/EOF supervision, bounded close then removal of only its
recorded child/container, and boot reconciliation before accepting another run.
This backend does not kill host processes or implement the container reaper.
Failure to prove cleanup leaves cleanup_pending and blocks the job's next run.
On run entry, backend reconciliation retries exact recorded workers whose deadline
expired or whose heartbeat is >10s old (at most 20 in parallel, each <=10s).
The independent worker reaper is still REQUIRED even if no subsequent MCP call
arrives; a backend-only reaper would not cover broker death.

## Suite semantics and acceptance for sysadmin

- computed-contrast-v1: computed styles + contrast for table/schema drawer and
  Access targets in the existing frontend-qa checkpoint; report real ratios.
- axe-v1: run full axe on registered scopes, retain sanitized scoped aggregates.
- trace-metrics-v1: Playwright/CDP collection, LCP/INP/CLS plus explicit navigation,
  drawer/tab/scroll/Access interactions. Missing samples/coverage must fail, never
  become numeric zero/PASS. Publish only typed sanitized timings; private raw trace
  is not an agent artifact and must be scrubbed/deleted before publication.
- clipboard-v1: synthetic write/read in the isolated browser only, return success
  flag without values; no host clipboard and no application fixture mutation.

Infrastructure acceptance: non-root Chromium sandbox; cap-drop/no-new-privileges;
TLS on; network-enforced staging-only egress covering DNS rebinding, IP literals,
redirects, subresources and WebSockets. Negative Ring0/Ring1/external/loopback/
metadata/proxy-bypass and invalid TLS tests. No Playwright interception fallback.
No Docker/PM2/host sockets or production credentials in browser containers.

Backend tests prove contract, authorization, IPC tamper/size/deadline handling,
transactional registration, cancellation/revocation and sanitized output using
fixtures. They do NOT prove a real browser sandbox, network isolation, OS process
cleanup, installed image provenance, or the three real MCP pilot runs. Sysadmin
must implement/test those against this contract in its own worktree and return
committed worker/installer/pins. Separate authorized installation follows review.
Then three real MCP pilots + document 236575 gate, then existing frontend-qa
continues /tmp/qa-22046/HANDOFF.md. Gate 1 remains OPEN throughout preparation.

## Sources / versions

Runtime inspected: Node 20.20.2; Zod 3.25.76, existing Express/pg adapter.
Node IPC and socket destruction: https://nodejs.org/api/net.html#ipc-support
Zod v3 strict objects / safeParse: https://v3.zod.dev/?id=strict
Existing canonical HMAC, gate JWT and DB transaction abstractions are reused;
no new dependency, shell launcher, installation toggle or host-policy change.
