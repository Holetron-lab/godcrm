#!/usr/bin/env bash
# GOD CRM — self-host installer.
# Generates secrets, asks where agent memory should live, and starts the stack.
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

# --- ambient environment beats .env in compose ---
# `docker compose` resolves ${VAR} from the SHELL environment first and only
# then from .env. If this shell already exports POSTGRES_* or JWT_SECRET (a
# box that runs another app, a sourced profile), the stack would quietly use
# those instead of the values below — wrong database, wrong secret, no error.
INHERITED=()
for v in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_HOST POSTGRES_PORT \
         JWT_SECRET SESSION_SECRET APP_PORT PUBLIC_URL LLM_PROVIDER LLM_API_KEY; do
  [ -n "${!v:-}" ] && INHERITED+=("$v")
done
if [ ${#INHERITED[@]} -gt 0 ]; then
  warn "⚠ These variables are already set in your shell and OVERRIDE .env:"
  warn "    ${INHERITED[*]}"
  warn "  Run the installer from a clean shell (env -u ${INHERITED[0]} ... ./install.sh)"
  warn "  or unset them, unless you set them on purpose."
  read -r -p "Continue with the inherited values? [y/N] " goon
  case "${goon:-N}" in [yY]|[yY][eE][sS]) : ;; *) die "❌ Aborted — nothing was started." ;; esac
fi

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

# --- .env helpers ---
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
envset() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env; then
    # `|` is not valid in any value we set here, so it is a safe sed delimiter.
    sed -i -e "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

# --- ask: where should agent memory live? ---
# Three placements of the SAME store — not three feature tiers. Re-running the
# installer keeps whatever is already in .env (press Enter).
echo
warn "RCLL adds long-term memory shared by your agents (optional)."
warn "  1) none        — no memory. Leanest install."
warn "  2) embedded    — memory lives inside the CRM database, in its own schema."
warn "                   One database to run and back up. Memory migrations are"
warn "                   DDL against your CRM database."
warn "  3) standalone  — memory gets its own database, container and volume."
warn "                   The CRM database is never touched by memory DDL."
warn "Same image and the same data either way; you can move later with a dump."
CURRENT_MODE="$(envget MEMORY_MODE)"; CURRENT_MODE="${CURRENT_MODE:-none}"
read -r -p "Memory placement — none / embedded / standalone [${CURRENT_MODE}] " ans
MEMORY_MODE="${ans:-$CURRENT_MODE}"
case "$MEMORY_MODE" in
  1|n|none)         MEMORY_MODE=none ;;
  2|e|embedded)     MEMORY_MODE=embedded ;;
  3|s|standalone)   MEMORY_MODE=standalone ;;
  *) die "❌ Unknown memory placement: '${MEMORY_MODE}'. Use none, embedded or standalone." ;;
esac
envset MEMORY_MODE "$MEMORY_MODE"

PROFILE_ARGS=()
if [ "$MEMORY_MODE" = "none" ]; then
  say "✓ No memory backend. Add it later: re-run ./install.sh and pick embedded or standalone."
else
  PROFILE_ARGS=(--profile "memory-${MEMORY_MODE}")

  # The memory image must actually exist before we promise a working install.
  # A missing image is an honest error here instead of a container that never
  # comes up while the CRM reports healthy.
  MEMORY_IMAGE="$(envget MEMORY_IMAGE)"
  [ -n "$MEMORY_IMAGE" ] || die "❌ MEMORY_IMAGE is empty in .env — set it or choose 'none'."
  if ! docker manifest inspect "$MEMORY_IMAGE" >/dev/null 2>&1; then
    warn "⚠ Cannot reach ${MEMORY_IMAGE} (not published, or not logged in to the registry)."
    warn "  Memory would fail to start. Build the image yourself and set MEMORY_IMAGE,"
    warn "  or choose 'none' for now."
    read -r -p "Continue anyway? [y/N] " goon
    case "${goon:-N}" in [yY]|[yY][eE][sS]) : ;; *) die "❌ Aborted — nothing was started." ;; esac
  fi

  # An LLM key is used for classification on WRITE only; the read path never
  # calls a model. A real provider with an EMPTY key does not degrade — it
  # fails to boot and restarts forever, with the CRM still reporting healthy.
  # So: no key → provider `none`, which is a supported, working configuration.
  if [ -z "$(envget LLM_API_KEY)" ]; then
    envset LLM_PROVIDER none
    warn "ℹ No LLM_API_KEY — running memory with LLM_PROVIDER=none."
    warn "  Writes and recall work; automatic classification of new memories does not."
    warn "  Add a key to .env, set LLM_PROVIDER back, and restart to enable it."
  fi

  if [ "$MEMORY_MODE" = "embedded" ]; then
    say "✓ Memory: embedded — schema '$(envget MEMORY_SCHEMA)' inside the CRM database."
    warn "→ First start builds that schema. Afterwards set MEMORY_RUN_MIGRATIONS=false"
    warn "  in .env so upgrades to your CRM database stay deliberate."
  else
    say "✓ Memory: standalone — its own database and volume."
  fi
  warn "→ The memory image is large (~6 GB) and pulls on first start."
fi

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
say "   Memory: ${MEMORY_MODE}"
say "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Logs:  docker compose ${PROFILE_ARGS[*]:-} logs -f app"
echo "Stop:  docker compose ${PROFILE_ARGS[*]:-} down"
if [ "$MEMORY_MODE" != "none" ]; then
  echo
  echo "Memory comes up behind the app (it loads local models first). Watch it with:"
  echo "  docker compose ${PROFILE_ARGS[*]:-} logs -f memory-${MEMORY_MODE}"
fi
