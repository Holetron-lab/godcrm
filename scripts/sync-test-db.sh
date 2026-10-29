#!/usr/bin/env bash
# sync-test-db.sh — refresh a LOCAL *_test database from the local master.
#
# `make sync-db` copies master A to .72 and lands it in a database named
# godcrm_prod there; it does not maintain a `godcrm_test` anywhere. Since
# ADR-0009 §Phase 7 a test run is pinned to POSTGRES_DB=godcrm_test on
# whatever box it runs on (backend/test/contour.js), so each box needs a way
# to (re)create its own copy. This is it.
#
#   scripts/sync-test-db.sh              godcrm_prod → godcrm_test on this box
#   scripts/sync-test-db.sh --from godcrm_edit
#
# Read-only against the source: pg_dump only. The target is dropped and
# recreated, and the script refuses any target whose name does not end in
# `_test` — the same allowlist the boot guard enforces.

set -euo pipefail

SOURCE_DB="godcrm_prod"
TARGET_DB="godcrm_test"

while [ $# -gt 0 ]; do
  case "$1" in
    --from) SOURCE_DB="$2"; shift 2 ;;
    --to)   TARGET_DB="$2"; shift 2 ;;
    *) echo "usage: $0 [--from <db>] [--to <db_test>]" >&2; exit 1 ;;
  esac
done

case "$TARGET_DB" in
  *_test) ;;
  *)
    echo "REFUSING: target '$TARGET_DB' does not end in _test. This script only writes test databases." >&2
    exit 2
    ;;
esac

if [ "$SOURCE_DB" = "$TARGET_DB" ]; then
  echo "REFUSING: source and target are the same database ($SOURCE_DB)." >&2
  exit 2
fi

DUMP="/tmp/${SOURCE_DB}-to-${TARGET_DB}.dump"

echo "[sync-test-db] dumping $SOURCE_DB (public schema, read-only)…"
# -n public: the godcrm role cannot read the hindsight schemas, and they have
# their own backup chain — same rationale as scripts/deploy.sh sync-db.
sudo -u postgres pg_dump "$SOURCE_DB" -n public -Fc -f "$DUMP"

echo "[sync-test-db] recreating $TARGET_DB…"
# Recreate wholesale rather than --clean into a lived-in DB: a restore over
# accumulated local-only objects trips on ownership and missing roles.
sudo -u postgres psql -qc "DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)"
sudo -u postgres psql -qc "CREATE DATABASE ${TARGET_DB} OWNER godcrm"
sudo -u postgres pg_restore --no-owner --no-acl --role=godcrm -d "$TARGET_DB" "$DUMP"

rm -f "$DUMP"

# The dump carries the master's schema, which is NOT the same thing as the
# migration chain's schema: a few tables (conversation_summaries is the worked
# example — see migration 092) pre-date the knex chain and were baselined over,
# so knex_migrations claims migrations that never ran against them. Copying the
# master therefore reproduces the drift, and any suite written against the
# declared schema goes red until migrations are applied on top. Restoring
# without this step silently un-fixed migration 092 on every refresh.
echo "[sync-test-db] applying pending migrations to $TARGET_DB…"
(
  cd "$(dirname "$0")/.."
  POSTGRES_DB="$TARGET_DB" \
  POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}" \
  POSTGRES_PORT="${POSTGRES_PORT:-5432}" \
  POSTGRES_USER="${POSTGRES_USER:-godcrm}" \
    node run-migrations.mjs
)

echo "[sync-test-db] $TARGET_DB refreshed from $SOURCE_DB on $(hostname)."
echo "[sync-test-db] note: this drops anything a previous run left behind — intentional."
