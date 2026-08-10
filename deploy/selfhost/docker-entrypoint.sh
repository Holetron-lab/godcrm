#!/usr/bin/env bash
# GOD CRM self-host entrypoint: wait for Postgres, load schema on first run, start.
set -euo pipefail

PGHOST="${POSTGRES_HOST:-db}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-godcrm}"
PGDB="${POSTGRES_DB:-godcrm}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"
SCHEMA_FILE="/app/deploy/selfhost/schema.sql"

echo "[entrypoint] waiting for postgres at ${PGHOST}:${PGPORT} ..."
for i in $(seq 1 60); do
  if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" >/dev/null 2>&1; then
    echo "[entrypoint] postgres is ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[entrypoint] ERROR: postgres not reachable after 60s" >&2
    exit 1
  fi
  sleep 1
done

# First run → load the verified schema snapshot. The CRM's prod schema is not
# reproducible from the knex migration chain, so self-host ships the real schema
# (structure only, no data). Detect "already initialised" via the users table.
INITIALISED="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tAc \
  "SELECT to_regclass('public.users') IS NOT NULL;" 2>/dev/null || echo f)"

if [ "$INITIALISED" = "t" ]; then
  echo "[entrypoint] schema already present — skipping load"
else
  echo "[entrypoint] empty database — loading schema snapshot ..."
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" \
    -v ON_ERROR_STOP=1 -q -f "$SCHEMA_FILE"
  echo "[entrypoint] schema loaded"

  # ADR-165-F Track A — seed the SC-SIM demo on first run so a fresh clean-room boot
  # opens on a WORKING, pre-run simulator (public space /s/sc-sim + project + the 8
  # pack tables + scheme/config + a COMPLETED run @ ~96% sorter utilization) instead
  # of an empty CRM. First-run only (this schema-load branch); the seeder is idempotent
  # and combat-guarded (hard-refuses godcrm_prod), and reads POSTGRES_* from the app env.
  # Non-fatal by design: a seed hiccup — or a public image that ships without the
  # SC-SIM module — must NOT brick the platform boot; the CRM still starts, we log it.
  SEED_SCRIPT="/app/backend/scripts/seed-sc-sim-demo.js"
  if [ -f "$SEED_SCRIPT" ]; then
    echo "[entrypoint] seeding SC-SIM demo ..."
    if node "$SEED_SCRIPT"; then
      echo "[entrypoint] SC-SIM demo seeded"
    else
      rc=$?
      echo "[entrypoint] WARNING: SC-SIM demo seed failed (exit ${rc}) — starting without demo content" >&2
    fi
  else
    echo "[entrypoint] SC-SIM seeder not present in image — skipping demo seed"
  fi
fi

echo "[entrypoint] starting: $*"
exec "$@"
