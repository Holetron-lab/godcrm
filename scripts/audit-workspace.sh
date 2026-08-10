#!/bin/bash
# scripts/audit-workspace.sh
# Implements checks from ADR-041

echo "🔍 Auditing Workspace Hygiene..."
ERRORS=0

# 1. Check for garbage files
echo "Checking for .bak, .new, .old files..."
GARBAGE=$(find src backend -name "*.bak" -o -name "*.new" -o -name "*.old" 2>/dev/null)
if [ -n "$GARBAGE" ]; then
    echo "❌ Found garbage files (ADR-041 violation):"
    echo "$GARBAGE"
    ERRORS=$((ERRORS+1))
else
    echo "✅ No garbage files found"
fi

# 2. Check for loose scripts in root
echo "Checking for loose JS scripts in root..."
# Exclude known config files and moved scripts
LOOSE=$(find . -maxdepth 1 -name "*.js" \
    ! -name "vite.config.js" \
    ! -name "postcss.config.js" \
    ! -name "tailwind.config.js" \
    ! -name "eslint.config.js" \
    2>/dev/null)

# All utility scripts should now be in scripts/backend-tools/

if [ -n "$LOOSE" ]; then
    echo "❌ Found loose scripts in root (ADR-041 violation):"
    echo "$LOOSE"
    ERRORS=$((ERRORS+1))
else
    echo "✅ No unknown loose scripts found"
fi

# 3. Check for console.log in critical paths (ADR-037)
# Exclusions:
#   - __tests__/ - test files are OK
#   - scripts/ - utility scripts are OK  
#   - migrations/ - migration logs are OK
#   - public/ - compiled assets
#   - logger.ts - the logger itself
#   - HelpPage - documentation examples
#   - api.types.ts - JSDoc examples
echo "Checking for console.log usage..."
CONSOLE_COUNT=$(grep -rn "console\.log" src backend --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null \
    | grep -v "__tests__" \
    | grep -v "\.test\." \
    | grep -v "/tests/" \
    | grep -v "scripts/" \
    | grep -v "migrations" \
    | grep -v "public/" \
    | grep -v "logger\.ts" \
    | grep -v "api\.types\.ts" \
    | grep -v "HelpPage" \
    | wc -l)

if [ "$CONSOLE_COUNT" -gt 0 ]; then
    echo "⚠️  Found $CONSOLE_COUNT console.log instances in source code (ADR-037 violation)"
    echo "   Run: grep -rn 'console.log' src backend --include='*.ts' --include='*.tsx' --include='*.js' | grep -v __tests__ | grep -v migrations | grep -v public/"
else
    echo "✅ No console.log in source code"
fi

echo "-----------------------------------"
if [ $ERRORS -gt 0 ]; then
    echo "🔴 Audit failed with $ERRORS errors."
    exit 1
else
    echo "🟢 Workspace is clean."
    exit 0
fi
