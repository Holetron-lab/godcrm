#!/bin/bash
# sync-db.sh — Sync PostgreSQL database between prod (.205) and dev (.72)
#
# Usage:
#   ./scripts/sync-db.sh dump              # Create dump on current server
#   ./scripts/sync-db.sh restore <file>    # Restore dump on current server
#   ./scripts/sync-db.sh push-to-dev       # Dump + SCP to dev + restore on dev (run from prod)
#   ./scripts/sync-db.sh pull-from-prod    # SSH dump on prod + SCP + restore locally (run from dev)

set -euo pipefail

PROD_HOST="<LEGACY_IP>"
DEV_HOST="<DEV_IP>"
PROD_DB="godcrm_prod"
PROD_USER="godcrm"
DUMP_DIR="/tmp"
DUMP_FILE="godcrm_sync_$(date +%Y%m%d_%H%M%S).dump"
DUMP_PATH="${DUMP_DIR}/${DUMP_FILE}"
REMOTE_PROJECT="/root/production/business-crm"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[SYNC]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# Load .env from project root if available
load_env() {
    local env_file="${REMOTE_PROJECT}/.env"
    if [ -f "$env_file" ]; then
        export $(grep -E '^POSTGRES_' "$env_file" | xargs)
        export PGPASSWORD="${POSTGRES_PASSWORD:-}"
    fi
}

cmd_dump() {
    load_env
    local db="${POSTGRES_DB:-$PROD_DB}"
    local user="${POSTGRES_USER:-$PROD_USER}"
    local host="${POSTGRES_HOST:-localhost}"
    local port="${POSTGRES_PORT:-5432}"

    log "Dumping database '$db' on ${host}:${port}..."
    pg_dump -h "$host" -p "$port" -U "$user" -d "$db" \
        -Fc --no-owner --no-privileges \
        -f "$DUMP_PATH"

    local size=$(du -h "$DUMP_PATH" | cut -f1)
    log "Dump created: $DUMP_PATH ($size)"
    echo "$DUMP_PATH"
}

cmd_restore() {
    local dump_file="${1:-}"
    [ -z "$dump_file" ] && err "Usage: $0 restore <dump_file>"
    [ ! -f "$dump_file" ] && err "File not found: $dump_file"

    load_env
    local db="${POSTGRES_DB:-$PROD_DB}"
    local user="${POSTGRES_USER:-$PROD_USER}"
    local host="${POSTGRES_HOST:-localhost}"
    local port="${POSTGRES_PORT:-5432}"

    local size=$(du -h "$dump_file" | cut -f1)
    log "Restoring $dump_file ($size) into '$db' on ${host}:${port}..."

    warn "This will REPLACE all data in '$db'. Continuing in 3 seconds... (Ctrl+C to abort)"
    sleep 3

    pg_restore -h "$host" -p "$port" -U "$user" -d "$db" \
        --clean --if-exists --no-owner --no-privileges \
        -Fc "$dump_file" 2>&1 | grep -v "ERROR:  .* does not exist" || true

    log "Restore complete!"

    # Restart backend if running
    if command -v pm2 &>/dev/null; then
        log "Restarting backend via pm2..."
        pm2 restart business-crm 2>/dev/null || warn "pm2 restart skipped (process not found)"
    fi
}

cmd_push_to_dev() {
    log "=== PUSH TO DEV: dump locally, SCP to $DEV_HOST, restore ==="

    # Step 1: Dump
    local dump=$(cmd_dump)

    # Step 2: SCP to dev
    log "Copying dump to dev ($DEV_HOST)..."
    scp "$dump" "root@${DEV_HOST}:${DUMP_DIR}/"

    # Step 3: Restore on dev
    log "Restoring on dev..."
    ssh "root@${DEV_HOST}" "cd ${REMOTE_PROJECT} && bash scripts/sync-db.sh restore ${DUMP_DIR}/$(basename $dump)"

    # Cleanup
    rm -f "$dump"
    ssh "root@${DEV_HOST}" "rm -f ${DUMP_DIR}/$(basename $dump)"
    log "=== SYNC COMPLETE: prod → dev ==="
}

cmd_pull_from_prod() {
    log "=== PULL FROM PROD: dump on $PROD_HOST, SCP here, restore ==="

    # Step 1: Dump on prod
    log "Creating dump on prod ($PROD_HOST)..."
    local remote_dump=$(ssh "root@${PROD_HOST}" "cd ${REMOTE_PROJECT} && bash scripts/sync-db.sh dump" | tail -1)

    # Step 2: SCP to local
    log "Copying dump from prod..."
    scp "root@${PROD_HOST}:${remote_dump}" "${DUMP_DIR}/"
    local local_dump="${DUMP_DIR}/$(basename $remote_dump)"

    # Step 3: Restore locally
    cmd_restore "$local_dump"

    # Cleanup
    ssh "root@${PROD_HOST}" "rm -f ${remote_dump}"
    rm -f "$local_dump"
    log "=== SYNC COMPLETE: prod → dev ==="
}

# --- Main ---
case "${1:-help}" in
    dump)           cmd_dump ;;
    restore)        cmd_restore "${2:-}" ;;
    push-to-dev)    cmd_push_to_dev ;;
    pull-from-prod) cmd_pull_from_prod ;;
    *)
        echo "Usage: $0 {dump|restore <file>|push-to-dev|pull-from-prod}"
        echo ""
        echo "  dump              Create pg_dump on current server"
        echo "  restore <file>    Restore dump file on current server"
        echo "  push-to-dev       Run from PROD: dump → SCP → restore on dev"
        echo "  pull-from-prod    Run from DEV: SSH dump on prod → SCP → restore"
        exit 1
        ;;
esac
