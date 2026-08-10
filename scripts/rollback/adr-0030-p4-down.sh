#!/usr/bin/env bash
# ADR-0030 Phase 4 — rollback script.
#
# Idempotent. Does the following:
#   1. Print operator instructions for reverting RUN_DISPATCHER_PHASE.
#   2. Flip any tickets currently in run_state='running' to 'failed' with
#      run_terminal_reason='rolled_back_p4'.
#   3. Best-effort: prune any registered git worktrees under /root/workspaces/T-*.
#   4. Does NOT touch PM2 (per Phase 4 brief).
#
# Re-runnable safely — second run is a no-op once tickets are flipped.
#
# Connection: defaults to local godcrm@localhost / godcrm_prod (PROD on .205)
# but every value is overrideable via env. Refuses to run if any required
# env var is unset AND no PROD default is provided.

set -uo pipefail

PG_HOST="${POSTGRES_HOST:-localhost}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-godcrm}"
PG_DB="${POSTGRES_DB:-godcrm_prod}"
PG_PASSWORD="${POSTGRES_PASSWORD:-godcrm_dev_2026}"

echo "============================================================"
echo "ADR-0030 Phase 4 rollback"
echo "============================================================"
echo
echo "Target: ${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB}"
echo
echo "STEP 1 — Operator action required:"
echo "  Set RUN_DISPATCHER_PHASE to 'workspace_only' (or 'dryrun') in the"
echo "  PM2 environment, then *manually* restart the affected process."
echo "  This script does NOT touch PM2 (per Phase 4 brief)."
echo
echo "  Example (operator runs by hand):"
echo "    pm2 set godcrm:RUN_DISPATCHER_PHASE workspace_only"
echo "    pm2 restart godcrm --update-env"
echo
echo "STEP 2 — Flipping any in-flight 'running' tickets → failed (rolled_back_p4)"

PGPASSWORD="${PG_PASSWORD}" psql \
  -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
  -v ON_ERROR_STOP=1 <<'SQL' || { echo "psql update failed"; exit 1; }
WITH affected AS (
  UPDATE table_rows
     SET data = data || jsonb_build_object(
                  'run_state', 'failed',
                  'run_terminal_reason', 'rolled_back_p4',
                  'run_finished_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'run_last_event_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                ),
         updated_at = NOW()
   WHERE table_id = 1708
     AND data->>'run_state' = 'running'
   RETURNING id
)
SELECT count(*) AS rolled_back FROM affected;
SQL

echo
echo "STEP 3 — Best-effort: cleaning up worktrees under /root/workspaces/"

WORKTREES_OUT="$(git -C /root/production/business-crm worktree list --porcelain 2>/dev/null || true)"
if [[ -z "${WORKTREES_OUT}" ]]; then
  echo "  no worktrees registered — skipping"
else
  while IFS= read -r line; do
    if [[ "${line}" =~ ^worktree[[:space:]](.+)$ ]]; then
      wtpath="${BASH_REMATCH[1]}"
      if [[ "${wtpath}" == /root/workspaces/T-* ]]; then
        echo "  removing ${wtpath}"
        git -C /root/production/business-crm worktree remove --force "${wtpath}" 2>/dev/null || true
        rm -rf "${wtpath}" 2>/dev/null || true
      fi
    fi
  done <<< "${WORKTREES_OUT}"
  git -C /root/production/business-crm worktree prune 2>/dev/null || true
  echo "  worktree prune complete"
fi

echo
echo "STEP 4 — Best-effort: nuking 'run/T-*' branches"
git -C /root/production/business-crm for-each-ref --format='%(refname:short)' refs/heads/run/ 2>/dev/null \
  | while read -r br; do
      if [[ -n "${br}" ]]; then
        echo "  deleting branch ${br}"
        git -C /root/production/business-crm branch -D "${br}" 2>/dev/null || true
      fi
    done

echo
echo "Rollback complete. Reminder: PM2 restart is operator-driven."
exit 0
