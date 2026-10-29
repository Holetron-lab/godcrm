#!/bin/bash
# =============================================================================
# GOD CRM — Deploy Script
# =============================================================================
# Runs from the agent-home / PROD-master box (master A, Ring 0) where Claude
# Code and the source tree live.
#
# Layout:
#   PROD (agent-home) code:       /root/production/business-crm/
#   PROD (agent-home) nginx root: /var/www/business-crm/
#   PROD (agent-home) PM2:        godcrm
#
#   DEV  code:       /root/production/business-crm/ (rsync copy)
#   DEV  nginx root: /var/www/business-crm-dev → symlink to dist/
#   DEV  PM2:        godcrm
#   DEV  host/URL:   resolved from git-ignored scripts/deploy.local.env
#                    (DEV_HOST=root@<real-ip>) — no infra IPs in tracked files
#
# Usage:
#   ./scripts/deploy.sh dev           # sync code to DEV, build, restart
#   ./scripts/deploy.sh prod          # build + deploy PROD
#   ./scripts/deploy.sh both          # deploy to both (must be explicit)
#   ./scripts/deploy.sh sync-db       # copy PROD DB to DEV
#   ./scripts/deploy.sh --skip-build dev  # skip build, just restart
# =============================================================================

set -euo pipefail

PROJ="/root/production/business-crm"
# DEV_HOST / DEV_URL resolve from the git-ignored scripts/deploy.local.env so
# real infra IPs stay out of tracked files. The placeholder default below is
# only a fallback if that file is missing (deploy aborts if left unresolved).
DEV_HOST="root@<DEV_IP>"
DEV_URL="https://devcrm.hltrn.cc"
PROD_NGINX="/var/www/business-crm"
PM2_NAME="godcrm"
SKIP_BUILD=false
TARGET=""

# Source local infra overrides (DEV_HOST, DEV_URL, DEV_DB_PASS). Git-ignored.
if [ -f "$PROJ/scripts/deploy.local.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$PROJ/scripts/deploy.local.env"; set +a
fi
if [ "$DEV_HOST" = "root@<DEV_IP>" ]; then
  echo "ERROR: DEV_HOST unresolved — scripts/deploy.local.env missing or DEV_HOST unset."
  echo "       Create it with: DEV_HOST=root@<real-dev-ip>"
  exit 1
fi

# Parse args
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    dev)          TARGET="dev" ;;
    prod)         TARGET="prod" ;;
    both)         TARGET="both" ;;
    sync-db)      TARGET="sync-db" ;;
  esac
done

# Require explicit target — never default to "both"
if [ -z "$TARGET" ]; then
  echo "ERROR: No target specified. Usage:"
  echo "  $0 dev        # deploy to DEV only"
  echo "  $0 prod       # deploy to PROD only"
  echo "  $0 both       # deploy to both (explicit)"
  echo "  $0 sync-db    # sync PROD DB → DEV"
  exit 1
fi

echo "============================================"
echo "  GOD CRM Deploy"
echo "  Target: $TARGET | Skip build: $SKIP_BUILD"
echo "============================================"

# --- Sync DB ---
# ADR-156 iter-5 Task 6: read DB password from .env, pass via PGPASSWORD to
# both pg_dump (PROD) and pg_restore (DEV). No more `|| true` swallowers —
# any failure aborts the sync with a non-zero exit code.
if [ "$TARGET" = "sync-db" ]; then
  # Source POSTGRES_PASSWORD from local .env (PROD side of the dump).
  if [ -f "$PROJ/.env" ]; then
    # shellcheck disable=SC1091,SC2046
    export $(grep -E '^POSTGRES_PASSWORD=' "$PROJ/.env" | xargs -d '\n' || true)
  fi
  if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    echo "ERROR: POSTGRES_PASSWORD not set (export it or add to $PROJ/.env)"
    exit 1
  fi


  echo "[DB] Dumping PROD database..."
  # -n public: the godcrm role has no access to the hindsight/hindsight_v2
  # schemas (they have their own backup chain and must not land on DEV).
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U godcrm -h localhost godcrm_prod -n public -Fc -f /tmp/godcrm_prod.dump
  echo "[DB] Copying dump to DEV..."
  scp /tmp/godcrm_prod.dump "$DEV_HOST:/tmp/"
  echo "[DB] Restoring on DEV (drop + recreate)..."
  # Repopulate = recreate the DB wholesale: --clean into a lived-in DB trips on
  # local-only objects and missing prod roles. Local superuser socket on DEV —
  # the DEV role password differs per box and must not be assumed. --no-owner
  # --role=godcrm keeps objects app-owned; --no-acl skips prod-only grants.
  ssh "$DEV_HOST" "sudo -u postgres psql -qc 'DROP DATABASE IF EXISTS godcrm_prod WITH (FORCE)' \
    && sudo -u postgres psql -qc 'CREATE DATABASE godcrm_prod OWNER godcrm' \
    && sudo -u postgres pg_restore --no-owner --no-acl --role=godcrm -d godcrm_prod /tmp/godcrm_prod.dump"
  echo "=== DB SYNC COMPLETE ==="
  exit 0
fi

# --- File size check ---
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "[CHECK] File line limit (max 800)..."
  if ! bash "$PROJ/scripts/check-file-lines.sh" --max 800 --path "$PROJ/src"; then
    echo ""
    echo "WARNING: Some files exceed 800 lines. Deploy continues but refactoring is needed."
    echo ""
  fi
fi

# --- Build ---
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "[BUILD] Building frontend..."
  cd "$PROJ"
  npm run build 2>&1 | tail -5
  echo "[BUILD] Done."
else
  echo "[BUILD] Skipped"
fi

# Verify dist
if [ ! -f "$PROJ/dist/index.html" ]; then
  echo "ERROR: dist/index.html not found!"
  exit 1
fi

HASH=$(grep -o 'index-[^"]*\.js' "$PROJ/dist/index.html" 2>/dev/null || echo "unknown")

# --- Deploy to DEV (host from deploy.local.env) ---
if [ "$TARGET" = "dev" ] || [ "$TARGET" = "both" ]; then
  echo ""
  echo "[DEV] Syncing code PROD → DEV..."
  # Only committed paths; preserve staging-owned configuration and runtime data.
  bash "$PROJ/scripts/staging-sync.sh" "$PROJ" "$DEV_HOST:$PROJ/"

  echo "[DEV] Building on DEV..."
  # SSH starts a fresh shell: local pipefail does not protect remote pipelines.
  ssh "$DEV_HOST" "bash -o pipefail -c 'npm --prefix $PROJ install --no-audit 2>&1 | tail -1 && npm --prefix $PROJ run build 2>&1 | tail -3'"

  # Maintenance APPLY (dev-operation.sh apply) syncs and builds with the app
  # stopped and the DB fenced; ACTIVATE starts it later, after the identity check.
  if [ "${DEPLOY_NO_RESTART:-0}" = 1 ]; then
    echo "[DEV] PM2 restart skipped (DEPLOY_NO_RESTART=1 — maintenance apply; activate starts $PM2_NAME)"
  else
    echo "[DEV] Restarting PM2..."
    ssh "$DEV_HOST" "cd $PROJ && pm2 restart $PM2_NAME --update-env" 2>&1 | tail -3
  fi

  DEV_HASH=$(ssh "$DEV_HOST" "grep -o 'index-[^\"]*\.js' $PROJ/dist/index.html 2>/dev/null" || echo "unknown")
  echo "[DEV] Done. Bundle: $DEV_HASH"
  echo "[DEV] URL: $DEV_URL"
fi

# --- Deploy to PROD (local) ---
if [ "$TARGET" = "prod" ] || [ "$TARGET" = "both" ]; then
  echo ""
  # Safety check: confirm PROD deploy
  if [ -t 0 ]; then
    read -r -p "[PROD] About to restart PROD PM2 on $(hostname). Continue? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "[PROD] Aborted."
      exit 1
    fi
  fi

  # ADR-0010 §4.1 — Tooling barrier (C-1 + C-3).
  # Step 1: strip test-scripts from package.json (regex-based, idempotent,
  # adds `_test_scripts_stripped: true` sentinel). Helper is unit-tested
  # against ADR §B cases — see scripts/strip-test-scripts.test.mjs.
  echo "[PROD] [ADR-0010] Stripping test scripts from package.json..."
  node "$PROJ/scripts/strip-test-scripts.mjs" "$PROJ/package.json"

  # Step 2: install prod-only deps so vitest / @playwright/test / etc. never
  # land in PROD node_modules. NEVER use `npm install` or `--production` here
  # — `npm ci --omit=dev` is the canonical path (deterministic, prunes
  # extraneous, omits devDependencies).
  echo "[PROD] [ADR-0010] Installing prod-only deps (npm ci --omit=dev)..."
  ( cd "$PROJ" && npm ci --omit=dev 2>&1 | tail -5 )

  # Step 3: post-install structural assertion (C-3). If a test runner is
  # present in node_modules the deploy is aborted before pm2 restart so
  # PROD never serves a vulnerable artifact.
  if [ -d "$PROJ/node_modules/vitest" ] || [ -d "$PROJ/node_modules/@playwright/test" ]; then
    echo "[PROD] [ADR-0010] FATAL: vitest or @playwright/test present in node_modules"
    echo "[PROD]              after npm ci --omit=dev. ADR-0010 C-3 violated."
    echo "[PROD]              Aborting deploy — fix devDeps classification first."
    exit 1
  fi
  echo "[PROD] [ADR-0010] OK — no test runners in node_modules."

  # ADR-0067 Q4 — defense-in-depth guard. The outer if-branch already gates
  # on $TARGET, but pin the tripwire to the dangerous line itself so a future
  # refactor of the branch can't silently expose $PROD_NGINX.
  if [ "$TARGET" != "prod" ] && [ "$TARGET" != "both" ]; then
    echo "[PROD] ABORT: refusing to write $PROD_NGINX from target '$TARGET'."
    echo "[PROD]        Only 'prod' or 'both' targets may touch nginx root."
    exit 1
  fi

  echo "[PROD] Copying dist to nginx root ($PROD_NGINX)..."
  cp -r "$PROJ/dist/"* "$PROD_NGINX/"

  echo "[PROD] Restarting PM2..."
  pm2 restart "$PM2_NAME" --update-env 2>&1 | tail -3

  PROD_HASH=$(grep -o 'index-[^"]*\.js' "$PROD_NGINX/index.html" 2>/dev/null || echo "unknown")
  echo "[PROD] Done. Bundle: $PROD_HASH"
  echo "[PROD] URL: https://crm.hltrn.cc"
fi

echo ""
echo "============================================"
echo "  Deploy complete! Ctrl+Shift+R to refresh"
echo "============================================"
