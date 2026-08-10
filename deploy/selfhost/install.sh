#!/usr/bin/env bash
# GOD CRM — self-host installer.
# Generates secrets, asks whether to enable Hindsight memory, and starts the stack.
set -euo pipefail

cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
say()  { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
die()  { echo -e "${RED}$*${NC}" >&2; exit 1; }

# --- prerequisites ---
command -v docker >/dev/null 2>&1 || die "❌ docker is not installed."
docker compose version >/dev/null 2>&1 || die "❌ 'docker compose' (v2) is required."
command -v openssl >/dev/null 2>&1 || die "❌ openssl is required to generate secrets."

gen()  { openssl rand -hex 32; }
genpw(){ openssl rand -hex 24; }

# --- .env: create from template on first run, preserve on re-run ---
if [ -f .env ]; then
  warn "ℹ .env already exists — keeping it (delete it to regenerate secrets)."
else
  say "🔐 Generating .env with fresh secrets ..."
  cp env.example .env
  # Fill required values without printing them.
  sed -i \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(genpw)|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(gen)|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(gen)|" \
    -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(gen)|" \
    -e "s|^MASTER_ENCRYPTION_KEY=.*|MASTER_ENCRYPTION_KEY=$(gen)|" \
    -e "s|^SECRETS_MASTER_KEY=.*|SECRETS_MASTER_KEY=$(openssl rand -base64 32)|" \
    -e "s|^CRM_CREDENTIAL_KEY=.*|CRM_CREDENTIAL_KEY=$(gen)|" \
    -e "s|^HINDSIGHT_DB_PASSWORD=.*|HINDSIGHT_DB_PASSWORD=$(genpw)|" \
    .env
  warn "→ Review .env and set PUBLIC_URL / APP_PORT to how you'll reach the app."
fi

# --- ask: install Hindsight memory? ---
echo
warn "Hindsight MemPalace adds long-term agent memory (optional)."
warn "It needs an LLM API key and pulls extra images. Skip it for a lean install."
read -r -p "Install Hindsight memory backend? [y/N] " ans
PROFILE_ARGS=()
case "${ans:-N}" in
  [yY]|[yY][eE][sS])
    PROFILE_ARGS=(--profile memory)
    say "✓ Hindsight enabled."
    if ! grep -q '^LLM_API_KEY=.\+' .env; then
      warn "⚠ LLM_API_KEY is empty in .env — set it, or memory classification will fail."
    fi
    warn "→ The MemPalace image will be pulled from GHCR on first start (~4.5 GB)."
    ;;
  *)
    say "✓ Skipping Hindsight (you can add it later: docker compose --profile memory up -d)."
    ;;
esac

# --- build & start ---
echo
say "🐳 Building and starting GOD CRM ..."
docker compose "${PROFILE_ARGS[@]}" up -d --build

APP_PORT="$(grep -E '^APP_PORT=' .env | cut -d= -f2 || echo 5000)"
echo
say "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
say "✅ GOD CRM is starting."
say "   Open: http://localhost:${APP_PORT:-5000}"
say "   The FIRST account you register becomes the owner."
say "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Logs:  docker compose logs -f app"
echo "Stop:  docker compose down"
