#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Check max lines per file for .ts/.tsx files
# Fails if any file exceeds MAX_LINES (default: 800)
# Usage: bash scripts/check-file-lines.sh [--max N] [--path DIR]
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

MAX_LINES=800
SEARCH_PATH="src"
VIOLATIONS=0

# Legacy/pet-project files exempt from the line limit.
# Mirror .git/hooks/pre-commit so local hook and quality gate agree.
IGNORE_PATTERNS=(
  "src/features/public/VspomilLanding.tsx"
  "src/pages/help/HelpPage.tsx"
  "src/pages/help/HelpPageEn.tsx"
  "src/shared/i18n/translations.ts"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max) MAX_LINES="$2"; shift 2 ;;
    --path) SEARCH_PATH="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "Checking .ts/.tsx files in $SEARCH_PATH for max $MAX_LINES lines..."
echo ""

while IFS= read -r file; do
  skip=false
  for pattern in "${IGNORE_PATTERNS[@]}"; do
    [[ "$file" == *"$pattern" ]] && skip=true && break
  done
  $skip && continue
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$MAX_LINES" ]; then
    echo "  FAIL  $file ($lines lines, max $MAX_LINES)"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(find "$SEARCH_PATH" -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path '*/node_modules/*' ! -path '*/dist/*' | sort)

echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "FAILED: $VIOLATIONS file(s) exceed $MAX_LINES lines. Refactor before committing."
  exit 1
else
  echo "PASSED: All files within $MAX_LINES line limit."
  exit 0
fi
