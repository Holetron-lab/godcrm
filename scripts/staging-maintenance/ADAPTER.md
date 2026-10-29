# Staging recovery package — review only

Candidate entrypoints: `9ac8301d05ae623c27f8e97d7fe423abb4509ea7`.
This directory adds infrastructure preparation to the allocated worktree based
on `8f358876`. It does not replace/cherry-pick Ralph's files. Nothing here is
installed, enabled, or automatically invoked by an existing entrypoint.

## Files and trust chain

- `recovery.py`: phase-aware hook, holder checks, durable per-session journal,
  compare-before-restore protocol. Requires inherited fd 9 for the SAME gate
  lock inode. No direct unguarded recovery invocation.
- `supervisor.py`: foreground Linux controlling-PTY supervisor, 30 s heartbeats;
  exits 75 on disconnect, stops heartbeats, does not kill deployment processes.
  Propagates the holder command's exit unchanged: registry refusal from gate
  `run` is 1, not temporary contention 75. It does not retry or release the gate.
  An interactive holder shell must handle its command failures explicitly;
  supervisor observes the shell's exit, not every command within that shell.
- `adapter.py` / `remote.py`: **unactivated live adapter template** for the fixed
  .128/.72 hosts. No test invokes live SSH, PM2, PostgreSQL or systemctl. It needs
  a completed, reviewed manifest and live rehearsal before installation.
- `package.py`: builds a private review bundle using exact candidate Git
  objects; emits complete candidate pins, payload pins, SHA256SUMS, and a hook
  embedding SHA256SUMS' digest. Gate `enter` pins that hook. Every hook invocation
  verifies the entire payload before importing Python helpers. No mutable helper
  or manifest may be substituted after `enter`; changing any byte fails closed.
- unit templates: independent .128 timer every minute, not the broker watchdog.
  The exact sealed bundle path must replace `REVIEWED-BUNDLE` during separately
  authorized installation. Syntax verification is not timer installation proof.

Bundle paths and state directory must be root-owned/private on .128, stable
absolute paths, no writable ancestors or symlink substitutions. Treat system
Python, coreutils, Bash and PATH as part of the trusted installed platform.
Use a clean administrator environment with the documented PATH; tests alone
replace `runuser` on PATH to guarantee no real database access.

`pins.json` covers the manifest, HBA originals/fence, all executable helpers,
candidate gate/runtime probe and full candidate file pins. The wrapper's seal
also covers pins.json itself. SHA256SUMS is not an authentication mechanism
against a malicious root administrator; it prevents accidental drift.

## Hook commands (interface, not an activation instruction)

All paths below refer to a future **reviewed installed bundle**, not `/tmp`.
The holder token must stay private in the administrator's environment.

1. Existing gate `enter --holder sysadmin-3660 --restore /absolute/bundle/hook`.
   Arm the reviewed watchdog before changing any control. Run a holder shell
   under `hook supervise /bin/bash`, attached to the independent SSH PTY.
2. `hook bind` checks identities, original fingerprint and original controls,
   then binds the durable journal to the generated maintenance id and bundle.
   No other controls may change before bind. A crash before bind fails closed.
3. Gate `mark capture`; for **each** control that will change, `hook intent NAME`
   is durable BEFORE the separately reviewed capture action. Supported names:
   `godcrm`, `bdd-runner`, `cron`, `cleanup`, `ingress`, `refresh`, `hba`.
   Keep each intent+capture action inside one enclosing gate `run` operation;
   nested hook calls inherit its lock. No background mutator outside that lock.
4. The capture procedure is separate: close ingress, stop/drain all writers,
   fence and drain DB, coherent backup, restoration rehearsal. This package does
   not assert that six named controls cover every file/DB writer.
5. Ralph's `dev-operation.sh apply` remains responsible for APPLY and its
   write-ahead phase mark. This hook never installs code or runs migrations.
6. `hook unfence`: holder only, step `apply`, writers closed, complete candidate
   fingerprint matches; known HBA compare/restore + reload + real next-start
   DB probe. Then use Ralph's ACTIVATE entrypoint. Background controls stay off.
7. After human/QA acceptance, explicit `hook accept` verifies the complete
   candidate fingerprint, background exclusion, actual current/next DB and
   health; writes a receipt bound to the session/seal. This health probe does
   not replace QA-20816-02/backend acceptance. Then gate `mark release` and
   `restore holder_exit`. Step `release` alone is insufficient without receipt.

Only gate `restore`/`watchdog` may call the hook's default `restore` action.
Gate records `restoring` before entry; the hook also verifies session/step.
`status` uses candidate gate readback: holder, phase, step, heartbeat age and
restore result. No token or PM2 environment is printed.

Absent `ops_staging_leases`, unreadable DB, or an unexpected registry response
refuses new gate `run`/`enter` operations before payload, including the holder.
Consequently `hook bind|intent|unfence|accept` return 1. `hook status` still emits
holder/step and `gate=refused` with its reason, then exits 1. Recovery of an
already open session through gate `restore` / `hook watchdog` remains available
without the registry, with the same pinned-hook, phase and fingerprint checks.
Successful recovery never implies readiness while the registry is absent.

## Recovery policy

| Last phase | Required evidence | Result |
|---|---|---|
| precheck / capture | original complete payload fingerprint | Restore journalled controls to exact captured states |
| apply / activate | no automatic rollback attempt | Nonzero exit; keep gate blocked for reviewed recovery |
| release | candidate complete fingerprint + explicit acceptance receipt | Restore journalled background controls; retain accepted app |

Even if an APPLY tree happens to match a known fingerprint, this version refuses
unattended recovery in apply/activate: code identity alone cannot prove database
and file recovery. There is no `force`, `skip-check`, blanket PM2 resurrection,
automatic SQL termination, or lease-release bypass.

Recovery rechecks fingerprint before each control, restores app first, verifies
actual DB and health before background writers/ingress, then refresh last.
Stopped-at-entry processes and inactive timers remain stopped/inactive. Only
write-ahead journalled changes are restored. A write-ahead intent is deliberately
safe when interruption occurred before the corresponding action.

Retries re-observe every completed action; the journal's `completed` list is
evidence, never permission to skip checks. If app was already started before a
failed attempt, DB validation automatically selects `online` (which checks both
current and next-start), not the stopped-only `next-start` mode.

On any failure, some earlier controls may already have been restored. The gate
remains blocked and the administrator must inspect state; do not keep calling
that interval a quiet window. No release until all observations pass.

## Live adapter obligations and limits

Protocol: one JSON request on stdin; `{ "ok": true }` on stdout only after all
assertions pass. Nonzero/timeout/unparseable response => hook fails closed.
Private diagnostics must never be pasted into chat; adapter stderr is suppressed
because it can contain PM2/.env data.

- Fixed target .72:2222, strict known-host verification, no host-key updates.
  Verify root, address, machine-id and peer `godcrm_test` on every remote action.
- HBA path fixed `/etc/postgresql/16/main/pg_hba.conf`. Accept only exact pinned
  original or session fence, restore original uid/gid/mode atomically, fsync,
  check parser, reload, observe changed load time and unchanged postmaster,
  perform a new application DB connection. Retry reload even for original bytes.
- Full fingerprint enumerates roots including new/deleted files, modes, owners,
  file contents and symlinks; external symlink targets require explicit roots.
  No ignore/exclusion shortcut. Include dependencies, built bundle, .env and
  every mutable external configuration affecting startup. Digest covers values
  but does not expose them. A source SHA or lockfile digest is not this digest.
- The application tree currently may contain mutable logs/uploads. A live
  fingerprint must first prove stable scope; this template deliberately refuses
  mismatch and does not silently omit those paths.
- PM2 executable currently assumed `/usr/bin/pm2`, node `/usr/bin/node`, both
  processes' cwd `/root/production/business-crm`. Validate these assumptions
  against a private snapshot before activating; do not silently fall back.
- The `ingress_unit` must be a separately reviewed **staging-only** idempotent
  maintenance control, active=closed, inactive=open, with verified health.
  This package does NOT create that service or assume it already exists.
  A missing unit blocks bind. It never stops global nginx or production ingress.
- Remote lock `/run/lock/godcrm-staging-maintenance.lock` serializes adapter
  attempts, including surviving CLI children after a controller timeout. Include
  its absence/state in the pre-install backup. It complements, not replaces,
  the .128 shared operation lock or exclusion of independent staging writers.
- RPC bounds: ordinary 45 s (SSH 35 s, individual remote CLI 15 s); fingerprint
  930 s (SSH 920 s). Fingerprint duration must be measured before activation;
  repeated full scans can extend recovery substantially. Heartbeat threshold is
  not an unconditional recovery deadline. A remote scanner surviving SSH loss
  can keep its lock until exit; administrator readback/intervention is required.
- Controller-to-target failure leaves gate blocked. Journal logs/systemd failure
  are readback, not proof of a delivered operator alert. Wire and test alerting
  during separately authorized installation.

## Isolated acceptance

From repo root:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/staging-maintenance -p 'test_*.py' -v
systemd-analyze verify scripts/staging-maintenance/godcrm-staging-maintenance-watchdog.{service,timer}
```

Tests use the **unmodified candidate gate** with fake DB binary and a sealed
filesystem service adapter. They test real flock, subprocesses, journal/fsync,
PTY hangup, holder loss, watchdog, concurrent refusal, tamper detection,
partial-APPLY refusal, unknown fingerprint/host/DB/HBA, per-control failure and
retry, originally stopped controls, acceptance-gated release. HBA helper tests
execute its actual file operations on temporary files, mocking SQL and DB probe;
they do not prove real PostgreSQL reload or live recovery.

Registry-loss acceptance additionally exercises absent/unreadable/garbage/empty
responses, refusal before payload and hook calls, repeated capture restore,
watchdog recovery with the DB unavailable, partial APPLY refusal, and actual PTY
supervisor propagation of exit 1 versus 75 and success 0. The registry suite
loads only its seven new tests, not inherited fixture tests a second time.

## Activation blockers (not waived by isolated PASS)

1. Owner decisions confirmed in conversation 3660 on 2026-10-03: continuous
   quiet APPLY, migrations only in a separately named writer phase, and refusal
   for an absent broker registry. Candidate implements refusal. Provisioning
   `ops_staging_leases` on master A requires a separately authorized step;
   this package does not install migration 099 or bypass the missing registry.
2. Separate main integration/reservations and entrypoint pin verification; main
   is still the earlier base. A standalone copied gate does not upgrade other
   entrypoints and cannot establish their mutual exclusion.
3. Reviewed ingress control, complete writer/drain inventory, stable original
   and prebuilt candidate fingerprints, exact HBA metadata and machine IDs;
   fill private manifest then generate/seal the final bundle BEFORE enter.
4. Coherent app/dependencies/config/uploads/DB backup under a proven quiet window
   and isolated restoration evidence. No automatic data rollback is provided.
5. Independent administrator installation/rehearsal: actual SSH disconnect,
   timer execution, live compare/reload/readback, backup capture interruption,
   alert delivery and recovery failure. Local PTY acceptance is not that proof.

G11 OPEN; production HOLD. No installation, maintenance activation, staging
deploy, restart, migration, merge or Ring 0/Ring 1 runtime change is authorized
by this preparation package.

## Integrated ingress readback (20920)

This source snapshot combines the earlier infrastructure and ingress packages;
apply it once, not alongside both superseded snapshots. Application candidate
remains `9ac8301d05ae623c27f8e97d7fe423abb4509ea7`.

`package.py` must be run from the repository layout: it seals sibling
`staging-ingress/control.py` as `ingress-control.py`. That file is a required
bundle pin. `adapter.py` sends its sealed bytes to the fixed staging helper,
which executes `execute(action, manifest.ingress)`. There is no fallback to a
mutable installed helper or cached systemd ActiveState. The nested ingress
manifest is sealed with the recovery manifest. Its target/machine ID must match
the outer manifest, its mode must be `approved-for-admin`, and the full nginx
configuration digest and reviewed prerequisites remain mandatory.

For the separately installed capture unit, require exact control.py bytes from
that same seal, and a JSON manifest semantically identical to `manifest.ingress`.
A different manifest (including state path or additional fields) is rejected by
the journal digest. Installed unit/script pins and configuration still need a
separate review; this package neither installs them nor enables maintenance.

Physical status contract:

- `closed`: journal says closed and the exact owned nft table matches it.
- `open`: table absent and either no prior session journal or phase open.
- `opening`: a durable open intent exists; rules must still match or already be
  absent. This permits retry only; it is not a quiet-window assertion.
- installing, draining, missing rules from a closed journal, malformed journal,
  nginx/manifest drift, unreadable nft or foreign rules: error / fail closed.

`control_states` maps only physical closed/open to legacy active/inactive for
compatibility. All other states refuse original/final/quiet assertions. The
recovery engine calls `recovery_ingress` after payload verification and before
HBA restoration or any writer action, on every retry. Without an ingress intent
only the original physical state is allowed. With an intent and original open
state, closed/open/own opening are recoverable. Failed close and drift never
reach HBA/writer restoration.

Opening writes `opening` durably before deleting the verified owned table; if
execution is lost before or after deletion, a retry validates and completes the
same action. Direct sealed opening works even if the oneshot is inactive;
subsequent stop of an active oneshot and a new physical readback reconcile it.
The oneshot's repeated ExecStop must use the same pinned helper/manifest and is
idempotent. Unknown table content is never deleted. No reset-failed is issued.

State directory must be absolute, precreated, root-owned/private and not a
symlink. Live installation must select a stable, protected directory (prefer
`/root/backups/temp/<unique-session>` for this procedure) and protect its parent
path. Prefix spelling is not an isolation guarantee; tests use private /tmp
fixtures. Before changing any runtime state the administrator must still create
and verify the required backup in `/root/backups/temp/`.

Partial recovery limitation remains: returned writers are not automatically
stopped if a later action fails, and opening can have taken effect before final
bookkeeping or refresh restoration fails. The gate remains blocked, but neither
the gate nor phase `opening` proves silence. APPLY/ACTIVATE unattended recovery
is still refused. No new live restore, database or installation claim is made.

Cleanup remains strict: see CLEANUP-QUARANTINE.md for the proposed exact approval
and evidence requirements. The manifest's proposal is informational; it enables
no failed-service exception. Both quiet assertions still require cleanup service
inactive. Existing .205 cron retirement requirements remain independent.
