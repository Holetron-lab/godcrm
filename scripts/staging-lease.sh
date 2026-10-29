#!/bin/bash
# Shared staging maintenance contract for every staging entry point on .128:
# Makefile dev / sync-db / restart (hence Telegram /deploy_dev), dev-operation.sh
# and dev-refresh.sh (hence godcrm-dev-refresh.timer). One exclusive lock is held
# for the WHOLE operation, the gate is evaluated under that lock, and maintenance
# can only be opened while no operation holds it — no check-then-run race.
#
#   staging-lease.sh run -- CMD ARGS…   run one staging operation under the lock;
#                                       75 while another operation runs or
#                                       maintenance is active (holder excepted);
#                                       re-entrant for descendants of the holder
#   staging-lease.sh check              evaluate the gate only (0 / 75 / 1)
#   staging-lease.sh status             readback: lock, maintenance, holder, broker lease
#   staging-lease.sh enter --holder NAME --restore /abs/hook [--ttl SECONDS]
#                                       open maintenance; prints the holder token ONCE
#   staging-lease.sh heartbeat          holder keep-alive (STAGING_MAINTENANCE_TOKEN)
#   staging-lease.sh mark STEP          holder records the maintenance phase it enters
#                                       (precheck|capture|apply|activate|release) — a
#                                       write-ahead record the restore hook decides by
#   staging-lease.sh watchdog           from a timer: restore when the heartbeat is
#                                       lost, the ttl passed or a restore failed
#   staging-lease.sh restore [REASON]   run the hook pinned at enter; maintenance is
#                                       released only when it exits 0
#
# State: $STAGING_STATE_DIR (default /var/lib/godcrm-staging) — lock, maintenance
# (key=value record), heartbeat (epoch), history/<id>[.restore.log]. Only the
# sha256 of the token is stored; the hook's sha256 is pinned so a changed hook is
# never executed. Exit codes: 0 ok · 75 not now (blocked/busy) · 1 fail closed
# (unknown state, unreadable DB, failed restore) · 2 usage.
#
# The broker registry (ops_staging_leases on master A, STAGING_LEASE_TOKEN) is a
# second, mandatory gate for every NEW modifying operation (run, enter — the active
# holder included): a live foreign lease → 75; an absent table, an unreadable DB
# or an unexpected answer → 1 before any payload. Absence is never readiness
# (owner decision, chat 3660). Recovery of an ALREADY OPEN maintenance never needs
# the registry: heartbeat, mark, restore and watchdog work from the local record
# alone, still bound to the pinned hook, the recorded step and a 0 exit to release.
set -euo pipefail
umask 077
STATE="${STAGING_STATE_DIR:-/var/lib/godcrm-staging}"
DB="${STAGING_LEASE_DB:-godcrm_prod}"
STALE="${STAGING_HEARTBEAT_STALE_SECONDS:-180}"
LOCK_WAIT="${STAGING_LOCK_WAIT_SECONDS:-30}"
MAX_TTL=14400
KEYS=(id holder phase step token_sha256 entered_at expires_at restore_hook restore_hook_sha256 restore_attempts last_restore_exit last_restore_at)

log() { echo "[staging-lease] $*" >&2; }
die() { log "$1"; exit "${2:-1}"; }
usage() { die 'Usage: staging-lease.sh run -- CMD… | check | status | enter --holder NAME --restore /abs/hook [--ttl SEC] | heartbeat | mark STEP | watchdog | restore [REASON]' 2; }
now() { date +%s; }
iso() { date -u -d "@$1" +%FT%TZ; }
sha_file() { sha256sum "$1" | cut -c1-64; }
sha_str() { printf '%s' "$1" | sha256sum | cut -c1-64; }

ensure_state() {
  mkdir -p -m 700 "$STATE" "$STATE/history" 2>/dev/null && [ -w "$STATE" ] \
    || die "cannot use state dir $STATE — refusing (fail closed)"
  STATE=$(cd "$STATE" && pwd -P)
  LOCK="$STATE/lock" CURRENT="$STATE/maintenance" HEARTBEAT="$STATE/heartbeat" HISTORY="$STATE/history"
}

# Load the maintenance record into m_<key>. Returns 1 = none, 2 = corrupt.
load_state() {
  local k v; for k in "${KEYS[@]}"; do unset "m_$k"; done
  [ -e "$CURRENT" ] || return 1
  while IFS== read -r k v; do
    case " ${KEYS[*]} " in *" $k "*) printf -v "m_$k" '%s' "$v" ;; esac
  done < "$CURRENT"
  [ -n "${m_id:-}" ] && [ -n "${m_holder:-}" ] && [ -n "${m_phase:-}" ] && [ -n "${m_token_sha256:-}" ] \
    && [ -n "${m_expires_at:-}" ] && [ -n "${m_restore_hook:-}" ] && [ -n "${m_restore_hook_sha256:-}" ] || return 2
}
save_state() {
  local k ref; : > "$CURRENT.tmp"
  for k in "${KEYS[@]}"; do ref="m_$k"; printf '%s=%s\n' "$k" "${!ref:-}" >> "$CURRENT.tmp"; done
  mv -f "$CURRENT.tmp" "$CURRENT"
}
# load_state with the corrupt case handled; returns 0 loaded, 1 none.
load_or_die() { local rc=0; load_state || rc=$?; [ "$rc" != 2 ] || die "corrupt maintenance record $CURRENT — refusing (fail closed)"; return "$rc"; }
describe() { echo "maintenance $m_id holder=$m_holder phase=$m_phase step=${m_step:-} entered=$(iso "$m_entered_at") expires=$(iso "$m_expires_at")"; }
holder_ok() { [ "$m_phase" = active ] && [ -n "${STAGING_MAINTENANCE_TOKEN:-}" ] && [ "$(sha_str "$STAGING_MAINTENANCE_TOKEN")" = "$m_token_sha256" ]; }
touch_heartbeat() { now > "$HEARTBEAT.tmp" && mv -f "$HEARTBEAT.tmp" "$HEARTBEAT"; }
heartbeat_age() { local hb; hb=$(cat "$HEARTBEAT" 2>/dev/null) || hb=0; echo $(( $(now) - ${hb:-0} )); }

# Broker registry gate; sets DB_LEASE (free | live … | absent | unreadable | unexpected).
# 0 registry present and no foreign live lease · 75 live lease · 1 fail closed.
db_gate() {
  # SQL goes to psql on stdin, never via -c: psql performs no variable interpolation
  # inside a -c string, so :'tok' reached the server literally (syntax error →
  # db_unreadable on a present registry; master A, chat 3660, 2026-10-04).
  local psql=(runuser -u postgres -- psql -d "$DB" -v ON_ERROR_STOP=1 -qAt -v "tok=${STAGING_LEASE_TOKEN:-}") exists live
  if ! exists=$("${psql[@]}" <<< "select to_regclass('public.ops_staging_leases') is not null"); then
    DB_LEASE=unreadable; log "cannot read $DB — refusing (fail closed)"; return 1
  fi
  case "$exists" in
    t) ;;
    f) DB_LEASE=absent; log "REFUSED: ops_staging_leases absent on $DB — the registry is required for every modifying staging operation, the maintenance holder included; refusing (fail closed)"; return 1 ;;
    *) DB_LEASE=unexpected; log "unexpected answer from $DB to the registry probe (${#exists} bytes) — refusing (fail closed)"; return 1 ;;
  esac
  if ! live=$("${psql[@]}" <<< "select id || ' ' || purpose || ' job=' || job_id || ' holder_pid=' || holder_pid
                                 || ' expires=' || to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || 'Z'
                            from ops_staging_leases
                           where released_at is null and expires_at > now() and holder_token <> :'tok'"); then
    DB_LEASE=unreadable; log "cannot read $DB — refusing (fail closed)"; return 1
  fi
  if [ -n "$live" ]; then DB_LEASE="live $live"; log "BLOCKED: live staging maintenance lease — $live"; return 75; fi
  DB_LEASE=free; log "registry present on $DB, no live broker lease"
}
# Full gate: local maintenance record, then the broker registry. Sets GATE_HOLDER.
gate() {
  GATE_HOLDER=0
  if load_or_die; then
    holder_ok || die "BLOCKED: $(describe)" 75
    GATE_HOLDER=1; log "holder of $(describe)"
  fi
  db_gate
}

is_ancestor() { local p=$$; while [ "$p" -gt 1 ]; do [ "$p" = "$1" ] && return 0; p=$(awk '/^PPid:/{print $2}' "/proc/$p/status" 2>/dev/null) || return 1; [ -n "$p" ] || return 1; done; return 1; }
holds_lock_file() { local f; for f in /proc/"$1"/fd/*; do [ "$(readlink "$f" 2>/dev/null)" = "$LOCK" ] && return 0; done; return 1; }
# True when this process runs inside the operation that holds the lock (make → deploy.sh …).
inside_locked_operation() { [ -n "${GODCRM_STAGING_LOCK_PID:-}" ] && is_ancestor "$GODCRM_STAGING_LOCK_PID" && holds_lock_file "$GODCRM_STAGING_LOCK_PID"; }

cmd_run() {
  [ "${1:-}" = -- ] && shift; [ $# -ge 1 ] || usage
  ensure_state
  # Nested inside the operation that holds the lock (make → deploy.sh …, or the very
  # pid `run` exec'd into): proceed without re-gating — and without touching fd 9,
  # because reopening it in the holder's own pid would drop the lock mid-operation.
  inside_locked_operation && { export GODCRM_STAGING_LOCK_PID=$$; exec "$@"; }
  exec 9>"$LOCK"
  flock -n 9 || die "another staging operation holds $LOCK — refusing" 75
  gate
  # The holder's operation learns the maintenance id: dev-operation.sh apply|activate require it.
  [ "$GATE_HOLDER" = 0 ] || { touch_heartbeat; export GODCRM_STAGING_MAINTENANCE_ID=$m_id; }
  export GODCRM_STAGING_LOCK_PID=$$
  exec "$@"   # fd 9 stays open: the lock lives exactly as long as the operation
}

cmd_check() { ensure_state; gate; echo "gate: free (holder=$GATE_HOLDER, broker lease: $DB_LEASE)"; }

# Readback for anyone. gate=ready (0) | blocked (75: maintenance or live lease) |
# refused (1: registry absent, DB unreadable/unexpected); reason= names the cause.
cmd_status() {
  ensure_state
  local lock=free code=0 gate=ready reason=; exec 9>"$LOCK"; flock -n 9 && flock -u 9 || lock=busy
  printf 'state_dir=%s\nlock=%s\n' "$STATE" "$lock"
  if load_or_die; then
    printf 'maintenance=%s\nid=%s\nholder=%s\nstep=%s\nentered_at=%s\nexpires_at=%s\nheartbeat_age=%s\nrestore_hook=%s\nrestore_attempts=%s\nlast_restore_exit=%s\n' \
      "$m_phase" "$m_id" "$m_holder" "${m_step:-}" "$(iso "$m_entered_at")" "$(iso "$m_expires_at")" "$(heartbeat_age)" "$m_restore_hook" "$m_restore_attempts" "$m_last_restore_exit"
    code=75 gate=blocked reason=maintenance_$m_phase
  else
    echo maintenance=none
  fi
  local rc=0; db_gate 2>/dev/null || rc=$?
  echo "db_lease=$DB_LEASE"
  case "$rc" in
    1) code=1 gate=refused; case "$DB_LEASE" in absent) reason=registry_absent ;; unreadable) reason=db_unreadable ;; *) reason=db_unexpected ;; esac ;;
    75) code=75; [ "$gate" != ready ] || gate=blocked reason=broker_lease_live ;;
  esac
  printf 'gate=%s\nreason=%s\n' "$gate" "$reason"
  exit "$code"
}

cmd_enter() {
  local holder= hook= ttl=3600
  while [ $# -gt 0 ]; do
    case $1 in
      --holder) holder=${2:-}; shift 2 ;; --restore) hook=${2:-}; shift 2 ;; --ttl) ttl=${2:-}; shift 2 ;; *) usage ;;
    esac
  done
  [[ "$holder" =~ ^[A-Za-z0-9._@-]{1,64}$ ]] || die '--holder NAME required (A-Za-z0-9._@-)' 2
  [[ "$hook" = /* ]] && [ -f "$hook" ] && [ -x "$hook" ] || die '--restore must be an absolute path to an executable restore hook' 2
  [[ "$ttl" =~ ^[0-9]+$ ]] && [ "$ttl" -ge 60 ] && [ "$ttl" -le "$MAX_TTL" ] || die "--ttl must be 60..$MAX_TTL seconds" 2
  ensure_state
  exec 9>"$LOCK"; flock -n 9 || die 'a staging operation is in progress — maintenance refused; retry when it finishes' 75
  if load_or_die; then die "already in $(describe) — refusing" 75; fi
  db_gate
  local token; token=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
  m_id="$(date -u +%Y%m%dT%H%M%SZ)-${token:0:8}" m_holder=$holder m_phase=active m_step=precheck m_token_sha256=$(sha_str "$token")
  m_entered_at=$(now) m_expires_at=$(( $(now) + ttl )) m_restore_hook=$hook m_restore_hook_sha256=$(sha_file "$hook")
  m_restore_attempts=0 m_last_restore_exit= m_last_restore_at=
  save_state; touch_heartbeat
  log "entered $(describe); restore hook $hook sha256=$m_restore_hook_sha256; heartbeat every <${STALE}s"
  echo "STAGING_MAINTENANCE_TOKEN=$token"
}

cmd_heartbeat() {
  ensure_state
  load_or_die || die 'no maintenance to heartbeat' 1
  holder_ok || die "heartbeat refused: not the active holder of $(describe)" 1
  touch_heartbeat; echo "heartbeat $m_id $(iso "$(now)")"
}

# Holder only. Taken under the lock (or from inside the holder's locked operation)
# so it can never interleave with a watchdog/restore rewriting the record.
cmd_mark() {
  case "${1:-}" in precheck|capture|apply|activate|release) ;; *) die 'mark STEP: precheck | capture | apply | activate | release' 2 ;; esac
  ensure_state
  if ! inside_locked_operation; then
    exec 9>"$LOCK"; flock -n 9 || die 'another staging operation holds the lock — mark postponed, run again' 75
  fi
  load_or_die || die 'no maintenance to mark' 1
  holder_ok || die "mark refused: not the active holder of $(describe)" 1
  m_step=$1; save_state; touch_heartbeat; echo "step=$m_step $(describe)"
}

# Under the lock, record loaded. Releases maintenance only when the hook exits 0.
do_restore() {
  local reason=$1 rc=0 logf="$HISTORY/$m_id.restore.log"
  m_restore_attempts=$((m_restore_attempts + 1)) m_last_restore_at=$(now)
  if [ "$(sha_file "$m_restore_hook" 2>/dev/null || echo missing)" != "$m_restore_hook_sha256" ]; then
    m_phase=restore_failed m_last_restore_exit=hook_sha256_mismatch; save_state
    die "restore hook $m_restore_hook changed since enter (sha256 mismatch) — not executed; maintenance $m_id stays blocked" 1
  fi
  m_phase=restoring; save_state
  log "restore #$m_restore_attempts reason=$reason hook=$m_restore_hook"
  STAGING_MAINTENANCE_ID=$m_id STAGING_MAINTENANCE_HOLDER=$m_holder STAGING_MAINTENANCE_STEP=${m_step:-} \
    STAGING_RESTORE_REASON=$reason STAGING_RESTORE_ATTEMPT=$m_restore_attempts \
    "$m_restore_hook" 2>&1 | tee -a "$logf" || rc=$?
  if [ "$rc" -ne 0 ]; then
    m_phase=restore_failed m_last_restore_exit=$rc; save_state
    die "restore hook exited $rc — maintenance $m_id stays blocked; fix and run 'restore' again" 1
  fi
  m_phase=restored m_last_restore_exit=0; save_state
  { cat "$CURRENT"; printf 'released_at=%s\nrelease_reason=%s\n' "$(now)" "$reason"; } > "$HISTORY/$m_id"
  rm -f "$CURRENT" "$HEARTBEAT"
  echo "MAINTENANCE_RELEASED id=$m_id reason=$reason attempts=$m_restore_attempts"
}

cmd_restore() {
  ensure_state; exec 9>"$LOCK"
  flock -w "$LOCK_WAIT" 9 || die 'a staging operation is in progress — restore postponed, run again' 75
  load_or_die || { echo 'no maintenance to restore'; return 0; }
  do_restore "${1:-manual}"
}

cmd_watchdog() {
  ensure_state; exec 9>"$LOCK"
  flock -w "$LOCK_WAIT" 9 || { log 'operation in progress — watchdog skipped'; return 0; }
  load_or_die || return 0
  local age reason=; age=$(heartbeat_age)
  if [ "$m_phase" != active ]; then reason=restore_retry
  elif [ "$(now)" -ge "$m_expires_at" ]; then reason=expired
  elif [ "$age" -gt "$STALE" ]; then reason=heartbeat_lost
  else echo "maintenance $m_id active (holder=$m_holder, heartbeat ${age}s ago)"; return 0
  fi
  do_restore "$reason"
}

case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  check) [ $# = 1 ] || usage; cmd_check ;;
  status) [ $# = 1 ] || usage; cmd_status ;;
  enter) shift; cmd_enter "$@" ;;
  heartbeat) [ $# = 1 ] || usage; cmd_heartbeat ;;
  mark) [ $# = 2 ] || usage; cmd_mark "$2" ;;
  watchdog) [ $# = 1 ] || usage; cmd_watchdog ;;
  restore) [ $# -le 2 ] || usage; cmd_restore "${2:-manual}" ;;
  *) usage ;;
esac
