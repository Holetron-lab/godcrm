#!/bin/bash
# Deploy to DEV server (.72) - build, sync, restart
# Usage: ./scripts/deploy-dev.sh [--skip-build]
#
# Architecture:
#   Prod (.205): /root/production/business-crm/ — git repo, build here
#   Dev  (.72):  /root/production/business-crm/ — rsync copy (no .git)
#   Dev  (.72):  /var/www/business-crm-dev/     — nginx root for devcrm.hltrn.cc
#   Dev  (.72):  PM2 mindworkflow → backend/server.js (serves dist/ as SPA fallback)
#
# Nginx serves static from /var/www/business-crm-dev/
# Express serves static from /root/production/business-crm/dist/ (SPA fallback)
# Both must be updated!

set -e

DEV_HOST="root@<DEV_IP>"
PROJ_DIR="/root/production/business-crm"
DEV_NGINX_ROOT="/var/www/business-crm-dev"

echo "=== Deploy to DEV (.72) ==="

# Step 1: Build (unless --skip-build)
if [ "$1" != "--skip-build" ]; then
  echo "[1/4] Building frontend..."
  cd "$PROJ_DIR"
  npm run build 2>&1 | tail -5
  echo "    Build done: $(ls -la dist/index.html | awk '{print $6, $7, $8}')"
else
  echo "[1/4] Skipping build (--skip-build)"
fi

# Verify dist exists
if [ ! -f "$PROJ_DIR/dist/index.html" ]; then
  echo "ERROR: dist/index.html not found. Run without --skip-build"
  exit 1
fi

# Step 2: Sync backend to dev
echo "[2/4] Syncing backend to dev..."
rsync -azq --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='dist' \
  --exclude='public/assets' \
  "$PROJ_DIR/backend/" \
  "$DEV_HOST:$PROJ_DIR/backend/"

# Step 3: Sync dist to BOTH locations on dev
echo "[3/4] Syncing frontend to dev..."
# A) nginx root
rsync -azq --delete \
  "$PROJ_DIR/dist/" \
  "$DEV_HOST:$DEV_NGINX_ROOT/"
# B) dist/ for Express SPA fallback
rsync -azq --delete \
  "$PROJ_DIR/dist/" \
  "$DEV_HOST:$PROJ_DIR/dist/"

# Step 4: Restart PM2
echo "[4/4] Restarting PM2..."
ssh "$DEV_HOST" 'cd /root/production/business-crm && pm2 restart mindworkflow --update-env' 2>&1 | tail -3

# Verify
sleep 2
BUNDLE=$(ssh "$DEV_HOST" "grep -o 'index-[^\"]*\.js' $DEV_NGINX_ROOT/index.html")
HEALTH=$(ssh "$DEV_HOST" "curl -s http://localhost:5000/api/health 2>/dev/null" || echo '{}')

echo ""
echo "=== Deploy complete ==="
echo "  Bundle: $BUNDLE"
echo "  Health: $HEALTH"
echo "  URL: https://devcrm.hltrn.cc"
echo "  Tip: Ctrl+Shift+R to hard refresh"
