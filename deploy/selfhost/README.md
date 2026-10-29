# GOD CRM — Self-Host

Run the whole CRM on your own box with one command. The core is MIT — clone it,
run it, your data stays in a shape you can read.

## Quick start

```bash
cd deploy/selfhost
./install.sh
```

The installer generates secrets, asks **where agent memory should live**, then
builds and starts everything. When it finishes, open **http://localhost:5000** —
the **first account you register becomes the owner**.

## Manual start (no installer)

```bash
cd deploy/selfhost
cp env.example .env
# generate secrets and fill the empty values in .env:
#   openssl rand -hex 32     # JWT_SECRET, ENCRYPTION_KEY, ... and CRM_CREDENTIAL_KEY
#   openssl rand -hex 24     # POSTGRES_PASSWORD, HINDSIGHT_DB_PASSWORD
#   openssl rand -base64 32  # SECRETS_MASTER_KEY
docker compose up -d --build
```

## What you get

| Service | Image | Notes |
|---|---|---|
| `app` | built from this repo | Express API + built React frontend on port `5000` |
| `db`  | `pgvector/pgvector:pg16` | the CRM database; schema is migrated automatically on boot |

`pgvector/pgvector:pg16` is stock Postgres 16 with the `vector` extension
available. It is the default in every mode so that turning memory on later
never means swapping the image under an existing data volume.

Data lives in named volumes (`godcrm-db`, `godcrm-uploads`) — it survives
`docker compose down` and is removed only with `docker compose down -v`.

## Optional: agent memory (RCLL)

Long-term memory shared by your agents. Off by default. There are **three
placements of the same store** — not three feature tiers. Same image, same
migrations, same data model:

| `MEMORY_MODE` | Where memory lives | Trade-off |
|---|---|---|
| `none` | nowhere | leanest install; memory tools are inert |
| `embedded` | schema `MEMORY_SCHEMA` **inside the CRM database** | one database to run and back up; memory migrations are DDL against your CRM database |
| `standalone` | its own database, container and volume | two databases to back up; the CRM database is never touched by memory DDL |

```bash
docker compose --profile memory-embedded   up -d
docker compose --profile memory-standalone up -d
```

Enable exactly **one**. Both answer on the same network alias (`hindsight`), so
`HINDSIGHT_URL` is identical either way.

Switching mode later does **not** move the data — dump from the old placement
and load into the new one.

### Things worth knowing before you pick

- **The read path never calls an LLM.** Embeddings and reranker run locally on
  CPU. A model is used only to classify memories on write; `LLM_PROVIDER=none`
  is fully supported — writes and recall still work, only automatic
  classification is off. A real provider with an *empty* key does not degrade,
  it fails to boot, so the installer writes `none` when you have no key.
- **`embedded` runs memory migrations against your CRM database.** A fresh
  install needs that once, to build the schema. After first boot set
  `MEMORY_RUN_MIGRATIONS=false` in `.env` and run upgrades deliberately, after
  a backup.
- **The memory image is large** (~6 GB) and pulls on first start.

## Configuration

All settings live in `.env` (template: `env.example`). The two you'll most
likely change:

- **`PUBLIC_URL`** — the origin you open the app from. It must match, or the
  browser gets a white screen (CORS gates the static assets). For a domain set
  e.g. `PUBLIC_URL=https://crm.example.com` and front the app with your own
  TLS-terminating reverse proxy → `http://localhost:${APP_PORT}`.
- **`APP_PORT`** — host port (default `5000`).
- **`MEMORY_MODE`** — `none` / `embedded` / `standalone`, see above.

> **Your shell wins over `.env`.** Compose resolves `${VAR}` from the shell
> environment first. If your shell already exports `POSTGRES_*` or `JWT_SECRET`
> — a box that runs another app, a sourced profile — the stack silently uses
> those instead of `.env`: wrong database, wrong secret, no error. `install.sh`
> checks for this and stops; if you start compose by hand, run it from a clean
> shell.

## Common commands

```bash
docker compose logs -f app     # follow app logs
docker compose ps              # status
docker compose down            # stop (keeps data)
docker compose down -v         # stop and delete all data volumes
docker compose up -d --build   # rebuild after pulling new code
```

## Schema upgrades

Back up the database and uploads before upgrading. The entrypoint loads
`schema.sql` atomically on an empty database, then runs
`node run-migrations.mjs --selfhost` before seeding or starting the server.
Existing snapshot installations run the same upgrade without reloading the dump.
Migration failures stop startup; fix the reported conflict and retry.

Snapshot upgrades use `selfhost_migrations` (and Knex's lock table). The original
`knex_migrations` stays empty: historical core migrations did not produce this
snapshot and must not be marked as applied. Once the self-host ledger exists,
`node run-migrations.mjs` also selects this chain. For the first manual upgrade:

```bash
docker compose run --rm --entrypoint node app run-migrations.mjs --selfhost
```

The first bridge supports the shipped snapshot and the previously published
GitHub snapshot at `d800f339f3680797188c81cacef62d4e8a3554af`. It adds connected
account identity, mail messages/labels/attachments/outbox/folders, and mailbox
schema with `users.handle`. It preserves existing data and leaves mailbox
provisioning disabled unless the owner previously enabled it. Installing an
SMTP/IMAP server and enabling provisioning remain separate operator actions.

A non-empty core migration ledger is refused in snapshot mode; it needs an
explicit reconciliation, not automatic baselining. This bridge does not claim
full parity with every core or optional-module migration. Add future snapshot
upgrades to `deploy/selfhost/migrations`; do not edit the dump or replay core
CREATE migrations on an installed database. Upgrades are forward-only; rollback
means restoring the pre-upgrade backup with the previous application image.

Backend regression (Docker required, no production data or external mail):

```bash
python3 scripts/qa/selfhost-upgrade.py <qa-image> <previous-public-schema.sql> /tmp/selfhost-evidence
```

Run from the repository root. The QA image supplies dependencies; current
backend/bootstrap sources are copied into disposable containers on an internal
network. Each scenario uses its own tmpfs `godcrm_test`, without published ports
or host mounts. This checks fresh/legacy upgrades, ledger idempotence, conflict
rollback, mixed-ledger refusal, and real mailbox creation/repair. It does not
replace a clean release-image build or staging Gate 1.
