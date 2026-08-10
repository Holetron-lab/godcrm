#!/bin/bash
# Check status of all CRM services
# Usage: ./scripts/status.sh

echo "═══════════════════════════════════════════"
echo "         GOD CRM Services Status"
echo "═══════════════════════════════════════════"

# DEV
echo ""
echo "🟢 DEV (devcrm.hltrn.cc:5001)"
DEV_STATUS=$(systemctl is-active business-crm-dev 2>/dev/null || echo "unknown")
DEV_HEALTH=$(curl -s --connect-timeout 2 http://localhost:5001/api/health 2>/dev/null || echo '{"status":"unreachable"}')
echo "   Service: $DEV_STATUS"
echo "   Health:  $DEV_HEALTH"

# PROD
echo ""
echo "🔴 PROD (crm.hltrn.cc:5000)"
PROD_STATUS=$(systemctl is-active business-crm 2>/dev/null || echo "unknown")
PROD_HEALTH=$(curl -s --connect-timeout 2 http://localhost:5000/api/health 2>/dev/null || echo '{"status":"unreachable"}')
echo "   Service: $PROD_STATUS"
echo "   Health:  $PROD_HEALTH"

# SQLite Test
echo ""
echo "🧪 SQLite Test (localhost:5002)"
SQLITE_STATUS=$(systemctl is-active business-crm-sqlite-test 2>/dev/null || echo "not installed")
echo "   Service: $SQLITE_STATUS"

echo ""
echo "═══════════════════════════════════════════"

# Quick summary
if [[ "$DEV_STATUS" == "active" && "$PROD_STATUS" == "active" ]]; then
  echo "✅ All main services running"
else
  echo "⚠️  Some services down - check above"
fi
