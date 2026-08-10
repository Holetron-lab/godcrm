#!/bin/bash
# ADR-035: TypeScript Strict Mode - Progress Monitor
# Usage: ./scripts/count-any.sh

cd "$(dirname "$0")/.." || exit 1

echo "=== TypeScript ': any' Progress ==="
echo "Date: $(date '+%Y-%m-%d %H:%M')"
echo ""

total=$(grep -rn ": any" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l)
echo "📊 Total ': any' count: $total"
echo ""

echo "📁 By directory:"
for dir in shared features pages; do
  count=$(grep -rn ": any" "src/$dir" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l)
  printf "  src/%-12s %3d\n" "$dir:" "$count"
done
echo ""

echo "🔝 Top-10 files:"
grep -rn ": any" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | \
  sed 's/:.*$//' | sort | uniq -c | sort -rn | head -10 | \
  while read count file; do
    # Shorten path for display
    short=$(echo "$file" | sed 's|src/features/||' | sed 's|src/||')
    printf "  %3d  %s\n" "$count" "$short"
  done
echo ""

echo "📈 By category:"
widgets=$(grep -rn ": any" "src/features/widgets" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l)
schema=$(grep -rn ": any" "src/features/schema-editor" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l)
apikeys=$(grep -rn ": any" "src/features/api-keys" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l)
pages=$(grep -rn ": any" "src/pages" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l)

printf "  widgets:       %3d\n" "$widgets"
printf "  schema-editor: %3d\n" "$schema"
printf "  api-keys:      %3d\n" "$apikeys"
printf "  pages:         %3d\n" "$pages"
echo ""

# ADR-035 targets
echo "🎯 ADR-035 Targets:"
echo "  Current:     $total"
echo "  Phase 1:     150 (ESLint visible)"
echo "  Final:       < 20"
