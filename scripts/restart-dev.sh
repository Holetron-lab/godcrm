#!/bin/bash
# Restart DEV server - for developers and agents
# Usage: ./scripts/restart-dev.sh

set -e

echo "🔄 Restarting DEV server..."

# Restart service
sudo systemctl restart business-crm-dev

# Wait for startup
sleep 2

# Check health
HEALTH=$(curl -s http://localhost:5001/api/health 2>/dev/null || echo '{"status":"error"}')

if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "✅ DEV server is UP"
  echo "   URL: https://devcrm.hltrn.cc"
  echo "   Health: $HEALTH"
else
  echo "❌ DEV server FAILED to start"
  echo "   Check logs: journalctl -u business-crm-dev -n 50 --no-pager"
  exit 1
fi
