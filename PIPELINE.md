# GOD CRM — Pipeline Constitution (v1)

> The single source of truth for all agents and developers.
> Violation = job loss. No exceptions.

---

## 1. Where the code lives

| | PROD (.205) | DEV (.72) |
|---|---|---|
| **Role** | Source of truth | Test environment |
| **Code path** | `/root/production/business-crm/` | `/root/production/business-crm/` (rsync copy) |
| **Git** | Yes, branch `main` | NO `.git` — files only |
| **Editable?** | YES — only here | NO — overwritten by rsync |
| **Nginx** | `/var/www/business-crm/` (copy of dist) | `/var/www/business-crm-dev` → symlink → `dist/` |
| **PM2** | `godcrm` | `godcrm` |
| **Domain** | `crm.hltrn.cc` | `devcrm.hltrn.cc` |

**There are exactly 2 copies of the code.** No worktrees, duplicates, or temporary folders.

---

## 2. Workflow (the only correct one)

```
┌─────────────────────────────────────────────────┐
│  1. EDIT on PROD (.205)                         │
│     All changes in /root/production/business-crm│
├─────────────────────────────────────────────────┤
│  2. DEPLOY to DEV                               │
│     make dev  (or bash scripts/deploy.sh dev)   │
│     - rsync PROD→DEV (excluding node_modules,   │
│       .git, .env, dist)                         │
│     - npm install + npm run build on DEV        │
│     - pm2 restart godcrm on DEV                 │
├─────────────────────────────────────────────────┤
│  3. TEST on DEV                                 │
│     Open devcrm.hltrn.cc, verify the feature    │
│     Ctrl+Shift+R if cached (even though no-cache)│
├─────────────────────────────────────────────────┤
│  4. GIT COMMIT on PROD                          │
│     git add <files> && git commit               │
│     Commit AFTER verifying on DEV               │
├─────────────────────────────────────────────────┤
│  5. DEPLOY to PROD (only after DEV test)        │
│     make prod                                   │
│     - npm run build on PROD                     │
│     - cp dist → /var/www/business-crm/          │
│     - pm2 restart godcrm                        │
└─────────────────────────────────────────────────┘
```

---

## 3. Commit rules

- **COMMIT EVERY COMPLETED TASK.** Don't pile up 17 files.
- Format: `feat:`, `fix:`, `refactor:` + short description
- A commit = a restore point. Without a commit, the code is "ghost" — the next agent won't see it via git.
- If a task isn't finished — create a WIP commit: `wip: chat toolbar buttons`

---

## 4. Deploy commands

| Command | What it does |
|---|---|
| `make dev` | rsync PROD→DEV + build + restart DEV |
| `make prod` | build PROD + copy dist + restart PROD |
| `make both` | dev + prod |
| `make sync-db` | pg_dump PROD → pg_restore DEV |
| `make build` | only npm run build (local) |
| `make restart` | only pm2 restart (local) |

---

## 5. Deploy checklist for agents

Before every deploy, the agent MUST:

- [ ] Ensure files are saved (no unsaved buffers)
- [ ] Verify `npm run build` locally — no build errors
- [ ] Run `make dev` and wait for the output `[DEV] Done. Bundle: ...`
- [ ] Compare the PROD vs DEV bundle hash (contents should match)
- [ ] Report the URL + bundle hash to the user
- [ ] Do NOT say "done" until the bundle is verified

---

## 6. Troubleshooting "code didn't show up on DEV"

```bash
# 1. Check the file was actually changed on PROD
cat /root/production/business-crm/src/path/to/file.tsx | grep "expected_code"

# 2. Check rsync copied it
ssh root@<DEV_IP> 'cat /root/production/business-crm/src/path/to/file.tsx | grep "expected_code"'

# 3. Check the build included the code in the bundle
ssh root@<DEV_IP> 'grep -c "expected_string" /root/production/business-crm/dist/assets/index-*.js'

# 4. Check which bundle index.html loads
ssh root@<DEV_IP> 'grep "index-" /root/production/business-crm/dist/index.html'

# 5. Check nginx
curl -sI https://devcrm.hltrn.cc/ | grep -i cache
```

---

## 7. Forbidden

1. **Editing code on DEV (.72)** — rsync will overwrite it
2. **Deploying to PROD without testing on DEV**
3. **Piling up >5 uncommitted files** — commit more often
4. **Creating copies/worktrees without an explicit user request**
5. **Saying "deployed" without verifying the bundle hash**
6. **Restarting PROD PM2 for frontend changes** — `cp dist` is enough
7. **Manual rsync** — only via `make dev` / `scripts/deploy.sh`
8. **`git pull --rebase` on PROD without checking** — may leave conflict markers (`<<<<<<<`) → Node.js crashes
9. **`pm2 restart` on PROD without `grep -r '<<<<<<' backend/`** — always check for conflicts before restarting
10. **An agent editing code itself** — the Orchestrator ONLY routes tasks via `dispatch_task`. Code is edited by Developer/Frontend.

---

## 8. Safe git pull

```bash
# NEVER just run git pull --rebase
# Always do this:
git pull --rebase origin main
if grep -r '<<<<<<' backend/ src/ 2>/dev/null; then
  echo "CONFLICT MARKERS FOUND — DO NOT RESTART"
  exit 1
fi
# Only after the check:
pm2 restart godcrm
```

---

## 9. Agent architecture (Context Management)

### Agent roles

| Agent | Model | Role | Tools |
|---|---|---|---|
| **Orchestrator** | Sonnet | ONLY routing, planning, statuses | dispatch_task, manage_plan, send_ticket_message, view_conversation_steps |
| **Developer** | Opus | Backend code, API, SQL | read_file, write_file, edit_file, run_code |
| **Frontend** | Opus | React, CSS, UI | read_file, write_file, edit_file |
| **Architect** | Sonnet | ADR, planning, architecture | read_file, query_table_data, web_search |
| **SysAdmin** | Sonnet | Deploy, infra, server config | run_code, read_file |

### Context Settings (ADR-110)

All agents use `context_settings` in the AI Agents table (JSON in the `context_settings` field):

```json
{
  "max_history": 30,          // messages in context (Orchestrator: 30, others: 50)
  "context_levels": {
    "thinking": true,          // Level 2: sees reasoning (preview)
    "thinking_preview_chars": 150,
    "tool_summaries": true,    // Level 3: sees tool calls (preview)
    "tool_preview_chars": 80,
    "full_tool_results": false // Level 4: full results (off by default)
  },
  "auto_summary": {
    "enabled": true,           // Auto-summarization of old messages
    "chunk_size": 15,          // Summarize every 15 messages
    "keep_recent": 8,          // Last 8 — no summarization
    "model": "gpt-4o-mini",   // Model for summarization
    "inject_in_system": true   // Insert summary into system prompt
  }
}
```

### Context drill-down

Agents have the `view_conversation_steps` and `view_step_detail` tools to expand the full context of steps on demand. This allows working at Level 2-3 (token savings) and loading the full data of a specific step when needed.

---

## 10. What is stored where

| Data | Location | Backup |
|---|---|---|
| Source code | PROD `/root/production/business-crm/` | git (main) |
| Database (master) | PROD PostgreSQL `godcrm_prod` | pg_dump |
| Database (test) | DEV PostgreSQL `godcrm_prod` | None — recreated via `make sync-db` |
| Static (PROD) | `/var/www/business-crm/` | Recreated via `make prod` |
| Static (DEV) | symlink → `dist/` | Recreated via `make dev` |
| Secrets (.env) | PROD and DEV, separately | Not in git |

---

*Last updated: 2026-04-02*
*Version: 2.0 — added context rules, agent roles, safe git pull*
