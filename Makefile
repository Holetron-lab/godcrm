# GOD CRM — Development Commands
# PROD: crm.hltrn.cc — code lives here, PM2: godcrm
# DEV:  devcrm.hltrn.cc — test here, PM2: godcrm
#       DEV host/IP resolves from the git-ignored scripts/deploy.local.env
#       (DEV_HOST=root@<real-ip>) — no infra IPs in tracked files.

# Pull DEV_HOST from the git-ignored local override; fall back to placeholder.
-include scripts/deploy.local.env
DEV_HOST ?= root@<DEV_IP>

.PHONY: dev prod sync-db build restart restart-prod status logs logs-dev publish-adr

# Deploy to DEV (sync + build + restart)
# Touches: rsync /root/production/business-crm/ → $(DEV_HOST):/root/production/business-crm/
#          ssh build on DEV → /root/production/business-crm/dist/ (symlinked to /var/www/business-crm-dev)
#          ssh pm2 restart godcrm on DEV
# Does NOT touch: PROD nginx (/var/www/business-crm/), PROD PM2
dev:
	@echo "[make dev] Destinations: DEV code (rsync), DEV dist (ssh build), DEV PM2 (ssh restart). PROD untouched."
	bash scripts/deploy.sh dev

# Deploy to PROD (build + copy dist + restart)
# Touches: local build → /root/production/business-crm/dist/
#          cp dist → /var/www/business-crm/ (PROD nginx root)
#          pm2 restart godcrm on the agent-home box (master A)
# Does NOT touch: DEV code, DEV PM2
prod:
	@echo "[make prod] Destinations: local build, /var/www/business-crm/ (PROD nginx), PROD PM2 godcrm. DEV untouched."
	bash scripts/deploy.sh prod

# Sync PROD DB → DEV
# Touches: pg_dump godcrm_prod (public schema) on this box (master A) → /tmp/godcrm_prod.dump
#          scp → DEV ($(DEV_HOST)):/tmp/godcrm_prod.dump
#          pg_restore --clean --if-exists on DEV godcrm_prod
# Does NOT touch: PROD DB writes, code, nginx
sync-db:
	@echo "[make sync-db] Destinations: pg_dump local master A (public schema), scp DEV, pg_restore --clean DEV godcrm_prod. PROD DB read-only."
	bash scripts/deploy.sh sync-db

# Build frontend only
build:
	npm run build

# Restart DEV PM2 (safe — only affects the DEV box)
restart:
	ssh $(DEV_HOST) "cd /root/production/business-crm && pm2 restart godcrm --update-env"

# Restart PROD PM2 (requires explicit confirmation)
restart-prod:
	@echo "WARNING: This will restart PROD PM2 on $$(hostname) (agent-home / master A)"
	@read -r -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || (echo "Aborted."; exit 1)
	pm2 restart godcrm

# Show PM2 status (both servers)
status:
	@echo "=== PROD ===" && pm2 status godcrm
	@echo "=== DEV ($(DEV_HOST)) ===" && ssh $(DEV_HOST) "pm2 status godcrm" 2>/dev/null || echo "(DEV unreachable)"

# Tail PROD PM2 logs
logs:
	pm2 logs godcrm --lines 50

# Tail DEV PM2 logs
logs-dev:
	ssh $(DEV_HOST) "pm2 logs godcrm --lines 50"

# Publish ADR markdown → a documents widget via the v4 API.
# Pass exactly ONE target (REGISTRY or WIDGET) — no silent default to avoid
# the "ADR landed in the wrong widget" bug we hit several times.
#
# Usage (Architecture v2 examples):
#   make publish-adr WIDGET=2683   FILE=docs/ADR-0003-foo.md SLUG=adr-0003 ICON=🔥 NAME="ADR-0003 — Foo"
#   make publish-adr REGISTRY=7266 FILE=docs/ADR-0003-foo.md SLUG=adr-0003 ICON=🔥 NAME="ADR-0003 — Foo"
#
# Always --no-cleanup (additive); script refuses to run without an explicit target.
publish-adr:
	@test -n "$(FILE)" || (echo "FILE=docs/ADR-XXXX-....md required"; exit 1)
	@test -n "$(SLUG)" || (echo "SLUG=adr-NNNN required"; exit 1)
	@test -n "$(NAME)" || (echo "NAME=\"ADR-NNNN — Title\" required"; exit 1)
	@if [ -n "$(WIDGET)" ] && [ -n "$(REGISTRY)" ]; then \
	  echo "pass only ONE of WIDGET=<id> | REGISTRY=<id>, not both"; exit 1; \
	fi
	@if [ -n "$(WIDGET)" ]; then \
	  node scripts/rebuild-adr-docs-v4.js --widget $(WIDGET) --no-cleanup \
	    --files "$(FILE),$(SLUG),$(or $(ICON),📘),$(NAME)"; \
	elif [ -n "$(REGISTRY)" ]; then \
	  node scripts/rebuild-adr-docs-v4.js --registry $(REGISTRY) --no-cleanup \
	    --files "$(FILE),$(SLUG),$(or $(ICON),📘),$(NAME)"; \
	else \
	  echo "pass WIDGET=<id> or REGISTRY=<id> (e.g. WIDGET=2683 or REGISTRY=7266)"; exit 1; \
	fi
