#!/usr/bin/env bash
# gitnexus-analyze — refresh the GitNexus index with a bounded V8 heap.
#
# Why (conversation 3721, 2026-10-16): gitnexus 1.6.x re-execs `analyze` with
# `--max-old-space-size=max(16384, 0.75*RAM)`. On .128 (15 GiB RAM) that floor is
# above physical memory; the indexer segfaulted and left a 30 GiB core dump that
# filled /. The only supported override of the floor is GITNEXUS_TEST_RESPAWN_HEAP_MB
# (the re-exec still adds --max-semi-space-size/--stack-size itself). A NODE_OPTIONS
# heap flag would also work but disables the re-exec and those extra flags.
#
# Usage: gitnexus-analyze [repo-path] [extra gitnexus analyze flags]
#   repo-path defaults to the canonical checkout. Default flags: --index-only --workers 2.
#   GITNEXUS_HEAP_MB overrides the heap (clamped to HEAP_MAX_MB).
#
# Installed copy: /usr/local/bin/gitnexus-analyze (keep in sync with this file).
set -euo pipefail

HEAP_MAX_MB=8192
LOCK=/tmp/godcrm-gitnexus-analyze.lock
REPO=/root/production/business-crm

if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  REPO="$1"; shift
fi

HEAP_MB="${GITNEXUS_HEAP_MB:-$HEAP_MAX_MB}"
case "$HEAP_MB" in ''|*[!0-9]*) echo "gitnexus-analyze: GITNEXUS_HEAP_MB must be an integer (MB)" >&2; exit 2;; esac
if [ "$HEAP_MB" -gt "$HEAP_MAX_MB" ]; then
  echo "gitnexus-analyze: clamping heap ${HEAP_MB} MB -> ${HEAP_MAX_MB} MB (box RAM is 15 GiB)" >&2
  HEAP_MB=$HEAP_MAX_MB
fi

export GITNEXUS_TEST_RESPAWN_HEAP_MB="$HEAP_MB"
echo "gitnexus-analyze: repo=$REPO heap=${HEAP_MB}MB lock=$LOCK" >&2
exec flock -n "$LOCK" gitnexus analyze "$REPO" --index-only --workers 2 "$@"
