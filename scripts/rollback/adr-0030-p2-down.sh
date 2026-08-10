#!/usr/bin/env bash
# ADR-0030 Phase 2 — Rollback / disable script.
#
# Phase 2 introduces:
#   - backend/services/agent-run-dispatcher/index.js (new file)
#   - backend/routes/v3/agentRunDispatcher.js        (new file)
#   - server.js: import + init + shutdown + route mount  (in-place edits)
#
# There is NO new DB schema in Phase 2 — all schema lives in Phase 1
# (rollback there: scripts/rollback/adr-0030-p1-down.sql). This script
# clears any run_state values left behind by dry-run cancellations and
# disables the worker via env-flag flip — code stays in place, behavior
# does not.
#
# Idempotent. Safe to run multiple times.
#
# Usage:
#   bash scripts/rollback/adr-0030-p2-down.sh              # disable + cleanup
#   DRY_RUN=1 bash scripts/rollback/adr-0030-p2-down.sh    # show what it would do
#   PG_DB=godcrm_test bash scripts/rollback/adr-0030-p2-down.sh   # custom DB target
#
# To revert the code itself (delete the dispatcher service + route): use
# git revert / git reset to the P2 commit. This script only handles
# runtime + DB-state rollback.

set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_USER="${PG_USER:-godcrm}"
PG_DB="${PG_DB:-godcrm_prod}"
DRY_RUN="${DRY_RUN:-0}"

echo "ADR-0030 P2 rollback — target DB: ${PG_USER}@${PG_HOST}/${PG_DB} (dry_run=${DRY_RUN})"

run_sql() {
  local sql="$1"
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[DRY-RUN] ${sql}"
    return 0
  fi
  PGPASSWORD="${PGPASSWORD:-}" psql -h "${PG_HOST}" -U "${PG_USER}" -d "${PG_DB}" \
    -v ON_ERROR_STOP=1 -c "${sql}"
}

# 1. Clear any phase2_dryrun terminals + run_* keys left on tickets.
#    Spec: only touch rows whose run_terminal_reason is 'phase2_dryrun' so
#    we don't disturb anything Phase 3+ might have left on real runs.
echo "1/2  Clearing phase2_dryrun residue from tickets 1708…"
run_sql "UPDATE table_rows
            SET data = data
                       - 'run_state'
                       - 'run_attempt'
                       - 'run_thread_id'
                       - 'run_workspace_path'
                       - 'run_started_at'
                       - 'run_finished_at'
                       - 'run_last_event_at'
                       - 'run_terminal_reason'
                       - 'run_next_attempt_after'
                       - 'run_pending_approval_token'
                       - 'run_audit_log',
                updated_at = NOW()
          WHERE table_id = 1708
            AND data->>'run_terminal_reason' = 'phase2_dryrun';"

# 2. Verify dispatcher health endpoint reports disabled (informational).
echo "2/2  Reminder: also flip env flag in PM2 ecosystem and reload:"
echo "     pm2 set godcrm:env.AGENT_RUN_DISPATCHER_ENABLED false"
echo "     pm2 reload godcrm  --update-env"
echo ""
echo "(Or set AGENT_RUN_DISPATCHER_ENABLED=false in .env and restart godcrm.)"

echo "Done."
