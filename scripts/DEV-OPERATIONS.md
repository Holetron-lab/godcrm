# Dev operations

Run on the EDIT host from committed main, as the authorized staging executor:

```
bash scripts/dev-operation.sh restart
EXPECTED_SHA=<full-committed-main-sha> bash scripts/dev-operation.sh deploy
```

The wrapper uses existing `make restart` / `make dev`. It checks the `dev72`
destination, separate machine identity, actual `godcrm_test` connection for both
current and next-start environment and refresh inactivity. It creates and
verifies a private backup under `/root/backups/temp`, then checks runtime DB and
public health after execution. Restart does not build or sync source. Deploy
requires clean tracked main (except host-owned `.mcp.json`, excluded from sync).
Both need the application online; for a quiescent maintenance window use the
phased `precheck` / `apply` / `activate` commands described below.
The executor still holds the existing main integration reservation/mutex through
deploy to prevent source changes.

No per-step manual approval is part of this wrapper. Host sandbox grants remain
external. OPS diagnostics/local-qa tokens do not authorize deployment and are not
used or minted here. Production commands are outside this entry point.

## Staging maintenance contract (`scripts/staging-lease.sh`)

Every staging entry point on .128 — `make dev` / `make sync-db` / `make restart`
(so the Telegram `/deploy_dev` too), `dev-operation.sh` and `dev-refresh.sh`
(so `godcrm-dev-refresh.timer` too) — runs under `staging-lease.sh run`: one
exclusive lock (`/var/lib/godcrm-staging/lock`) is held for the **whole**
operation, the gate is evaluated under that lock, and maintenance can only be
opened while nobody holds it. There is no window between a gate check and the
operation. The lock is re-entrant for the operation's own descendants only
(`make dev` inside `dev-operation.sh`): a forged `GODCRM_STAGING_LOCK_PID` is
ignored unless that pid is an ancestor that really holds the lock file.

Gate (fail closed): an unusable state dir or a corrupt maintenance record → 1;
an active, restoring or failed maintenance → 75 (the active holder passes with
`STAGING_MAINTENANCE_TOKEN`); the broker registry (`ops_staging_leases` on
master A) → 75 when a foreign lease is live, **1 when the table is absent, the
DB is unreadable or the probe answers anything but `t`/`f`**. Both gates are
mandatory for every *new* modifying operation (`run`, `enter`) — the active
holder gets no bypass — and are evaluated before any payload, so a missing
registry is a refusal, never readiness (owner decision, conversation 3660:
«при отсутствии таблицы — отказ»). Until the registry exists on master A every
staging deploy/refresh is therefore blocked by design; provisioning it is a
separate, owner-authorized step, not something these scripts do or work around.

Recovery of an *already open* maintenance does not depend on the registry:
`heartbeat`, `mark`, `restore` and `watchdog` read only the local record, so a
registry that disappears or a DB that stops answering after `enter` cannot strand
the window. They stay bound to the hook pinned at `enter` (a changed hook is never
run), the recorded step (`apply`/`activate` → the hook refuses to start an
unverified tree) and a 0 exit to release; a failing restore keeps everyone
blocked, and the exception grants no new deploy/refresh/apply. Nesting inside an
operation admitted under the gate (`make dev` inside `dev-operation.sh`) is
unchanged: descendants never re-gate, so the registry answer at admission binds
the whole operation.

## Maintenance phases (`dev-operation.sh precheck | apply | activate`)

`deploy` needs the application online and the database reachable twice (before
and after `make dev`) and `deploy.sh` always restarts PM2. A quiescent window —
application stopped, writers excluded, HBA fence rejecting the application role —
therefore cannot use `deploy`. The phased path keeps every identity check and
splits the operation at the points where the infrastructure state changes.
Entry/exit state of each phase is the contract between this script and the
infrastructure runbook (writer exclusion, fence, backup, restore hook — infra-owned).

| Phase | Command (holder session on .128) | Requires on entry | Does | Leaves |
|---|---|---|---|---|
| PRECHECK | `EXPECTED_SHA=<sha> bash scripts/dev-operation.sh precheck` (works before `enter` or as holder) | gate free or held by this holder; app online; `godcrm_test` current + next-start (`RUNTIME_CHECK_MODE=online`); committed clean `main` == `EXPECTED_SHA`; refresh inactive | read-only: machine identity, PM2 names/states (never the env), `cron.service` / `cleanup-orphaned-nodes.timer` state, pending delta (`staging-sync.sh --dry-run`, content lines only) | nothing changed |
| CAPTURE | infra: `enter` → heartbeat → `mark capture` → exclude writers → fence → coherent DB + uploads + app backup, verified | maintenance active, step `precheck` | — (not this script) | app **stopped**, fence **on**, backups verified, step `capture` |
| APPLY | `EXPECTED_SHA=<sha> bash scripts/dev-operation.sh apply` | holder (`STAGING_MAINTENANCE_TOKEN`; `run` exports `GODCRM_STAGING_MAINTENANCE_ID` only to the holder's operation); app **not online**; next-start settings name `godcrm_test` on loopback and the peer `postgres` socket confirms that database (`RUNTIME_CHECK_MODE=stopped` — the application role is never used, so the fence may stay) | `mark apply` (write-ahead) → app-tree backup to `/root/backups/temp` → `DEPLOY_NO_RESTART=1 make dev` (sync committed paths, `npm install`, build on .72; **PM2 untouched**) → source still pinned → payload pinned: `staging-sync.sh --dry-run` reports no content transfer or creation → `RUNTIME_CHECK_MODE=stopped` again | app stopped on the new tree, fence on, step `apply` |
| ACTIVATE | infra lifts the fence (compare-and-restore HBA + verified reload), then `EXPECTED_SHA=<sha> bash scripts/dev-operation.sh activate` | holder; app **not online**; next-start settings **really connect** to `godcrm_test` as the application role (`RUNTIME_CHECK_MODE=next-start`) — a still-present fence fails here, before anything starts | `mark activate` → config backup → `make restart` (`pm2 restart godcrm --update-env`, the only process touched) → `RUNTIME_CHECK_MODE=online` (current + next-start) → `/api/health` on the **staging loopback** `127.0.0.1:5000` only | app online on the new tree; ingress, cron, bdd-runner, cleanup timer, refresh timer still closed; step `activate` |
| RELEASE | acceptance (QA on the closed stand), then `mark release` → `restore holder_exit` | holder; acceptance recorded | hook restores only controls this session changed, to their captured originals; released only on exit 0 | gate free, history row with `step=release` |

Failure state, per phase: the script exits non-zero and leaves the maintenance
record untouched except for its step; the lock is dropped with the process, the
holder token stays valid, the heartbeat keeps the watchdog quiet while the
session lives. `precheck` changes nothing. `apply` after a failed sync/build
leaves a tree that may differ from both the backup and `EXPECTED_SHA` — starting
it is not a rollback; `activate` after a failed start/identity check leaves the
app stopped or on an unverified tree. In both cases the restore hook is called
with `STAGING_MAINTENANCE_STEP=apply|activate` and must not start the
application unless the artifact fingerprints match a verified state; it keeps
the window blocked (non-zero exit) otherwise. `EXPECTED_SHA` is mandatory for
every phase (no default to `HEAD`); `apply`/`activate` without an active
maintenance held by this session exit 1 before touching anything.

Maintenance flow for the administrator (separate root session on .128):

```
# 1. open — refused (75) while a deploy/refresh runs or maintenance exists
bash scripts/staging-lease.sh enter --holder sysadmin-3660 \
     --restore /root/backups/temp/<window>/restore.sh --ttl 3600
#    → prints STAGING_MAINTENANCE_TOKEN=… exactly once; export it in this session
# 2. keep-alive — the holder beats at least every 180 s (STAGING_HEARTBEAT_STALE_SECONDS);
#    the infra supervisor owns this loop and must stop it when the session ends
( while sleep 60; do bash scripts/staging-lease.sh heartbeat || break; done ) &
# 3. PRECHECK (read-only) → CAPTURE (infra: mark capture, exclude writers, fence, backups)
EXPECTED_SHA=<sha> bash scripts/dev-operation.sh precheck
bash scripts/staging-lease.sh mark capture        # then the infra capture script
# 4. APPLY with the app stopped and the fence on; PM2 is not started
EXPECTED_SHA=<sha> bash scripts/dev-operation.sh apply
# 5. ACTIVATE: infra lifts the fence (verified reload), then
EXPECTED_SHA=<sha> bash scripts/dev-operation.sh activate
# 6. RELEASE after acceptance: runs the pinned restore hook; released ONLY when it exits 0
bash scripts/staging-lease.sh mark release
bash scripts/staging-lease.sh restore holder_exit
bash scripts/staging-lease.sh status              # readback for anyone
```

Restore hook contract: an absolute executable path whose sha256 is pinned at
`enter` (a changed hook is never executed); idempotent — it reverses the
capture step (HBA, processes, schedules) and may run several times; receives
`STAGING_MAINTENANCE_ID`, `STAGING_MAINTENANCE_HOLDER`, `STAGING_MAINTENANCE_STEP`
(`precheck` | `capture` | `apply` | `activate` | `release` — the last step the
holder entered, recorded before that step acted), `STAGING_RESTORE_REASON`
(`holder_exit` | `heartbeat_lost` | `expired` | `restore_retry` | `manual`) and
`STAGING_RESTORE_ATTEMPT`; its output is appended to
`/var/lib/godcrm-staging/history/<id>.restore.log`. Steps `precheck` and
`capture` mean the application tree is untouched: returning the captured
processes is safe. Steps `apply` and `activate` mean the tree, dependencies or
bundle may have changed: the hook may start the application only against a
verified fingerprint (captured backup restored, or `activate` already accepted)
and otherwise exits non-zero. A non-zero exit leaves the record in
`restore_failed`: every entry point, the holder included, stays blocked until
`restore` succeeds; `restore` on a released state is a no-op.

`mark STEP` is holder-only and is taken under the lock (or from inside the
holder's own locked operation), so it never interleaves with a watchdog restore;
while a foreign operation holds the lock it returns 75 and must be repeated.

Watchdog: a systemd timer on .128 (infra-owned, outside the CRM runtime) runs
`bash scripts/staging-lease.sh watchdog` every minute. It restores when the
heartbeat is older than 180 s (the holder's session died), when the ttl passed
(default 3600 s, max 14400 s) or when a previous restore failed. It waits up to
`STAGING_LOCK_WAIT_SECONDS` (30) for a running operation and otherwise skips the
tick — an operation in flight is never interrupted, so a hung deploy under
maintenance must be resolved by the administrator.

Readback: `bash scripts/staging-lease.sh status` (`make lease-check`) prints
`lock=`, `maintenance=none|active|restoring|restore_failed`, `id=`, `holder=`,
`step=`, `entered_at=`, `expires_at=`, `heartbeat_age=`, `restore_hook=`,
`restore_attempts=`, `last_restore_exit=`, `db_lease=free|live …|absent|unreadable|unexpected`,
`gate=ready|blocked|refused` and `reason=` (`maintenance_<phase>`,
`broker_lease_live`, `registry_absent`, `db_unreadable`, `db_unexpected`); exit 0
ready, 75 blocked, 1 refused/unknown. The local owner and step are printed even
when the registry is missing, so `gate=refused reason=registry_absent` together
with `holder=` is the expected readback of a window that must be recovered while
the registry is gone. History of released windows: `/var/lib/godcrm-staging/history/<id>`.

On failure, preserve the log and backup path; do not report success or blindly
retry a partially executed deployment. Rollback uses the previous known good
committed source, integrated through the normal main workflow, then this same
deploy path. Backups exclude node_modules and user uploads, and contain no DB
dump: no database rollback or tested runtime restoration is implied.
