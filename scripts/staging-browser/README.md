# Staging browser worker v1 — preparation, conversation 3660

Backend dependency: `573131ae3fa9df3180f3c48b7ca6b30b8d6707da` (not cherry-picked
here). Infrastructure files are disjoint from that commit. Gate 1 remains OPEN.
This source package does not authorize installation, activation, remote attestor
installation, credentials, grants, migration, tool assignment or host-policy edits.

## Architecture and trust

`worker.py` accepts only the backend's signed four-operation Unix protocol.
Root peer credentials + 0600 socket + 0600 HMAC key; duplicate keys, extra fields,
unknown suites, stale timestamps, replay and caller-selected commands are denied.
Canonical JSON matches Node number spelling for bounded numeric protocol fields.
Each run is durably registered in SQLite WAL/FULL before profile/container creation.
Per-job active uniqueness, lifetime 20 runs, run IDs retained as tombstones.
Agent worktrees are identity context only: no worktree code/dependencies are mounted.

The independent systemd reaper watches durable heartbeats (2s stale, 250ms sweep)
and absolute deadlines. Cleanup is serialized with allocation and checks exact
run/job Docker labels. Only its own docker attach subprocess can be killed by
worker code. There is no broad process kill, Docker prune, PM2 or CRM restart.
Cleanup command budget is <=4s plus <1s lock wait; expiry detection <=2.25s.
Docker/API stalls leave the run pending and block the next job, never a false PASS.
A timed-out create is UNKNOWN permanently until an operator reconciles it; the
reaper continues watching/removing that exact ID rather than assuming absence.
Reaper boot reconciles all active records before publishing readiness.

A non-root Chromium container has network=none, cap-drop=ALL, no-new-privileges,
read-only root, private IPC/PID namespaces, resource limits and memory-only profile.
Only a per-run Unix egress socket and a per-run staging session are mounted. No
Docker/control sockets, host clipboard, channel key, production session or source
checkout is mounted. The host proxy has one constant IP (<DEV_IP>) and port
443, exact CONNECT authority dev.godcrm.ai, bounded ClientHello and exact SNI.
No DNS resolution occurs; rebinding cannot select another address. ECH and unknown
plaintext protocols fail closed. Browser uses full Chromium, TLS 1.2, certificate
verification and proxy loopback bypass disabled. TLS 1.2 is the tested compatibility
choice: TLS 1.3 ClientHello from this image was rejected by the ECH guard. Do not
remove the guard or disable TLS verification to regain connectivity.

All browser egress, including subresources and WebSockets, shares the kernel
namespace and Unix proxy. Playwright interception is NOT the security boundary.
`container-check.mjs` uses a synthetic 302 solely as a test stimulus; its redirected
request is blocked by the real proxy. Loopback means container-private loopback;
the only listener is the bounded proxy bridge, not the host network.

Four fixed suites: computed solid-color contrast, full scoped axe (incomplete
results fail), Playwright trace/CDP + LCP/INP/CLS, synthetic private clipboard.
Missing metrics/coverage never becomes zero/PASS. CLS zero is valid only when a
layout-shift observer is successfully registered; INP missing entries fails.
Raw Playwright trace is discarded, not exported. Typed sanitized action timings
are retained. Ratios with gradients/opacity/unsupported CSS fail as inconclusive.
Matrix: RU/EN, light/dark, desktop/mobile, table/schema/Access. Fixed selectors,
UI visibility on mobile, locale/theme application and proposed performance budgets
still require staging validation. Do not equate infrastructure test success with
passing these suites or the existing frontend QA checkpoint.

Artifacts live as bounded blobs in SQLite, not agent paths: <=60KiB each, <=2MiB/run,
<=40MiB/job, TTL <=1h. Only whitelisted numeric aggregates/actions cross IPC. There
are no raw DOM, screenshots, URLs, selectors, PII, headers or clipboard values.
Expired artifacts are purged by reaper; run tombstones remain to enforce lifetime
replay/quota. Operator storage maintenance must preserve those semantics.

## Build and pin recipe (preparation)

Read/backup before changes. Run from an isolated committed worktree on .128:

```bash
python3 -B scripts/staging-browser/package.py prepare /tmp/browser-build-UNIQUE
DOCKER_BUILDKIT=0 docker build --network=none --pull=false \
  --iidfile /tmp/browser-image-UNIQUE.id /tmp/browser-build-UNIQUE
python3 -B scripts/staging-browser/package.py seal /tmp/browser-payload-UNIQUE \
  --context /tmp/browser-build-UNIQUE --image sha256:ACTUAL_IMAGE_ID
```

No `npm install`, package download or mutable tag. The base image ID is fixed in
Dockerfile; the legacy builder accepts the local raw image ID without resolving a
registry. BuildKit interprets bare `sha256:...` as an image name; do not use it.
Dependencies are Playwright/playwright-core 1.58.2 and axe-core 4.11.1, copied from
verified local packages with package-lock integrity/version and per-file SHA256.
The entire browser/OS tree is bound by the base and resulting image IDs.

`installation.json` = canonical JSON of {files, image, groups}. Each group pin =
SHA256(canonical sorted map {relative file: SHA256(bytes)}). Installation pin =
SHA256(canonical installation.json); manifest.json contains those pins and is
excluded from the self-referential file map. Every package executable/module is
covered; Python standard library, Docker/SSH and host kernel remain trusted OS
prerequisites and must be included in installation review/patch management.
Worker measures actual installed files (including unexpected-file rejection) and
actual Docker image ID per preflight/run. No mutable source is executable at run.

## Separate authorized install and activation — review 249899 correction

PREPARATION ONLY. Installation/activation remains BLOCKED_CHANNEL. GERATRON must
name an independent administrator (principal), an authenticated execution channel,
and authorize exact .128 and .72 operations. Those values are currently UNKNOWN;
neither sysadmin's assignment nor deployment-executor's review appoints a writer.
Deployment-executor reviews evidence and records a CRM decision; it writes neither
`deployment.json` nor `acceptance.json`. No agent shell substitutes for this channel.

| Record | Authorized writer/process | Readback requirement |
| --- | --- | --- |
| .72 `/opt/godcrm-staging-attestor/deployment.json` | GERATRON-designated staging deployment administrator, through the separately approved .72 deploy process; identity/channel UNKNOWN blocks installation | Same administrator reads exact bytes, mode/owner, SHA256 and the fresh forced-command receipt; compare final deployed SHA, complete file map, asset digest and actual godcrm_test |
| .128 `/etc/godcrm-staging-browser/administrator.json` | GERATRON-designated browser installation administrator; identity/channel UNKNOWN blocks installation | Root:root 0600, no symlinks; principal, channel, authorization_ref match owner decision |
| .128 `/etc/godcrm-staging-browser/acceptance.json` | That named administrator invokes installed `publish_acceptance.py` after independent review | Exclusive write, fsync and byte/digest readback by program; administrator independently reads mode/owner/digest and verifies signature, pins, SHA and expiry |

1. Integrate backend then corrected worker through reservation/approval. Record
   final committed SHA, broker runtime environment/database and package pins.
   Preserve author worktrees. Verify .128, source cleanliness and installation queue.
   Broker deploy/migration is a separate authorized release: worker location does
   not authorize production DB writes. Ring 1 remains NO-TOUCH.
2. Verify complete payload and image digest; create and verify installation backup
   under /root/backups/temp. First installation ONLY:
   `python3 -B scripts/staging-browser/install.py --bundle PAYLOAD --expected-installation PIN --backup /root/backups/temp/browser-install-UNIQUE`.
   This copies three unit files, creates separate channel/acceptance keys and reloads
   definitions. It does not start/enable units, create acceptance or issue grants.
   Existing installation requires an independent upgrade plan; never delete it to
   bypass the first-install guard.
3. Separately authorized .72 installation provisions attestor, verified APP path,
   pinned Node dependencies/runtime-check, restricted forced-command SSH key and
   independently verified known_hosts. Changing attestor bytes requires new pins.
   The named .72 deployment administrator derives deployment.json from final
   authorized deployment evidence (candidate_sha, complete backend/dist/lock files
   map, asset relative path), not a user-provided bundle name. Back up existing
   bytes, exclusively write root-owned 0600 record, fsync and read it back. Verify
   actual file hashes and fresh nonce receipt/current_database()=godcrm_test.
4. Named .128 administrator provisions root-owned 0600 `administrator.json` with
   exactly `principal`, `channel`, `authorization_ref` (non-placeholder identifiers)
   and a QA-only staging read-only session. Session JSON remains
   `{origin:"https://dev.godcrm.ai",database:"godcrm_test",expires_at:EPOCH_MS,read_only:true,storageState:...}`.
   No production credentials or fixture writes. `.128/.72` administrator identities
   may differ; record both named roles in the authorization evidence before writing.
5. Start independent reaper and verify reconciliation. Start worker without
   acceptance to collect socket/permissions and signed BLOCKED preflight/run
   evidence. No browser grants or tool rollout are needed for this denial test;
   only the administrator's isolated disposable broker/IPC harness may send it.
6. Administrator creates `qualification-request.json` (root-owned 0600), exactly:
   `{writer: <administrator.json object>, candidate_sha: <final SHA>, pins: <manifest>,
     issued_at: <epoch seconds>, expires_at: <epoch seconds <=issued_at+300>,
     qualification_id: <fresh UUID>}`. This is a fixed administrative test request,
   not a grant, and persistently blocks agent IPC even with otherwise valid acceptance.
   Verified backup/archive of any previous acceptance/evidence is required first.
   No flags, suite names, URLs, scripts, mounts or commands are accepted here.
7. Through the independent authorized channel run
   `systemctl start godcrm-staging-browser-qualify.service`.
   It conflicts with/stops only the dedicated worker; reaper stays running. The
   oneshot uses the same user, filesystem, address-family, IP, namespace and
   privilege restrictions as worker. It verifies cgroup/invocation, both unit files,
   no drop-ins and effective systemd policy. Failures remain closed; do not edit the
   unit/policy or use a direct CLI launch to get around qualification failure.
   Effective-property spelling on the target systemd still requires installed
   validation; a mismatch is BLOCKED, never permission to weaken the comparison.
8. Qualification measures installed pins/image, session, TLS, remote SHA/DB and
   reaper; runs all four fixed suites via the SAME registration/execution/cleanup
   implementation. One shared deadline <=300s, systemd cap 310s includes cleanup.
   It writes signed root-private `/var/lib/godcrm-staging-browser/qualification-evidence.json`
   with pins/SHA/kernel, unit policy/digest/invocation, timing, attestation, sanitized
   suite reports/artifacts and verified cleaned states. UUID use is durable even
   after crash; retries require a new authorized request and verified archive.
   It writes NO acceptance, capability assertions, grants or starts the worker.
9. Independently inspect installed evidence and complete remaining negative
   sandbox/non-root/egress/DNS/WS/redirect/invalid-TLS and lifecycle checks under
   installed confinement. Include deadline, EOF/revocation, crash/boot reconciliation
   and cleanup <=10s. Broker death uses a disposable broker with godcrm_test, NEVER
   the running CRM/broker. Existing preparation Docker tests do not close these gates.
   Record ten `capability-<name>.json` receipts in the state directory, root-owned
   0600, each `{capability,pins,candidate_sha,kernel,performed_at,passed,method,observations}`.
   `method` and nonempty observations describe actual measured installed tests,
   with commands/versions/timings and artifact digests. No synthetic true records.
   Capabilities: sandbox, non_root, tls_verified, network_enforced, durable_reaper,
   computed_styles, axe, trace_metrics, isolated_clipboard, sanitized_artifacts.
10. Deployment-executor reviews receipts; named administrator records its CRM
    decision reference in 0600 `acceptance-review.json`:
    `{writer,review_ref,qualification_sha256,expires_at,checks}`.
    `checks` has exactly ten capability keys, each `{status:"PASS",evidence_sha256}`
    bound to the corresponding actual receipt bytes. Missing/failed/inconclusive
    evidence blocks publication. All proof timestamps must be <=1h old.
11. Once qualification is inactive and reaper confirms no pending runs, administrator
    archives the request to the verified backup (removing the IPC interlock), then
    runs `/usr/bin/python3 -B /opt/godcrm-staging-browser/publish_acceptance.py`.
    It verifies signed four-suite evidence, measured pins, all reviewed proof hashes,
    candidate/kernel/freshness and named writer; exclusive creation refuses overwrite.
    Acceptance is HMAC signed with a SEPARATE acceptance key and bound to exact
    evidence/review bytes, final candidate, kernel and pins; expires <=1h. Signature
    defends record substitution within the root-controlled boundary, not malicious
    root. Protect both keys; neither is an agent credential. No automatic renewal.
12. Administrator reads back acceptance, starts dedicated worker, verifies missing,
    expired, modified, symlinked, wrong-kernel/pins/SHA and changed-evidence denials
    using verified backup/restoration between cases. Cleanup remains available even
    when acceptance fails; artifact access is now also acceptance-gated. Four IPC
    operations and backend MCP schemas are unchanged; no bootstrap opcode exists.
    Perform three successive real calls of EACH enabled MCP operation, negatives
    and cleanup under the separately approved pilot issuance path and gate 236575.
    No ad hoc grants to bootstrap acceptance. QA remains frontend-qa checkpoint
    /tmp/qa-22046/HANDOFF.md; Gate 1 stays OPEN until all criteria pass.

A failed or partial qualification keeps the request interlock and one-use tombstone.
Reaper must reconcile before retry; preserve failed evidence. Running this package
in a worktree, including tests with fake Docker/systemd, is NOT installed acceptance.
The default registry's PENDING status/selectors/budgets still needs actual suite
acceptance; failures require reviewed source/pin changes, not forged evidence.

## Recovery and rollback — independent administrator only

Before installation record four separately verified recovery baselines:

- Worker .128: root-owned files/units/key/config and absent-path inventory, Docker
  image ID/export checksum, ledger plus WAL-consistent backup, evidence and modes.
  Restore into a disposable recovery location first and verify hashes/ownership.
- Backend and database: exact pre-release SHA, migration inventory, schema/data
  backup, proven restore to isolated godcrm_test and release/rollback owner. No
  runtime restart or migration is performed by this package; follow its own gates.
- Attestor .72: dedicated helper/runtime dependencies, deployment.json, restricted
  SSH authorized_keys entry and known_hosts baseline, exact paths/modes/hashes.
  Confirm separately authorized restore; never overwrite unrelated SSH entries.
- Session/credentials: verified encrypted or root-private backup/rotation plan for
  the dedicated read-only QA identity and keys; no secrets in handoff/evidence.
  Restoring expired sessions/acceptance does not authorize execution; requalify.

On rollback revoke bindings through the authorized provisioner and stop only
`godcrm-staging-browser.service` and `godcrm-staging-browser-qualify.service`.
Keep reaper alive until no active/uncertain run and exact labelled containers and
profiles are absent. Unknown allocation remains blocked for manual reconciliation.
Archive ledger, request/tombstones, acceptance/review and failed evidence; do not
clear tombstones to regain quota or reuse qualification IDs. Then stop reaper,
disable the two daemon units (qualification has no enable target), restore only
verified exact baseline paths and reload systemd definitions. Never Docker-prune,
remove foreign files/containers or stop CRM. First-install removal follows before.json
and measured installed digests, no symlink traversal. A partial install must be
recovered, not retried by deleting directories to evade the first-install guard.

Roll back backend/DB and .72 attestor/SSH via their separately authorized recovery
plans; mismatched SHA must leave preflight BLOCKED. Confirm staging health, actual
DB, restored manifests and blocked browser access. Installed rollback and recovery
remain NOT TESTED until the independent administrator supplies restore evidence.

## Verification

- `python3 -B -m unittest discover -s scripts/staging-browser -v`
- `node --test scripts/staging-browser/inspection.test.mjs`
- `validate_container.py --image PIN --output EVIDENCE` (temporary container only)
- `validate_invalid_tls.py --image PIN --output EVIDENCE` (test-only self-signed
  TLS upstream, actual Chromium certificate rejection, no trusted CA installation).
- `validate_lifecycle.py --image PIN --output EVIDENCE` (two owned temporary
  containers, separate reaper subprocess; heartbeat-death simulation, not a claim
  of real installed CRM process death/revocation).

Sources: https://playwright.dev/docs/docker (non-root sandbox/seccomp),
https://docs.docker.com/engine/network/drivers/none/ (network namespace),
backend committed STAGING-BROWSER.md contract. No installation acceptance inferred
from source or mocked backend tests.
