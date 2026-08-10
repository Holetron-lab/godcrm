# GOD CRM — Self-Host

Run the whole CRM on your own box with one command. The core is MIT — clone it,
run it, your data stays in a shape you can read.

## Quick start

```bash
cd deploy/selfhost
./install.sh
```

The installer generates secrets, asks whether to add the optional Hindsight
memory backend, then builds and starts everything. When it finishes, open
**http://localhost:5000** — the **first account you register becomes the owner**.

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
| `db`  | `postgres:16-alpine` | the CRM database; schema is migrated automatically on boot |

Data lives in named volumes (`godcrm-db`, `godcrm-uploads`) — it survives
`docker compose down` and is removed only with `docker compose down -v`.

## Optional: Hindsight memory

Long-term agent memory (MemPalace). Off by default. Enable it with:

```bash
docker compose --profile memory up -d
```

This pulls our own MemPalace fork (`ghcr.io/holetron/hindsight-mempalace` —
rooms/halls/layers, see `docs/architecture/ADR-148-HINDSIGHT-MEMPALACE-OPEN-SOURCE.md`).
No build step. It needs an `LLM_API_KEY` in `.env` for memory classification
(embeddings and reranker run locally on CPU). Without this profile the CRM runs
fine; agent memory tools are simply inert.

## Configuration

All settings live in `.env` (template: `env.example`). The two you'll most
likely change:

- **`PUBLIC_URL`** — the origin you open the app from. It must match, or the
  browser gets a white screen (CORS gates the static assets). For a domain set
  e.g. `PUBLIC_URL=https://crm.example.com` and front the app with your own
  TLS-terminating reverse proxy → `http://localhost:${APP_PORT}`.
- **`APP_PORT`** — host port (default `5000`).

## Common commands

```bash
docker compose logs -f app     # follow app logs
docker compose ps              # status
docker compose down            # stop (keeps data)
docker compose down -v         # stop and delete all data volumes
docker compose up -d --build   # rebuild after pulling new code
```
