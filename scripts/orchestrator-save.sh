#!/bin/bash
# Orchestrator Save System
# Usage: 
#   ./orchestrator-save.sh load 270        # Load save by conversation ID
#   ./orchestrator-save.sh list            # List all saves
#   ./orchestrator-save.sh list holetron   # List saves by project

DB_USER="godcrm"
DB_NAME="godcrm_prod"
DB_HOST="localhost"
export PGPASSWORD="godcrm_dev_2026"

CMD=${1:-list}
ARG=${2:-}

case "$CMD" in
  load)
    if [ -z "$ARG" ]; then
      echo "Usage: $0 load <conversation_id>"
      exit 1
    fi
    echo "=== ORCHESTRATOR SAVE #$ARG ==="
    psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "
      SELECT jsonb_pretty(
        jsonb_build_object(
          'conversation_id', conversation_id,
          'project', project,
          'summary', context_summary,
          'knowledge', knowledge_base,
          'tags', to_jsonb(tags),
          'saved_at', created_at,
          'updated_at', updated_at
        )
      )
      FROM orchestrator_saves 
      WHERE conversation_id = $ARG;" 2>/dev/null
    ;;
  list)
    if [ -n "$ARG" ]; then
      echo "=== SAVES FOR PROJECT: $ARG ==="
      psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "
        SELECT conversation_id as \"#\", project, 
               left(context_summary, 80) || '...' as summary,
               tags, updated_at
        FROM orchestrator_saves 
        WHERE LOWER(project) = LOWER('$ARG')
        ORDER BY conversation_id DESC;" 2>/dev/null
    else
      echo "=== ALL ORCHESTRATOR SAVES ==="
      psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "
        SELECT conversation_id as \"#\", project, 
               left(context_summary, 80) || '...' as summary,
               tags, updated_at
        FROM orchestrator_saves 
        ORDER BY conversation_id DESC;" 2>/dev/null
    fi
    ;;
  *)
    echo "Orchestrator Save System"
    echo "Commands: load <id>, list [project]"
    ;;
esac
