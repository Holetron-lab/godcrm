# GOD CRM — Development Commands
# PROD: crm.hltrn.cc — code lives here, PM2: godcrm
# DEV:  devcrm.hltrn.cc — test here, PM2: godcrm
#       DEV host/IP resolves from the git-ignored scripts/deploy.local.env
#       (DEV_HOST=root@<real-ip>) — no infra IPs in tracked files.

# Pull DEV_HOST from the git-ignored local override; fall back to placeholder.
-include scripts/deploy.local.env
DEV_HOST ?= root@<DEV_IP>

.PHONY: dev prod sync-db sync-db-local build restart restart-prod status logs logs-dev publish-adr test test-baseline test-clean lease-check

# Shared staging lock + maintenance gate (scripts/staging-lease.sh): every staging
# entry point below runs under `staging-lease.sh run`, which holds one exclusive
# lock for the whole operation and refuses while maintenance is active — so a
# direct `make dev`, the Telegram /deploy_dev or the refresh timer cannot slip
# in between a gate check and the operation. `make lease-check` is the readback.
STAGING_RUN = bash scripts/staging-lease.sh run --
lease-check:
	bash scripts/staging-lease.sh status

# Deploy to DEV (sync + build + restart)
# Touches: rsync /root/production/business-crm/ → $(DEV_HOST):/root/production/business-crm/
#          ssh build on DEV → /root/production/business-crm/dist/ (symlinked to /var/www/business-crm-dev)
#          ssh pm2 restart godcrm on DEV
# Does NOT touch: PROD nginx (/var/www/business-crm/), PROD PM2
dev:
	@echo "[make dev] Destinations: DEV code (rsync), DEV dist (ssh build), DEV PM2 (ssh restart). PROD untouched."
	$(STAGING_RUN) bash scripts/deploy.sh dev

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
#          restore into godcrm_test_incoming on DEV, swap into godcrm_test,
#          rsync uploads .128 → .72 one-way (no --delete)
# Does NOT touch: PROD DB writes, code, nginx
sync-db:
	@echo "[make sync-db] pg_dump local master A (public schema, read-only) → .72: restore-and-swap into godcrm_test + uploads mirror. Same job as godcrm-dev-refresh.timer (04:00 MSK)."
	$(STAGING_RUN) bash scripts/dev-refresh.sh

# Refresh the LOCAL godcrm_test from the local master (ADR-0009 §Phase 7)
# Touches: pg_dump local master (public schema, read-only) → DROP/CREATE local
#          godcrm_test → pg_restore
# Does NOT touch: the master, DEV, any remote box
sync-db-local:
	bash scripts/sync-test-db.sh

# Run the suite against the local godcrm_test.
# Safe on .128: backend/test/contour.js pins POSTGRES_DB=godcrm_test, and the
# ADR-0009 guard allows a production host only over loopback to a *_test DB.
# Serial under the lock is the gate configuration (ADR-203-A1, G9): a baseline
# comparison only means something in the configuration the baseline was
# recorded in, and it is recorded at --maxWorkers=1. On one shared godcrm_test
# three workers push DB-suite hooks past the pinned 5000 ms and cascade into
# "Called end on pool more than once"; one worker gives 0 on the same SHA.
# `flock -n` makes the run single-tenant on the box and refuses (exit 1)
# instead of queueing behind another executor. A run at any other worker
# count is not a BASELINE GREEN/RED verdict — test-baseline.mjs refuses it.
test:
	flock -n /tmp/godcrm-test.lock npm test -- --maxWorkers=1

# Regression check against tests/baseline-failures.json: fails only on tests
# that pass in the baseline and fail here. Use this, not "is it green" — the
# suite has a large known-red set on main.
test-baseline:
	flock -n /tmp/godcrm-test.lock npm run test:baseline -- --maxWorkers=1

# Sweep fixture rows left behind by crashed runs (test.godcrm.local namespace)
test-clean:
	npm run test:clean

# Build frontend only
build:
	npm run build

# Restart DEV PM2 (safe — only affects the DEV box)
restart:
	$(STAGING_RUN) ssh $(DEV_HOST) "cd /root/production/business-crm && pm2 restart godcrm --update-env"

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
