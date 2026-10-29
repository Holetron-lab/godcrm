# Staging controls preparation — conversation 3660

Preparation only. G11 OPEN; production HOLD. This companion package changes no
existing entrypoint and is not an installation. It adds to infrastructure
`5b5fc0b851b20d5ffcd0c8f556ee10e928d65d18` and candidate
`9ac8301d05ae623c27f8e97d7fe423abb4509ea7`; it does not replace either history.
No application/frontend source changes. The missing registry still refuses new
operations. Keep quiet APPLY; migrations require a separately named writer phase.

## Exact cron retirement: administrator handoff

Only on staging `.72`, from an independently authorized administrator session.
Reserve the root crontab against ALL writers during the command; crontab has no
atomic compare-and-swap. A second digest check reduces but cannot remove that
race without this administrative exclusion. Do not stop global cron for this
one-line retirement. Original and proposed private files are in the evidence
directory; check their digests against the supplied private manifest.

1. Verify `.72` identity and fresh coordination readback. Verify the installed
   script's digest against this committed package. `--admin-apply` is an explicit
   mutating action, not authorization supplied by this document.
2. `python3 /REVIEWED/retire_cron.py --expected-sha256 ORIGINAL_DIGEST --admin-apply`
   saves a fresh private before/after backup under `/root/backups/temp`, fsyncs
   and verifies it, rechecks drift, then installs the candidate. It removes
   exactly `*/5 * * * * /root/scripts/sync-uploads.sh` and preserves all other
   bytes. Missing/duplicate/modified line or digest drift stops before install.
3. Require `CRON_RETIRED`, `POST_SHA256` and byte-exact readback. Re-run `crontab
   -u root -l` independently; compare with the backup's `.after`. A readback
   mismatch requires inspection, never automatic restoration of the old table.
4. Separately run `python3 /REVIEWED/sync_readback.py`. This inventories the sync
   parent/descendants and possible orphaned rsync/SSH children, printing PID,
   parent and name only. Nonempty result blocks completion. Revalidate PID start
   time/executable/ancestry before any separately authorized targeted drain; do
   not mass-kill SSH or node. Observe again after the next five-minute boundary.
5. Archive receipt and readbacks, then capture a NEW controls baseline. The old
   control archives contain the retired entry: NEVER reinstall those crontabs
   in generic restore. Retiring scheduling does not remove scripts/uploads or
   repair access to `.205`. Cron service stop/start does not rewrite crontab.

No cron installation, process termination or waiting across live cron boundaries
was performed in this preparation task.

## Ingress implementation and scope

`control.py` creates ONE owned nft table, `inet godcrm_staging_3660`:

- input: reject TCP `:5000` arriving on every non-loopback interface, IPv4/IPv6,
  including Docker bridges. There is no established-connection exception.
- output: reject loopback connections owned by verified nginx worker UID 33 to
  `:5000`, for every hostname/path including existing client HTTP keepalive.
- drain: `ss -Knt state connected '( sport = :5000 )'`, then require an empty
  socket readback. This destroys server-side TCP sockets, including idle SSE,
  WebSocket and external direct clients. It also ends any OLD localhost probe;
  NEW root/admin localhost acceptance connections remain possible.

The transport boundary covers all 22 observed `localhost:5000` proxy directives
in the five effective vhost files, across seven names: dev.godcrm.ai,
devcrm.hltrn.cc, crm.hltrn.cc, godcrm.ai/www.godcrm.ai, hltrn.cc/www.hltrn.cc.
These are configs on `.72`, not claims about public DNS or permission on NL.
No nginx reload/stop, server-wide maintenance return, worker kill, global
firewall flush or foreign table restore occurs. Static files, ACME and upstreams
on other ports remain available. API clients get nginx 502 while fenced; an
established streaming response ends, it cannot be retroactively given 502.

Nginx socket identity and reject semantics are documented by
[Netfilter](https://wiki.nftables.org/wiki-nftables/index.php/Matching_packet_metainformation).
TCP socket destruction is documented by
[iproute2 ss](https://man7.org/linux/man-pages/man8/ss.8.html).
Kernel/network acceptance is tested below, not inferred solely from rule text.

This is ingress exclusion, NOT proof of a quiet database: root-local workers,
in-flight HTTP handlers, scheduled jobs, editor sessions and DB connections must
still be stopped/drained/fenced by CAPTURE. Never declare quiet immediately on
socket destruction. It cannot undo a request already handed to the backend.

## Failure and restore contract

CLI refuses `review-only` manifests and wrong host/machine/config. Future
installation must seal actual manifest/code, verify UID of every host nginx
worker, full effective config, listener owner, firewall chain ordering, DNAT and
flowtable bypass, and grant an administrator-controlled session. A boolean in a
manifest is a checklist result, not a substitute for those checks.

Use a new root-owned 0700 state directory under `/root/backups/temp`. Capture
prior ruleset and verified hash before mutation; durable phases are installing,
draining, closed, open. An existing table is never adopted or overwritten.
Failure after table creation retains the fence. A crash before its readback was
journalled requires reviewed manual reconciliation. Failed drain does not mean
closed. Retrying already closed is a no-op so acceptance connections survive.
Open checks exact normalized owned rules; drift refuses deletion. Other nft
tables are preserved. A repeated successful open is harmless.

The unit is a template with non-existent REVIEWED paths and no enablement.
active=closed is meaningful ONLY with `control.py status`=closed and drain
evidence. The previous recovery adapter only checks systemd state: integration
must add this readback and a refusal on mismatch before activation. Failed
ExecStart can leave installed rules while unit=failed; never equate inactive or
failed with open. After an ambiguous install/drain, administrator inspection is
required. Runtime loss/reboot, watchdog and alarm delivery still need live
rehearsal. Keep ingress closed on unresolved recovery; never add automatic
ExecStopPost deletion. No production live test was run here.

## Landing API dependencies

Source review at base `8f358876` (unchanged application files in candidate):
`LandingPage.tsx` fetches `/api/v3/public/s/help/docs`; `LandingNewsSection` uses
`useBuildingInPublic` → public table 100245 rows. `routes/v3/public.js` reads via
the common database connection and public-space loader. There is no separate
landing database in this routing: `/api` goes to the same `:5000` backend.
The static shell/assets and ACME stay served. Help/news API and any other
landing API sharing the backend are intentionally unavailable in maintenance;
source handles these data errors by hiding the corresponding sections. This is
source evidence, not proof of exact deployed browser bundle/current app DB.
Preserving a working landing API requires an independently isolated data path;
no bypass for supposedly read-only requests is included.

## Writer attribution and cleanup

Fresh private inventory 2026-10-03 records process PID, cwd, executable, parent,
cgroup and safe script identifiers, without environment/token/complete argv.

| Actor | Attribution and maintenance treatment |
|---|---|
| PM2 godcrm + bdd-runner | Backend, schedulers and test writer; stop and drain descendants and DB sessions |
| root sync-uploads cron | Retired .205 bidirectional uploads copy; retire one entry, independently inspect children |
| architect-cron at :07/:37 | Writes through devcrm API and spawns workers; cron stop alone does not drain children |
| cleanup-stuck-vite cron.d every 10m | Kills matching builds older than 600s; stop scheduler and drain descendants before APPLY |
| cleanup-orphaned-nodes timer | Destructive process selector; see defect below; not a DB connection |
| controller refresh/deploy | Shared operation gate and timer exclusion on .128; new gate still uninstalled |
| backup-postgres/sqlite/to-worker | DB readers plus filesystem archive/config writers; drain before stable fingerprints |
| update-singbox-rules | Writes generated files; include mutable roots/cron exclusion |
| n8n-healthcheck | Can restart its service; cron exclusion, never restart diagnostically |
| extra node PID 1730 | var-manager-react.service, cwd /root/production/var-manager/react; unrelated service |
| extra node PIDs 4194147/4194163 | Docker playwright-mcp / vrt-api; no CRM bind mounts; browser/API access remains potential writer, blocked via ingress; VRT has own postgres container |
| searxng/vrt-ui/vrt-db | Separate containers/mounts; host-port input fence also covers bridge attempts to CRM |
| system maintenance | certbot/logrotate/tmp cleanup/package jobs can alter config/files; serialize stable-fingerprint interval with operators |
| manual SSH/VSCode | Interactive ability to write cannot be excluded by a process snapshot; owner must reserve tree and drain editors/tasks |

All previously unexplained node processes are attributed; zero unauthorized
writers is still a capture-time assertion, not proved by this snapshot.

Cleanup defect: the selector `ps aux | grep -E 'node' ...` matches its own name
`cleanup-orphaned-nodes.sh`. None of its exclusions remove that bash process;
the loop sends it SIGKILL. Logs explicitly show `Killing PID ... /bin/bash
/usr/local/bin/cleanup-orphaned-nodes.sh` at each timer run, matching systemd
Result=signal/ExecMainStatus=9. Snapshot: MainPID=0, empty ControlGroup, timer
active/waiting. No reset-failed or restart was executed. Replaying the selector
or fixing/rerunning this mass-kill script is outside this task.

Current adapter requires service=inactive, so failed remains an activation
blocker. Do not conceal it with reset-failed. Recommended separate decision:
quarantine its scheduling, preserve failed evidence, then update recovery
baseline/policy to leave it quarantined. This task does not stop the timer and
does not authorize blanket acceptance of failed units.

## Verification

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/staging-ingress -p 'test_controls.py' -v`

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/staging-ingress -p 'test_admin.py' -v`

`PYTHONDONTWRITEBYTECODE=1 unshare -n python3 scripts/staging-ingress/test_netns.py`

The last command requires a fresh root network namespace. It checks namespace
identity and loopback-only interfaces before any mutation, creates a private
veth/peer namespace, starts its own temporary nginx/backends and touches only
their sockets/rules. It proves IPv4/IPv6 direct refusal, idle connection drain,
SSE/WebSocket end, HTTP keepalive refusal, all seven modeled hostnames, static/
ACME/unrelated upstream preservation, localhost acceptance, drift and reopen.
It does not replay live TLS certificates, public DNS, actual firewall ordering,
actual nginx include files, live application behavior or recovery adapter.

## Recovery integration update (20920, preparation only)

Recovery now consumes `execute('status', sealed_manifest)` from the exact sealed
control.py bytes. It does not infer physical closure from systemd. Use identical
manifest content for the installed CLI capture unit and the nested recovery
manifest, and pin both installed script and unit before live execution. Existing
journals from older code lack manifest binding and are deliberately refused;
no silent journal migration is implemented. Use a newly reviewed session/state
directory only after administrative reconciliation of any existing fence.

`status` may now return `opening`: deletion was authorized in a durable journal
but final bookkeeping has not completed. This is NOT closed. Only retrying the
same `open` with exact matching/absent rules is supported. A failed close in
installing/draining is blocked, including automatic recovery; manual diagnosis
must preserve evidence and explicitly reconcile state. Do not delete the nft
table manually as a shortcut. New drift at any stage refuses reopening.

This update supports a private absolute root-owned state directory; the live
procedure still requires the administrator's verified backup under
`/root/backups/temp/` and a stable reviewed path protected against replacement.
