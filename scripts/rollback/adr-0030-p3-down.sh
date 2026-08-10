#!/usr/bin/env bash
# ADR-0030 Phase 3 — Rollback / cleanup script.
#
# Phase 3 introduces:
#   - backend/services/agent-run-dispatcher/workspace-manager.js (new file)
#   - scripts/run-claude-on-ticket.sh                            (new file)
#   - dispatcher integration: createWorkspace + phase3WorkspaceOnlyCancel
#     branched on RUN_DISPATCHER_PHASE env flag (default 'dryrun', safe).
#
# This script removes all on-disk workspaces under /root/workspaces/T-* and
# their `run/T-*` git branches, then prints reminders. It does NOT touch
# the DB or restart PM2. Idempotent — safe to run multiple times.
#
# Usage:
#   bash scripts/rollback/adr-0030-p3-down.sh                  # do it
#   DRY_RUN=1 bash scripts/rollback/adr-0030-p3-down.sh        # show only
#   REPO_DIR=/path/to/repo bash scripts/rollback/adr-0030-p3-down.sh
#
# To revert dispatcher behavior to Phase 2 dry-run, set / leave:
#     RUN_DISPATCHER_PHASE=dryrun  (or unset)
# in PM2 env / .env, then restart godcrm.

set -uo pipefail

REPO_DIR="${REPO_DIR:-/root/production/business-crm}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/root/workspaces}"
DRY_RUN="${DRY_RUN:-0}"

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[DRY-RUN] $*"
    return 0
  fi
  "$@"
}

echo "ADR-0030 P3 rollback — repo=${REPO_DIR}  workspace_root=${WORKSPACE_ROOT}  dry_run=${DRY_RUN}"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "ERROR: ${REPO_DIR} is not a git repo (missing .git/)"
  exit 1
fi

# 1. Enumerate worktrees registered with git that match /root/workspaces/T-*
echo "1/4  Listing worktrees under ${WORKSPACE_ROOT}…"
mapfile -t worktree_paths < <(
  git -C "${REPO_DIR}" worktree list --porcelain 2>/dev/null \
    | awk -v prefix="${WORKSPACE_ROOT}/T-" '/^worktree / && $2 ~ prefix"" { print $2 }'
)
echo "     found ${#worktree_paths[@]} registered worktree(s)"

# 2. Remove each worktree
echo "2/4  Removing registered worktrees…"
for wt in "${worktree_paths[@]}"; do
  echo "     git worktree remove --force ${wt}"
  run git -C "${REPO_DIR}" worktree remove --force "${wt}" || \
    echo "     (warning: remove failed for ${wt} — continuing)"
done
run git -C "${REPO_DIR}" worktree prune || true

# 3. Force-rm any leftover dirs (in case a worktree was unregistered but the
#    dir survived).
echo "3/4  Removing stray directories under ${WORKSPACE_ROOT}…"
if [[ -d "${WORKSPACE_ROOT}" ]]; then
  shopt -s nullglob
  for d in "${WORKSPACE_ROOT}"/T-*; do
    if [[ -e "${d}" ]]; then
      echo "     rm -rf ${d}"
      run rm -rf "${d}"
    fi
  done
  shopt -u nullglob
else
  echo "     ${WORKSPACE_ROOT} does not exist — skipping"
fi

# 4. Delete run/T-* branches (best-effort).
echo "4/4  Deleting run/T-* branches…"
mapfile -t branches < <(
  git -C "${REPO_DIR}" for-each-ref --format='%(refname:short)' refs/heads/run/ 2>/dev/null \
    | awk '/^run\/T-/ { print $0 }'
)
echo "     found ${#branches[@]} run/T-* branch(es)"
for b in "${branches[@]}"; do
  echo "     git branch -D ${b}"
  run git -C "${REPO_DIR}" branch -D "${b}" || \
    echo "     (warning: branch delete failed for ${b} — continuing)"
done

echo ""
echo "Done. Reminders:"
echo "  - To restore Phase 2 dry-run dispatcher behavior, set:"
echo "        RUN_DISPATCHER_PHASE=dryrun   (or unset)"
echo "    in PM2 env / .env, then restart godcrm."
echo "  - This script does NOT modify the DB. Tickets that were canceled"
echo "    with run_terminal_reason='phase3_workspace_only' retain their"
echo "    run_workspace_path for audit. Combine with adr-0030-p2-down.sh"
echo "    if you also want to wipe phase2_dryrun residue from JSONB."
