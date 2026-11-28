#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

[ -f .env ] || fail ".env is missing; run ./install.sh first"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 is required"

MEMORY_MODE="$(envget MEMORY_MODE)"
MEMORY_MODE="${MEMORY_MODE:-none}"
case "$MEMORY_MODE" in
  none|embedded|standalone) ;;
  *) fail "unsupported MEMORY_MODE: ${MEMORY_MODE}" ;;
esac

FILES=(-f docker-compose.yml)
PROFILES=()
if [ "$MEMORY_MODE" != "none" ]; then
  PROFILES=(--profile "memory-${MEMORY_MODE}")
fi

if [ "$(envget MAIL_ENABLED)" = "1" ]; then
  MAIL_DOMAIN="$(envget MAIL_DOMAIN)"
  MAIL_HOSTNAME="$(envget MAIL_HOSTNAME)"
  [ -n "$MAIL_DOMAIN" ] || fail "MAIL_DOMAIN is required when MAIL_ENABLED=1"
  [ -n "$MAIL_HOSTNAME" ] || fail "MAIL_HOSTNAME is required when MAIL_ENABLED=1"
  case "$MAIL_HOSTNAME" in
    *."$MAIL_DOMAIN") ;;
    *) fail "MAIL_HOSTNAME must be inside MAIL_DOMAIN" ;;
  esac
  FILES+=(-f docker-compose.mail.yml)
fi

docker compose "${FILES[@]}" "${PROFILES[@]}" config --quiet
docker compose "${FILES[@]}" "${PROFILES[@]}" up -d "$@"

printf '\nStarted GOD CRM (memory=%s, mail=%s)\n' "$MEMORY_MODE" "$(envget MAIL_ENABLED)"
printf 'Run ./verify.sh for the readback checklist.\n'
