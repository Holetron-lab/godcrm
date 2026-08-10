#!/bin/bash
# GOD CRM Test Scenarios Runner
# Usage: ./run-scenarios.sh [scenario] [env]

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
ENV=${2:-dev}
SCENARIO=${1:-health}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
LOG_FILE="/tmp/godcrm-test-$TIMESTAMP.log"

# Set base URL based on environment
case $ENV in
  local)
    BASE_URL="http://localhost:5001"
    ;;
  dev)
    BASE_URL="https://devcrm.hltrn.cc"
    ;;
  prod)
    BASE_URL="https://crm.hltrn.cc"
    ;;
  *)
    BASE_URL="$ENV"
    ;;
esac

# Header
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  🧪 GOD CRM Test Scenarios Runner${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Environment: ${YELLOW}$ENV${NC}"
echo -e "  Base URL:    ${CYAN}$BASE_URL${NC}"
echo -e "  Scenario:    ${YELLOW}$SCENARIO${NC}"
echo ""

# Health check
health_check() {
  echo -e "${BLUE}[Health Check]${NC} Checking server..."
  HEALTH=$(curl -s --max-time 10 "$BASE_URL/api/v3/system/health" 2>/dev/null || echo '{"error":"unreachable"}')
  
  # Server is up if we get any JSON response (even 401)
  if echo "$HEALTH" | grep -qE '"error":"unreachable"'; then
    echo -e "${RED}❌ Server unreachable at $BASE_URL${NC}"
    return 1
  fi
  
  echo -e "${GREEN}✅ Server is responding${NC}"
  echo "$HEALTH" | head -c 100
  echo ""
  return 0
}

case $SCENARIO in
  health)
    health_check
    ;;
  list)
    echo "Available scenarios:"
    echo "  health     - Server health check"
    echo "  master     - Full user simulation test"
    echo "  cleanup    - Delete test data (preserves testowner)"
    echo "  unit       - Run unit tests"
    echo "  e2e        - Run E2E tests"
    echo "  onboarding - Onboarding flow test"
    echo "  all        - Run all tests"
    ;;
  master)
    echo -e "${CYAN}[Master]${NC} Running master user simulation..."
    export TEST_API_URL="$BASE_URL/api/v3"
    cd "$PROJECT_DIR"
    node tests/integration/scenarios/master.scenario.js
    ;;
  cleanup)
    echo -e "${YELLOW}[Cleanup]${NC} Cleaning up test data..."
    export TEST_API_URL="$BASE_URL/api/v3"
    cd "$PROJECT_DIR"
    # Pass additional args if present
    shift 2 2>/dev/null || true
    node tests/integration/scenarios/cleanup.scenario.js "$@"
    ;;
  unit)
    echo -e "${CYAN}[Unit Tests]${NC} Running vitest..."
    cd "$PROJECT_DIR"
    npm run test
    ;;
  e2e)
    echo -e "${CYAN}[E2E Tests]${NC} Running playwright..."
    cd "$PROJECT_DIR"
    npx playwright test
    ;;
  onboarding)
    echo -e "${CYAN}[Onboarding]${NC} Running onboarding scenario..."
    export TEST_API_URL="$BASE_URL/api/v3"
    cd "$PROJECT_DIR"
    node tests/integration/scenarios/onboarding.scenario.js
    ;;
  all)
    echo -e "${CYAN}[All Tests]${NC} Running complete test suite..."
    health_check
    cd "$PROJECT_DIR"
    npm run test
    npx playwright test
    ;;
  *)
    echo -e "${RED}Unknown scenario: $SCENARIO${NC}"
    echo "Run './run-scenarios.sh list' to see available options"
    exit 1
    ;;
esac
