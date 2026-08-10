#!/bin/bash
# Script to replace console.* with logger in backend files
# ADR-037: ESLint Backend console.* fix

set -e

BACKEND_DIR="/home/dev2/workspace/business-crm/backend"
BACKUP_DIR="/home/dev2/backups/temp"

# Files to fix (excluding tests and public bundles)
FILES=(
    "routes/v2/access.js"
    "routes/v2/auth.js"
    "routes/v2/auth-new.js"
    "routes/v2/automations.js"
    "routes/v2/columns.js"
    "routes/v2/columns-new.js"
    "routes/v2/form-configs.js"
    "routes/v2/form-configs-new.js"
    "routes/v2/projects.js"
    "routes/v2/projects-new.js"
    "routes/v2/rows.js"
    "routes/v2/rows-new.js"
    "routes/v2/system.js"
    "routes/v2/tables.js"
    "routes/v2/tables-new.js"
    "routes/v2/users.js"
    "routes/auth.js"
    "routes/projects.js"
    "routes/service.js"
    "routes/error-pages/index.js"
    "middleware/auth.js"
    "utils/email.js"
    "server.js"
    "widgets/presets.js"
    "database/init.js"
    "database/init-v2.js"
)

echo "🔧 Fixing console.* → logger in backend files"
echo "================================================"

for file in "${FILES[@]}"; do
    FULL_PATH="$BACKEND_DIR/$file"
    if [ -f "$FULL_PATH" ]; then
        # Check if file has console.* calls
        if grep -q "console\.\(log\|error\|warn\|debug\|info\)" "$FULL_PATH"; then
            echo "📝 Processing: $file"
            
            # Backup
            BACKUP_NAME=$(basename "$file" .js).js.backup-console-fix-$(date +%Y%m%d)
            cp "$FULL_PATH" "$BACKUP_DIR/$BACKUP_NAME"
            
            # Check if logger import already exists
            if ! grep -q "import.*logger" "$FULL_PATH"; then
                # Add import at the top (after other imports)
                sed -i "1a import { apiLogger } from '../utils/logger.js';" "$FULL_PATH"
                echo "   + Added logger import"
            fi
        fi
    fi
done

echo ""
echo "✅ Backups created in $BACKUP_DIR"
echo "📋 Now manually review and replace console.* calls"
