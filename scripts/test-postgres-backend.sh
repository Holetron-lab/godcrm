#!/bin/bash
# Test PostgreSQL backend

export DATABASE_TYPE=postgres
export POSTGRES_URL="postgresql://godcrm:godcrm_dev_2026@localhost:5432/godcrm"
export PORT=5099

cd /root/workspace/business-crm

# Start server in background
node backend/server.js &
SERVER_PID=$!
sleep 3

echo "=== Testing API with PostgreSQL ==="

# Test login
echo "Testing /api/v3/auth/login..."
RESULT=$(curl -s http://127.0.0.1:$PORT/api/v3/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"gera69lvl@gmail.com","password":"123456"}')
echo "$RESULT" | head -c 500
echo ""

# Check if login successful
if echo "$RESULT" | grep -q "token"; then
  echo "✅ Login works with PostgreSQL!"
else
  echo "❌ Login failed"
fi

# Kill server
kill $SERVER_PID 2>/dev/null
