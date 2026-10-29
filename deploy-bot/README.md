# GodCRM Deploy Bot

Telegram bot to deploy / restart / inspect the GodCRM app from chat.

## Config (`deploy-bot/.env`)

The bot is **env-driven** so it survives server migrations without code edits.
A host value of `local` (or empty) means "run on the box the bot itself runs on"
(single-box mode). Any other value is treated as an ssh target (e.g. `root@1.2.3.4`)
and commands are executed over ssh.

| Var | Default | Meaning |
|-----|---------|---------|
| `BOT_TOKEN` | — (required) | Token from @BotFather |
| `OWNER_ID` | `423753027` | Telegram user id allowed to run commands (`0` = no whitelist) |
| `PROD_HOST` | `local` | PROD server. `local` if the bot runs on it, else `root@IP` |
| `DEV_HOST` | `local` | DEV diagnostics/logs host; does not select the `/deploy_dev` destination |
| `PROD_PM2` | `godcrm` | PM2 process name on PROD |
| `DEV_PM2` | `godcrm` | DEV diagnostics process; deployment uses `scripts/deploy.sh` |
| `PROD_CODE` | `/root/production/business-crm` | Code path (same on both hosts) |
| `DEV_RSYNC_TARGET` | — | Legacy setting, ignored by `/deploy_dev` |

### Staging deployment

`/deploy_dev` runs exactly `make -C /root/production/business-crm dev` on
`PROD_HOST` (the source host), with a 15-minute command timeout. `PROD_CODE`
must match that canonical path; a different path is rejected before execution.
The destination comes from the source checkout's git-ignored
`scripts/deploy.local.env`, as for an administrator's `make dev`.
There is no single-box fallback, separate bot rsync/build, or extra PM2 restart.

```env
BOT_TOKEN=<token from @BotFather>
OWNER_ID=423753027
PROD_HOST=local
PROD_CODE=/root/production/business-crm
DEV_HOST=dev72
```

Before invoking, the executor must verify the committed source SHA and working
files, destination/configuration, actual `godcrm_test` database, verified backup,
refresh completion and absence of competing deployment/integration. These
preconditions remain part of the deployment runbook, not checks added by this
handler. Nonzero make/SSH status produces failure, with no fallback or automatic
retry. On timeout, inspect any remote activity before retrying. Success means
`make dev` exited zero; full gate 1 and real API smoke remain separate checks.

## Run

```bash
cd /root/production/business-crm/deploy-bot
npm install
# create .env (see above) with your token, then:
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs deploy-bot --lines 20     # startup prints the resolved PROD/DEV targets
```

## Commands

`/status` · `/restart_prod` · `/pull_prod` · `/deploy_dev` · `/deploy_prod` ·
`/logs` · `/logs_dev` · `/claude_kill` · `/claude_restart` · `/whoami` · `/start`

## Local MCP configuration

`/deploy_prod` (Ring 0) and `/deploy_dev` exclude the root `.mcp.json` from
rsync. Each destination owns this configuration: deployment neither overwrites
an existing file nor installs the artifact's copy when the destination has none.
The DEV exclusion also protects the file from `--delete`. Provision a missing
configuration separately with the destination's credentials.

Verify without Telegram, SSH, database access, or process restarts:

```bash
node --test deploy-bot/mcp-preservation.test.cjs
npm test -- --maxWorkers=1 deploy-bot/deploy-dev.test.mjs scripts/deploy-failure.test.mjs
```

After merging, the owner/executor must restart the **deploy-bot** process from
its configured checkout to load these rules before the next deployment.
`/deploy_prod` excludes `deploy-bot`, so promoting the app alone does not reload
the bot. No restart of `godcrm` is needed to activate this change.
