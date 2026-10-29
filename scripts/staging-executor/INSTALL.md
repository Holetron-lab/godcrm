# Staging execution channel — installer / service contract

Conversation 3660, space 11, CHANNEL-RUNBOOK §"Bounded backend task". This
directory is the **independent staging executor**; the broker side lives in
`backend/services/ops/stagingExecutionBroker.js` + `backend/routes/v3/ops-staging.js`,
the agent tools are `ops_staging_grant_info` / `ops_staging_preflight`, the
quiet-window gate is `scripts/staging-lease.sh`. Nothing here is activated by
the commit: installation, key provisioning, tool assignment and the pilot are
administrator / Agent Smith / deploy-bot steps, in that order.

## What the channel is

```
agent (sysadmin, gate token)            godcrm (broker, .128)                 executor (root systemd, .128)
ops_staging_preflight ──HTTP──▶ POST /api/v3/ops/staging/preflight
  {action, job_id, candidate_sha}        re-read agent row, grant, exact SHA,
                                         installed executor digest, key
                                         run receipt (ops_staging_runs)
                                         preflight lease (ops_staging_leases)
                                         HMAC envelope ──Unix socket──▶  re-validate: action, role, target, repo,
                                         poll grant + heartbeat lease 1/s     own digest, freshness, nonce, deadline, peer uid
                                         EOF on revoke / lease lost          preflight.py (read-only, own session)
                                         ◀── signed report ──────────────   EOF ⇒ kill child ⇒ exit 124
                                         settle receipt, release lease
```

Server-owned and never taken from the request: identity (gate token minted at
spawn), role (agent row), grant, candidate SHA, target
(`dev72 / <DEV_IP> / dev.godcrm.ai / godcrm_test`), source repo,
executor root + digest, channel key, socket path. The only action is
`staging.preflight`; `deploy`, `restart`, data repair, production and Ring 1
have no code path on either side. A positive preflight never authorizes a
release (`authorizes_release: false` in every report).

Limits (pinned by the schema CHECKs and both sides): grant TTL ≤ 3600 s,
lease TTL ≤ 1800 s, preflight cap 120 s (the installation's
`STAGING_PREFLIGHT_TIMEOUT` always wins), request freshness ±60 s, one run at
a time (`busy`), one live lease per target (`lease_held`).

## Package contents (this directory in the implementation commit)

| File | Role |
|---|---|
| `executor.py` | socket server, HMAC + validation, child supervision |
| `preflight.py` | read-only checks (local + ssh dev72); sanitized JSON |
| `lease-watchdog.sh` | expires stale leases from outside the CRM runtime |
| `godcrm-staging-executor.service` | the executor unit (root, RuntimeDirectory, no new privileges) |
| `godcrm-staging-lease-watchdog.service/.timer` | watchdog every minute |
| `executor.env.example` | fixed executor configuration (no secrets) |
| `install.sh` | administrator installer (verify → versioned release → `current` symlink → units) |
| `test_executor.py` | validation-contract unit tests |
| `MANIFEST.sha256`, `MANIFEST.env` | shipped in the evidence package: file digests + `EXECUTOR_SHA256=<digest>` |

Executor digest = `sha256(name\0bytes\0 …)` over `executor.py`, `preflight.py`
(same formula in `stagingExecutorDigest()` and `executor.py --digest`).

## Installation (appointed SysAdmin, administrator session — not an agent turn)

1. **Receive the package**: exact implementation SHA, `MANIFEST.sha256`,
   `MANIFEST.env`, test logs, this file. Reject a package missing any item.
   Back up previous installation / units / env under
   `/root/backups/temp/<activation-id>/` (0700) before any write.
2. **Verify, then install**:
   ```
   bash install.sh <package-dir> <implementation-sha> --verify-only
   bash install.sh <package-dir> <implementation-sha>
   ```
   Lands in `/opt/godcrm-staging-executor/releases/<sha>/` (root:root, 0644
   files), switches `current` atomically, installs the three unit files,
   `daemon-reload`s. Nothing is started.
3. **Provision the channel key out of band** (never in Git, chat or the
   package): `openssl rand -hex 32 > /etc/godcrm-staging-executor/channel.key;
   chmod 600`. Review `/etc/godcrm-staging-executor/executor.env`
   (`STAGING_SOURCE_REPO=/root/production/business-crm`, `STAGING_COORD_DB=godcrm_prod`,
   `STAGING_PREFLIGHT_REMOTE=1`, `STAGING_PEER_UIDS=0`).
4. **Apply migration 099 on master A** (`ops_staging_grants/runs/leases`)
   through the authorized migration path. Until it is applied the broker
   routes fail with a database error and `staging-lease.sh` prints
   `gate inactive` and lets staging operations through (documented, deliberate:
   the gate cannot block the deploy that ships it).
5. **godcrm configuration** (`.env` on .128, loaded by the next non-agent
   restart — deploy-bot / owner, never the agent):
   ```
   OPS_STAGING_EXECUTOR_ROOT=/opt/godcrm-staging-executor/current
   OPS_STAGING_EXECUTOR_SHA256=<digest from install.sh>
   OPS_STAGING_SOCKET=/run/godcrm-staging-executor/executor.sock
   OPS_STAGING_CHANNEL_KEY_FILE=/etc/godcrm-staging-executor/channel.key
   OPS_STAGING_SOURCE_REPO=/root/production/business-crm
   OPS_STAGING_SPACE_ID=11
   ```
6. **Start only the new services**:
   `systemctl enable --now godcrm-staging-executor.service godcrm-staging-lease-watchdog.timer`.
   `journalctl -u godcrm-staging-executor` shows one JSON line with
   `listening`, `executor_sha256`, `remote_checks`, `source_repo`.
7. **Tool assignment** (Agent Smith): `ops_staging_grant_info`,
   `ops_staging_preflight` to the sysadmin agent only. The token is minted at
   spawn only while a live staging grant exists (`buildOpsGateEnv`).

## Pilot (real transport; shell harnesses are not acceptance evidence)

Owner / space-11 admin issues one grant:
`POST /api/v3/ops/staging/grants {space_id: 11, agent_id, job_id, candidate_sha, ttl_seconds}`
(`GET /api/v3/ops/staging/executor?space_id=11` must say `ok: true` first).

Then, from the sysadmin agent's chat turn: `ops_staging_grant_info` →
three `ops_staging_preflight` calls → retain `run_id`, `log_sha256`,
`executor_sha256`. Negative set, each must DENY before any staging contact
(owner reads `GET /ops/staging/runs?space_id=11`: `decision = deny` receipts):
wrong candidate SHA, `staging.deploy`, foreign job id, extra field, expired
grant, revoked grant, a second call while a `quiet-window` lease is live
(`lease_held`). Revoke during a run ⇒ `revoked`, run `failed/124`, lease
`released (revoked)`. `systemctl stop` of godcrm is NOT part of the pilot;
broker-death cleanup is proven by `POST /ops/staging/reap` after a simulated
dead pid (see the test) and by the watchdog journal.

Report `CONNECTED_FOR_PREFLIGHT` only after that; deployment capability stays
absent (not merely disabled: there is no action to enable).

## Quiet-window integration (prepared, not entered)

`ops_staging_leases` is the lease the QUIET-WINDOW protocol asks for: durable
run id, purpose, holder pid/token, inventoried `writers`, heartbeat, ≤30 min
expiry, release reason. Every official entry point checks it:
`scripts/dev-operation.sh` (after its flock), `scripts/dev-refresh.sh`
(after its flock; timer path included), `make dev / restart / sync-db`
(`lease-check` prerequisite — so Telegram `/deploy_dev` is covered). A holder
exports `STAGING_LEASE_TOKEN` to pass its own gate. The watchdog timer
releases expired / silent leases from outside the CRM runtime.

Not implemented (next, separately reviewed): the capture executor action that
would *take* a `quiet-window` lease, suppress the inventoried .72 crons
(`sync-uploads` */5, `architect-cron` 7,37, backup 03:00/03:15) with a
crontab-checksum guard, stop target processes and fence `godcrm_test`. Today
`preflight.py` only inventories them (`remote_cron_writers.unexcluded_writers`).

## Rollback

1. Revoke live grants (`DELETE /ops/staging/grants/:id`); confirm
   `GET /ops/staging/leases` shows no live lease (watchdog or `/ops/staging/reap`).
2. `systemctl disable --now godcrm-staging-executor.service godcrm-staging-lease-watchdog.timer`.
3. `ln -sfn /opt/godcrm-staging-executor/releases/<previous> /opt/godcrm-staging-executor/current`
   or remove `current`; keep `releases/<sha>` and the audit tables (evidence).
4. Remove `OPS_STAGING_*` from the godcrm `.env` only if the channel is being
   retired; the broker fails closed (`executor_pin_missing`) without them.
5. Do not touch godcrm / godcrm-edit / deploy-bot / other agents. Shell gates
   keep working: with no live lease they pass.
