#!/bin/bash
# One staging action, using the existing Make targets without changing OPS.
#   deploy | restart              online path: the app runs and the DB is reachable (as before)
#   precheck | apply | activate   maintenance phases (scripts/DEV-OPERATIONS.md §Maintenance phases):
#     precheck   read-only readback before CAPTURE: identity, source pin, writers, pending delta
#     apply      holder only; app stopped, DB may be fenced: backup → sync → build; PM2 is NOT started
#     activate   holder only; fence lifted: next-start identity → pm2 restart → runtime + loopback health
# Phases require EXPECTED_SHA explicitly and record their step in the maintenance
# record (staging-lease.sh mark) before touching anything — the restore hook decides by it.
set -euo pipefail
umask 077
PROJ=/root/production/business-crm
BACKUPS=/root/backups/temp
op=${1:-}
case "$op" in deploy) target=dev ;; restart) target=restart ;; precheck|apply|activate) target=$op ;;
  *) echo 'Usage: dev-operation.sh deploy|restart|precheck|apply|activate' >&2; exit 2 ;; esac
test "$#" = 1
# Shared staging lock + maintenance gate (staging-lease.sh), held for the whole
# operation: re-exec once under `run`, which hands the lock to this very pid.
[ "${GODCRM_STAGING_LOCK_PID:-}" = "$$" ] || exec bash "$PROJ/scripts/staging-lease.sh" run -- bash "$0" "$@"
cd "$PROJ"
source "$PROJ/scripts/deploy.local.env"
test "$DEV_HOST" = dev72 || { echo 'DEV_HOST must be staging alias dev72' >&2; exit 1; }
test "$(systemctl show godcrm-dev-refresh.service -p ActiveState --value)" = inactive
ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10)
local_machine=$(cat /etc/machine-id)
remote_machine=$(ssh "${ssh_opts[@]}" "$DEV_HOST" cat /etc/machine-id)
test -n "$remote_machine" && test "$local_machine" != "$remote_machine"
runtime_check() { ssh "${ssh_opts[@]}" "$DEV_HOST" "cd $PROJ && RUNTIME_CHECK_MODE=$1 node --input-type=module" < "$PROJ/scripts/dev-runtime-check.mjs"; }
health_ok() { node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const h=JSON.parse(s);if(h.status!=="ok"||h.database?.status!=="connected")process.exit(1)})'; }
# Committed main at the pinned SHA, nothing else in the tree (host-owned .mcp.json excepted).
source_pinned() { test "$(git rev-parse HEAD)" = "$sha" && test -z "$(git status --porcelain --untracked-files=no -- . ':!.mcp.json')"; }
sha=$(git rev-parse HEAD)
if [ "$target" != restart ]; then
  test "$(git branch --show-current)" = main
  [ "$target" = dev ] || test -n "${EXPECTED_SHA:-}" || { echo "$op requires EXPECTED_SHA=<committed main sha>" >&2; exit 1; }
  test "$sha" = "${EXPECTED_SHA:-$sha}"
  source_pinned
fi
case "$target" in apply|activate)
  # `run` exports the id only to the operation of the active maintenance holder.
  test -n "${GODCRM_STAGING_MAINTENANCE_ID:-}" || { echo "$op runs only as the holder of an active maintenance (staging-lease.sh enter, then STAGING_MAINTENANCE_TOKEN)" >&2; exit 1; }
  bash "$PROJ/scripts/staging-lease.sh" mark "$target" ;;
esac
case "$target" in apply) runtime_check stopped ;; activate) runtime_check next-start ;; *) runtime_check online ;; esac
if [ "$target" = precheck ]; then
  # Writer inventory: names and states only — jlist carries the process environment.
  ssh "${ssh_opts[@]}" "$DEV_HOST" "pm2 jlist" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log("pm2:",JSON.parse(s).map(p=>`${p.name}=${p.pm2_env.status}`).join(" ")))'
  echo "staging units: $(ssh "${ssh_opts[@]}" "$DEV_HOST" "systemctl is-active cron.service cleanup-orphaned-nodes.timer" | tr '\n' ' ')"
  echo "pending delta vs $sha: $(bash "$PROJ/scripts/staging-sync.sh" "$PROJ" "$DEV_HOST:$PROJ/" --dry-run | grep -c -E '^(>f|<f|c)' || true) paths"
  echo "DEV precheck ok; source $sha"
  exit 0
fi
backup="$BACKUPS/dev-$target-$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -m 700 "$backup"
case "$target" in
  dev|apply)
    ssh "${ssh_opts[@]}" "$DEV_HOST" "tar -C $PROJ --exclude=./node_modules --exclude=./.git --exclude=./logs --exclude=./.cache --exclude=./uploads --exclude=./pes-core/pes-data -cf - ." > "$backup/staging.tar"
    tar -cf "$backup/local.tar" -C "$PROJ" dist .mcp.json ;;
  *) ssh "${ssh_opts[@]}" "$DEV_HOST" "tar -C $PROJ -cf - .env .mcp.json package.json package-lock.json dist/index.html" > "$backup/staging.tar" ;;
esac
tar -tf "$backup/staging.tar" > "$backup/members.txt"
(cd "$backup" && sha256sum ./*.tar > SHA256SUMS && sha256sum -c SHA256SUMS)
echo "DEV backup: $backup; source: $sha; operation: $target"
case "$target" in
  dev) make -C "$PROJ" dev ;;
  apply) DEPLOY_NO_RESTART=1 make -C "$PROJ" dev ;;
  *) make -C "$PROJ" restart ;;
esac
if [ "$target" = apply ]; then
  source_pinned
  # Payload pinned: the staging tree now equals committed $sha for every manifest path
  # (content transfers or creations pending = drift; attribute-only lines are not).
  drift=$(bash "$PROJ/scripts/staging-sync.sh" "$PROJ" "$DEV_HOST:$PROJ/" --dry-run | grep -E '^(>f|<f|c)' || true)
  test -z "$drift" || { printf 'staging tree differs from %s after apply:\n%s\n' "$sha" "$drift" >&2; exit 1; }
  runtime_check stopped
  echo "DEV apply complete; source $sha; godcrm stopped — lift the fence, then: dev-operation.sh activate"
  exit 0
fi
[ "$target" != dev ] || source_pinned
runtime_check online
if [ "$target" = activate ]; then
  # Ingress stays closed until RELEASE: health is read on the staging loopback only.
  ssh "${ssh_opts[@]}" "$DEV_HOST" "curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-connrefused --max-time 10 http://127.0.0.1:5000/api/health" | health_ok
  echo "DEV activate healthy; source $sha — ingress and background writers stay closed until acceptance and RELEASE"
  exit 0
fi
curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-connrefused --max-time 10 https://dev.godcrm.ai/api/health | health_ok
curl --fail --silent --show-error --max-time 15 https://dev.godcrm.ai/ > /dev/null
echo "DEV $target healthy; source $sha"
