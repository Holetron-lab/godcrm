#!/bin/bash
# Lease watchdog — runs OUTSIDE the CRM runtime (systemd timer, every minute).
# Releases staging maintenance leases that expired or stopped heartbeating, so
# a broker that died mid-run cannot hold the quiet-window gate forever. It
# never touches live leases, processes, crontabs or data: the record says why
# the lease ended, and the operator restores maintenance changes by hand.
set -euo pipefail
DB="${STAGING_COORD_DB:-godcrm_prod}"
STALE="${STAGING_LEASE_STALE_SECONDS:-120}"
case "$STALE" in ''|*[!0-9]*) echo 'STAGING_LEASE_STALE_SECONDS must be an integer' >&2; exit 2 ;; esac
released=$(runuser -u postgres -- psql -d "$DB" -v ON_ERROR_STOP=1 -qAt -c "
  UPDATE ops_staging_leases
     SET released_at = now(),
         release_reason = CASE WHEN expires_at <= now() THEN 'watchdog_expired' ELSE 'watchdog_heartbeat_lost' END
   WHERE released_at IS NULL
     AND (expires_at <= now() OR heartbeat_at < now() - make_interval(secs => $STALE))
   RETURNING id || ' ' || purpose || ' job=' || job_id || ' ' || release_reason")
if [ -n "$released" ]; then
  echo "[lease-watchdog] released: $released"
fi
