#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Quality Gate — Pre-deploy validation for GOD CRM frontend
#
# Runs three checks in order:
#   1. TypeScript type check (tsc --noEmit)
#   2. Quality gate tests (vitest)
#   3. Production build (vite build)
#
# Exits with non-zero if ANY step fails.
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

PASS=0
FAIL=0
RESULTS=()

run_step() {
  local name="$1"
  shift
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  STEP: $name"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
  if "$@"; then
    RESULTS+=("  PASS  $name")
    ((PASS++))
  else
    RESULTS+=("  FAIL  $name")
    ((FAIL++))
  fi
}

# ── Step 0: File line limit check ────────────────────────────────────
run_step "File line limit (max 800)" \
  bash "$PROJECT_DIR/scripts/check-file-lines.sh" --max 800 --path "$PROJECT_DIR/src"

# ── Step 1: TypeScript type check ──────────────────────────────────────
run_step "TypeScript check (tsc --noEmit)" \
  npx tsc --noEmit --project tsconfig.json

# ── Step 2: Quality gate tests ─────────────────────────────────────────
run_step "Quality gate tests (vitest)" \
  npx vitest run src/features/ai-chat/__tests__/quality-gates.test.ts --reporter=verbose

# ── Step 3: Production build ───────────────────────────────────────────
run_step "Production build (vite)" \
  npx vite build

# ── Summary ────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  QUALITY GATE SUMMARY"
echo "════════════════════════════════════════════════════════════════"
for line in "${RESULTS[@]}"; do
  echo "$line"
done
echo ""
echo "  Total: $((PASS + FAIL))  |  Passed: $PASS  |  Failed: $FAIL"
echo "════════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "  QUALITY GATE FAILED — fix errors above before deploying."
  echo ""
  exit 1
else
  echo ""
  echo "  QUALITY GATE PASSED — safe to deploy."
  echo ""
  exit 0
fi
