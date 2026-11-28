#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

[ -f .env ] || fail ".env is missing"
FILES=(-f docker-compose.yml)
PROFILES=()
MEMORY_MODE="$(envget MEMORY_MODE)"
if [ "${MEMORY_MODE:-none}" != "none" ]; then
  PROFILES=(--profile "memory-${MEMORY_MODE}")
fi
if [ "$(envget MAIL_ENABLED)" = "1" ]; then
  FILES+=(-f docker-compose.mail.yml)
fi

compose() { docker compose "${FILES[@]}" "${PROFILES[@]}" "$@"; }

compose ps
compose ps --status running --services | grep -qx app || fail "app is not running"
compose ps --status running --services | grep -qx db || fail "db is not running"

APP_PORT="$(envget APP_PORT)"
APP_PORT="${APP_PORT:-5000}"
curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null || fail "app health endpoint failed"
printf 'PASS: app health on 127.0.0.1:%s\n' "$APP_PORT"

if [ "${MEMORY_MODE:-none}" != "none" ]; then
  compose ps --status running --services | grep -qx "memory-${MEMORY_MODE}" \
    || fail "memory-${MEMORY_MODE} is not running"
  printf 'PASS: RCLL container is running; recall/write acceptance still requires an agent smoke test\n'
fi

if [ "$(envget MAIL_ENABLED)" = "1" ]; then
  compose ps --status running --services | grep -qx mail || fail "mail is not running"
  compose exec -T mail setup email list
  printf 'PASS: mail container is running; SMTP/IMAP delivery still requires the documented probe\n'
fi
