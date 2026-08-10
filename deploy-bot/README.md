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
| `DEV_HOST` | `local` | DEV server. `local` if same box as the bot |
| `PROD_PM2` | `godcrm` | PM2 process name on PROD |
| `DEV_PM2` | `godcrm` | PM2 process name on DEV |
| `PROD_CODE` | `/root/production/business-crm` | Code path (same on both hosts) |
| `DEV_RSYNC_TARGET` | _(empty)_ | rsync target for `/deploy_dev`. Empty → single-box, sync skipped |

### Single-box / migration mode (current setup, server `<LEGACY_IP>`)

The old PROD (`<LEGACY_IP>`) and DEV (`<DEV_IP>`) are gone during the
vdsina migration; `godcrm` now runs locally on this box. So `.env` is:

```env
BOT_TOKEN=<token from @BotFather>
OWNER_ID=423753027
PROD_HOST=local
DEV_HOST=local
DEV_RSYNC_TARGET=
```

In this mode `/deploy_prod`, `/restart_prod`, `/status`, `/logs` all act on this
box locally; `/deploy_dev` builds + restarts locally (rsync step is skipped).

### Two-server mode (after migration completes)

Run the bot on the DEV box and point PROD at the new prod host:

```env
PROD_HOST=root@<new-prod-ip>
DEV_HOST=local
DEV_RSYNC_TARGET=root@<new-dev-ip>     # if /deploy_dev should push code to a separate DEV
```

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
