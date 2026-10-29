#!/usr/bin/env bash
# dev-refresh.sh — refresh the .72 staging database (godcrm_test) from master A
# and mirror the master's upload storage one-way onto .72.
#
# Runs on .128 (agent home). Read-only against master A: pg_dump + rsync source.
# Everything it writes lands on .72 and only in *_test databases.
#
#   scripts/dev-refresh.sh              full refresh: DB swap + uploads mirror
#   scripts/dev-refresh.sh --db-only    skip the uploads rsync
#   scripts/dev-refresh.sh --uploads-only
#
# Wired as `make sync-db` and as the systemd unit godcrm-dev-refresh.timer
# (04:00 MSK). Log: /var/log/godcrm-dev-refresh.log
#
# Why a swap and not `pg_restore --clean` into the live DB:
#   - the staging app keeps a pool open on godcrm_test; a restore in place races
#     it (monitoring_* bootstrap collisions, half-restored schema visible to users);
#   - restoring into godcrm_test_incoming and renaming gives ~1 s of downtime
#     instead of the whole restore, and a failed restore leaves staging untouched.
#
# Box-local state on .72 that a plain copy would destroy is carried across:
#   - oidc_clients: the staging clients (dev.godcrm.ai / design-test redirect
#     URIs, ext clients) replace the master's rows;
#   - _secrets is truncated: the vault ciphertext is the master's and must not
#     hand production tokens to staging (bots would double-poll). Staging keeps
#     resolving secrets from its own .env, as it does today;
#   - QA logins (qa-admin / qa-user / qa-viewer @manual-test.local) are
#     re-created with a per-box password stored in $QA_CRED_FILE, so the
#     frontend sweep can log in under three roles without touching real users.
#
# Anything else on .72 (test rows, demo stands, smoke users) is disposable by
# decision of the owner (chat 3660, 2026-09-10) and is overwritten nightly.

set -euo pipefail

DEV_HOST="${DEV_HOST:-dev72}"
SRC_DB="${SRC_DB:-godcrm_prod}"
TARGET_DB="godcrm_test"
STAGE_DB="godcrm_test_incoming"
PREV_DB="godcrm_test_prev"
UPLOADS="/var/lib/business-crm-data/uploads"
QA_CRED_FILE="/root/.godcrm-qa-credentials"
QA_SPACE_ID="${QA_SPACE_ID:-11}"
LOG="${LOG:-/var/log/godcrm-dev-refresh.log}"
DUMP="/tmp/dev-refresh-${SRC_DB}.dump"

DO_DB=1
DO_UPLOADS=1
for arg in "$@"; do
  case "$arg" in
    --db-only)      DO_UPLOADS=0 ;;
    --uploads-only) DO_DB=0 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

case "$TARGET_DB" in *_test) ;; *) echo "REFUSING: target must end in _test" >&2; exit 2 ;; esac

# Shared staging lock + maintenance gate (staging-lease.sh), held for the whole
# refresh: re-exec once under `run`, which hands the lock to this very pid. A
# concurrent deploy/refresh or an active maintenance exits 75 before any work.
[ "${GODCRM_STAGING_LOCK_PID:-}" = "$$" ] || exec bash "$(dirname "$0")/staging-lease.sh" run -- bash "$0" "$@"

# Log to file and to the terminal when run by hand.
if [ -t 1 ]; then
  exec > >(tee -a "$LOG") 2>&1
else
  exec >>"$LOG" 2>&1
fi

ts() { date '+%F %T %Z'; }
echo "==================== $(ts) dev-refresh start (db=$DO_DB uploads=$DO_UPLOADS) ===================="
START=$(date +%s)

if [ "$DO_DB" = 1 ]; then
  echo "[db] dumping $SRC_DB (public schema, read-only) on $(hostname)…"
  # -n public: the godcrm role has no access to the hindsight schemas and they
  # have their own backup chain; they must not land on .72.
  sudo -u postgres pg_dump "$SRC_DB" -n public -Fc -f "$DUMP"
  pg_restore -l "$DUMP" >/dev/null || { echo "[db] FAIL: dump unreadable"; exit 1; }
  echo "[db] dump $(du -h "$DUMP" | cut -f1), copying to $DEV_HOST…"
  scp -q "$DUMP" "$DEV_HOST:$DUMP"
  rm -f "$DUMP"

  # Per-box QA password: generated once per box, reused on every refresh so the
  # credentials handed to QA agents stay valid across nights.
  if ! ssh "$DEV_HOST" "test -s $QA_CRED_FILE"; then
    echo "[qa] generating QA credentials on $DEV_HOST ($QA_CRED_FILE)"
    ssh "$DEV_HOST" "umask 077; printf 'QA_PASSWORD=%s\n' \"\$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)\" > $QA_CRED_FILE"
  fi

  echo "[db] restoring on $DEV_HOST into $STAGE_DB and swapping into $TARGET_DB…"
  ssh "$DEV_HOST" \
    "DUMP=$DUMP TARGET_DB=$TARGET_DB STAGE_DB=$STAGE_DB PREV_DB=$PREV_DB QA_CRED_FILE=$QA_CRED_FILE QA_SPACE_ID=$QA_SPACE_ID bash -s" <<'REMOTE'
set -euo pipefail
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt"
REPO=/root/production/business-crm
PRESERVE=/tmp/dev-refresh-preserve-oidc.sql

echo "[72] preserving box-local oidc_clients from $TARGET_DB"
sudo -u postgres pg_dump "$TARGET_DB" -a -t oidc_clients -f "$PRESERVE"

echo "[72] creating $STAGE_DB"
$PSQL -c "DROP DATABASE IF EXISTS $STAGE_DB WITH (FORCE)"
$PSQL -c "CREATE DATABASE $STAGE_DB OWNER godcrm"
# Extensions are not part of a -n public dump; create the master's set up front.
for ext in vector pg_trgm btree_gist; do
  $PSQL -d "$STAGE_DB" -c "CREATE EXTENSION IF NOT EXISTS $ext" || echo "[72] warn: extension $ext unavailable"
done

echo "[72] pg_restore → $STAGE_DB"
set +e
sudo -u postgres pg_restore --no-owner --no-acl --role=godcrm -d "$STAGE_DB" "$DUMP" 2> /tmp/dev-refresh-restore.err
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  # pg_restore exits 1 on any warning. Tolerate only the known-benign class
  # (objects that already exist from the extension pre-create); anything else
  # aborts and leaves the live $TARGET_DB untouched.
  bad=$(grep -E '^pg_restore: error' /tmp/dev-refresh-restore.err | grep -v -E 'already exists' || true)
  if [ -n "$bad" ]; then
    echo "[72] FAIL: pg_restore reported errors:"; echo "$bad" | head -20
    $PSQL -c "DROP DATABASE IF EXISTS $STAGE_DB WITH (FORCE)"
    exit 1
  fi
  echo "[72] pg_restore rc=$rc, only 'already exists' warnings — continuing"
fi
rm -f "$DUMP"

tables=$($PSQL -d "$STAGE_DB" -c "select count(*) from information_schema.tables where table_schema='public'")
users=$($PSQL -d "$STAGE_DB" -c "select count(*) from users")
echo "[72] restored: $tables tables, $users users"
[ "$tables" -gt 50 ] || { echo "[72] FAIL: restore looks empty"; $PSQL -c "DROP DATABASE IF EXISTS $STAGE_DB WITH (FORCE)"; exit 1; }

echo "[72] applying pending knex migrations to $STAGE_DB (non-fatal)"
( cd "$REPO" && export $(grep -E '^POSTGRES_(PASSWORD|USER|HOST|PORT)=' .env | xargs -d '\n') && POSTGRES_DB="$STAGE_DB" node run-migrations.mjs ) \
  || echo "[72] warn: run-migrations.mjs failed on $STAGE_DB — schema is the master's, continuing"

echo "[72] box-local fixups on $STAGE_DB"
$PSQL -d "$STAGE_DB" -c "TRUNCATE _secrets"
$PSQL -d "$STAGE_DB" -c "DELETE FROM oidc_clients"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$STAGE_DB" -f "$PRESERVE"
$PSQL -d "$STAGE_DB" -c "SELECT setval(pg_get_serial_sequence('oidc_clients','id'), COALESCE((SELECT MAX(id) FROM oidc_clients),1))" >/dev/null
rm -f "$PRESERVE"

# QA logins: three global roles, all granted on the QA space.
# users.encryption_key_encrypted is NOT NULL and login decrypts it with this
# box's MASTER_ENCRYPTION_KEY (AuthService.encryptPersonalKey: aes-256-cbc,
# key padded/cut to 32 bytes, "ivhex:cipherhex"), so mint a real one per user.
. "$QA_CRED_FILE"
MASTER_ENCRYPTION_KEY=$(grep -E '^MASTER_ENCRYPTION_KEY=' "$REPO/.env" | cut -d= -f2- | tr -d "\"'")
[ -n "$MASTER_ENCRYPTION_KEY" ] || { echo "[72] FAIL: MASTER_ENCRYPTION_KEY missing in $REPO/.env"; exit 1; }
HASH=$(cd "$REPO" && node -e "require('bcrypt').hash(process.argv[1],10).then(h=>process.stdout.write(h))" "$QA_PASSWORD")
for pair in "qa-admin:admin:admin" "qa-user:user:editor" "qa-viewer:viewer:viewer"; do
  IFS=: read -r login role level <<<"$pair"
  ENC=$(cd "$REPO" && MASTER_ENCRYPTION_KEY="$MASTER_ENCRYPTION_KEY" node -e '
    const c = require("crypto");
    const iv = c.randomBytes(16);
    const k = Buffer.from(process.env.MASTER_ENCRYPTION_KEY.padEnd(32).slice(0, 32));
    const ci = c.createCipheriv("aes-256-cbc", k, iv);
    const pk = c.randomBytes(32).toString("base64");
    process.stdout.write(iv.toString("hex") + ":" + ci.update(pk, "utf8", "hex") + ci.final("hex"));')
  $PSQL -d "$STAGE_DB" -c "
    INSERT INTO users (email, password_hash, name, encryption_key_encrypted, role, status, user_type, email_verified, created_at, updated_at)
    VALUES ('${login}@manual-test.local', '${HASH}', 'QA ${role} (manual-test)', '${ENC}', '${role}', 'active', 'human', 1, now(), now())
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, encryption_key_encrypted = EXCLUDED.encryption_key_encrypted, role = EXCLUDED.role, status = 'active';
    INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by, created_at, updated_at)
    SELECT u.id, ${QA_SPACE_ID}, '${level}', 1, now(), now() FROM users u
    WHERE u.email = '${login}@manual-test.local'
      AND NOT EXISTS (SELECT 1 FROM user_access_permissions p WHERE p.user_id = u.id AND p.space_id = ${QA_SPACE_ID}
                      AND p.project_id IS NULL AND p.table_id IS NULL AND p.column_id IS NULL);"
done
echo "[72] QA logins ready: qa-admin/qa-user/qa-viewer@manual-test.local (password in $QA_CRED_FILE)"

echo "[72] swapping $STAGE_DB → $TARGET_DB"
$PSQL -c "DROP DATABASE IF EXISTS $PREV_DB WITH (FORCE)"
$PSQL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TARGET_DB' AND pid <> pg_backend_pid()" >/dev/null
$PSQL -c "ALTER DATABASE $TARGET_DB RENAME TO $PREV_DB"
$PSQL -c "ALTER DATABASE $STAGE_DB RENAME TO $TARGET_DB"
echo "[72] restarting staging PM2 processes"
# One process per call: `pm2 restart a b` restarts both but then exits 1 with
# "Process 0 not found" (first run, 2026-09-10), which aborted the script before
# the health check and left godcrm_test_prev + the uploads mirror undone.
cd "$REPO"
for p in godcrm bdd-runner; do
  pm2 restart "$p" --update-env >/dev/null 2>&1 || echo "[72] warn: pm2 restart $p returned $?"
done

ok=0
for i in $(seq 1 30); do
  sleep 2
  if curl -sf -o /dev/null http://127.0.0.1:5000/health; then ok=1; break; fi
done
if [ "$ok" = 1 ]; then
  echo "[72] /health 200 after swap — dropping $PREV_DB"
  $PSQL -c "DROP DATABASE IF EXISTS $PREV_DB WITH (FORCE)"
else
  echo "[72] WARN: /health not answering 60 s after swap; $PREV_DB kept for rollback (ALTER DATABASE … RENAME)"
  exit 1
fi
REMOTE
  echo "[db] $TARGET_DB on $DEV_HOST refreshed from $SRC_DB"
  # Mirror the QA credentials here so agents on this box can read them.
  scp -q "$DEV_HOST:$QA_CRED_FILE" "$QA_CRED_FILE" && chmod 600 "$QA_CRED_FILE"
fi

if [ "$DO_UPLOADS" = 1 ]; then
  echo "[uploads] rsync $UPLOADS → $DEV_HOST (one-way, no --delete)…"
  rsync -a --stats -e ssh "$UPLOADS/" "$DEV_HOST:$UPLOADS/" | grep -E 'Number of (regular files transferred|files:)|Total transferred file size'
  echo "[uploads] done"
fi

echo "[dev-refresh] OK in $(( $(date +%s) - START )) s"
date '+%F %T %Z' > /var/lib/godcrm-dev-refresh.LAST_OK 2>/dev/null || true
