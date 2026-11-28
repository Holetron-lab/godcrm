#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

[ -f .env ] || fail ".env is missing; run ./install.sh first"
[ "${1:-}" != "" ] || fail "usage: ./mail-account.sh user@$(envget MAIL_DOMAIN)"
[ "$(envget MAIL_ENABLED)" = "1" ] || fail "set MAIL_ENABLED=1 and run ./bundle-up.sh first"

ADDRESS="${1,,}"
DOMAIN="$(envget MAIL_DOMAIN)"
case "$ADDRESS" in
  *@*.*) ;;
  *) fail "invalid email address" ;;
esac
[ "${ADDRESS#*@}" = "$DOMAIN" ] || fail "address must end with @${DOMAIN}"

docker compose -f docker-compose.yml -f docker-compose.mail.yml ps --status running --services | grep -qx mail \
  || fail "mail container is not running"

printf 'Creating %s. Enter its password at the hidden prompts; it is not accepted as a CLI argument.\n' "$ADDRESS"
docker compose -f docker-compose.yml -f docker-compose.mail.yml exec mail setup email add "$ADDRESS"
docker compose -f docker-compose.yml -f docker-compose.mail.yml exec mail setup email list
