#!/bin/bash
# Transport only: deploy.sh owns build/restart. Never delete destination state.
# Local audit: bash scripts/staging-sync.sh SOURCE LOCAL_DEST --dry-run
set -euo pipefail
umask 077
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ] || { [ "$#" = 3 ] && [ "$3" != --dry-run ]; }; then
  echo 'Usage: staging-sync.sh SOURCE DEST [--dry-run]' >&2
  exit 2
fi
source_tree=$(cd "$1" && pwd -P)
test "$(git -C "$source_tree" rev-parse --show-toplevel)" = "$source_tree"
# The manifest names committed paths; ensure their working bytes still match.
# Host-local MCP config is deliberately preserved, never transferred.
git -C "$source_tree" diff --quiet HEAD -- . ':!.mcp.json'
manifest=$(mktemp)
trap 'rm -f "$manifest"' EXIT
git -C "$source_tree" ls-tree -rz --name-only HEAD > "$manifest"
test -s "$manifest"
options=()
if [ "${3:-}" = --dry-run ]; then options+=(--dry-run --itemize-changes); fi
# --from0 also changes exclude-from parsing. Pass each newline-delimited rule
# as an argument so the NUL-delimited path manifest cannot disable the policy.
while IFS= read -r pattern || [ -n "$pattern" ]; do
  case "$pattern" in ''|'#'*) continue ;; esac
  options+=(--exclude="$pattern")
done < "$(dirname "$0")/staging-sync.exclude"
# --files-from disables -a's implicit recursion: transfer exact file names only.
# No -L: do not dereference symlinks into local secrets; reject escaping links.
rsync -az --safe-links --from0 --files-from="$manifest" \
  "${options[@]}" -- "$source_tree/" "$2"
