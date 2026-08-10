#!/usr/bin/env bash
# Warm-standby sync: replicate live PROD (this media box) -> a Timeweb backup box.
# Replicates CODE + BUILD + DATA. Leaves the standby app STOPPED (dark) — no bot
# tokens, workers off, so zero external side-effects. Failover = see FAILOVER.md
# on the target box.
#
#   usage: sync-standby.sh <target-host> [via-jump-host]
#   e.g.   sync-standby.sh <NL_IP>                  # NL, direct
#          sync-standby.sh <RU_IP> root@MOSCOW_JUMP # RU, via Moscow jump
set -uo pipefail

TARGET="${1:?usage: sync-standby.sh <target-host> [ssh -J jump]}"
JUMP="${2:-}"                       # optional: "-J user@jumphost"
SRC=/root/production/business-crm
LOG=/var/log/godcrm-standby-sync.log
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 ${JUMP}"

exec >>"$LOG" 2>&1
echo "==================== $(date -u '+%F %T UTC') sync -> $TARGET ===================="

# 1. CODE (same excludes as the initial seed; never ship .env/secrets/uploads/dist)
rsync -az --delete-excluded \
  --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='dist.bak*' \
  --exclude='docs/.snapshots' --exclude='.env' --exclude='.exports-manual*' \
  --exclude='.scratch-coins' --exclude='uploads' --exclude='*.log' \
  --exclude='god_frame/build' \
  -e "$SSH" \
  "$SRC/" "root@$TARGET:$SRC/" || { echo "RSYNC FAILED"; exit 1; }
echo "[ok] code synced"

# 2. DEPS + BUILD (idempotent; npm ci is fast when lockfile unchanged)
$SSH "root@$TARGET" 'bash -s' <<EOF || { echo "BUILD FAILED"; exit 1; }
cd $SRC || exit 9
npm ci --no-audit --no-fund >/tmp/sync_npm.log 2>&1 || { echo "npm ci failed"; tail -5 /tmp/sync_npm.log; exit 1; }
export NODE_OPTIONS=--max-old-space-size=6144
npm run build >/tmp/sync_build.log 2>&1 || { echo "build failed"; tail -8 /tmp/sync_build.log; exit 1; }
echo "[ok] deps+build"
EOF

# 3. DATA (read-only pg_dump on PROD -> streamed pg_restore on standby)
sudo -u postgres pg_dump -Fc --no-owner --no-acl godcrm_prod 2>/tmp/standby_dump.err | \
  $SSH "root@$TARGET" "sudo -u postgres pg_restore --no-owner --role=godcrm --clean --if-exists -d godcrm_prod 2>/tmp/standby_restore.err"
RC=${PIPESTATUS[1]}
if [ "$RC" = "0" ]; then echo "[ok] data replicated"; else echo "DATA RESTORE rc=$RC"; fi

SIZE=$($SSH "root@$TARGET" "sudo -u postgres psql -d godcrm_prod -tAc \"SELECT pg_size_pretty(pg_database_size('godcrm_prod'))\"" 2>/dev/null)
echo "==================== done $(date -u '+%F %T UTC')  db=$SIZE ===================="
