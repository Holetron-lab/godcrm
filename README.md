[![MCP server](https://glama.ai/mcp/servers/Holetron-lab/godcrm/badge)](https://glama.ai/mcp/servers/Holetron-lab/godcrm)

# GOD CRM

> **Everything is a row.** One primitive — a row in Postgres — and everything
> is made of it. Tickets, documents, chat, the AI agents themselves. All the
> way down. That's not a tagline; it's the whole architecture.
>
> Which is why an agent here doesn't just fill in fields. It adds the table, the
> column, the widget — in the running system, no code generation and no redeploy.
> `create_table` and `manage_columns` sit in the same tool list as
> `query_table_data`. Clone it and check.

## Everything is a row

Under all of it — tickets, documents, chat, even the AI agents — there's one
primitive: a row in Postgres. A ticket is a row. A document is a row. The agent
is a row too, in the same database, on the same connection pool. No separate
service, no chatbot bolted on the side.

```
chip       a single row, surfaced anywhere      →  a card dropped into a chat
widget     a module sliced onto a dashboard     →  the kanban, one status
module     universal tables doing a real job    →  the whole kanban board
universal  an interface over the raw table      →  how you see it and edit it
raw        a plain Postgres table               →  columns, types, storage
──────────────────────────────────────────────────────────────────────────
           every layer is rows. zoom in or out — it never stops being rows.
```

Four layers, bottom to top:

- **Raw table** — a plain Postgres table: columns, types, the literal storage.
- **Universal table** — an interface over the raw table: how you view the data and work with it.
- **Module** — an assembly of universal tables that does a real job. Concretely: a kanban — the whole board, every column and status.
- **Widget + chip** — the rendered surface, at two zoom levels. A **widget** is a slice of a module placed on a dashboard — the kanban filtered down to a single status. A **chip** is one row from it, surfaced anywhere — that same card dropped into a chat.

A widget is a filtered set of a module's rows; a chip is a single one of them. Same data, three zoom levels: board to slice to row. And a chip is a row — so the primitive is the same at the storage floor and at the rendered surface.

Automations are a separate axis — not a layer in this stack. They're triggers and reactions wired onto a module's rows; the kanban is a kanban with or without them. An automation just watches rows and acts.

## Built as an MCP server

The agent is a row — and it reaches the rows the same way you do. The whole CRM
is exposed over the [Model Context Protocol](https://modelcontextprotocol.io):
**82 tools over one substrate.** Tables, documents, dashboards, chat, calendar,
agent memory, web research, image generation — every verb the UI has, an agent
has too. Same operations, same rows. No shadow API written just for the bot.

Fifteen of those verbs don't touch data at all — they create, alter and move the
containers themselves: `create_table`, `manage_columns`, `create_widget`,
`create_dashboard`. That's the line worth looking at. An agent that can only
read and write rows is an assistant; one that can add the table is a builder.

| Group | Tools | What it covers |
|---|---|---|
| Tables & rows | 14 | `query_table_data`, `add_table_row`, `batch_update_rows`, `manage_columns`, `analyze_table_data` — the primitive, and everything you do to it |
| Workspace | 13 | spaces, projects, copy/move, `global_search` |
| Printing | 11 | a 3D printer driven from the CRM: slice, upload, start, temperatures |
| Chat & tickets | 7 | conversations, messages, `spawn_ticket_from_chat` |
| Agent memory | 6 | `memory_retain` / `memory_recall` / `memory_bridge` — persistent, room-scoped |
| Dashboards & widgets | 5 | build and edit the rendered surface |
| Documents | 5 | atom-level document read and write |
| Calendar | 4 | events |
| Research | 4 | `web_search`, `deep_scrape`, `bluesky_search`, `reddit_search` |
| Generation | 4 | Replicate and Gemini — images, 3D |
| Integrations | 4 | Telegram, Slack, Figma, GitHub |
| Ops | 3 | uploads, BDD specs, in-flight queue |
| Agent passports | 2 | `issue_passport` / `revoke_passport` — per-agent identity and audit trail |

The agent-only surface — planning, sandboxed code execution, file tools — is
deliberately **not** exposed. Your MCP client already has file tools; the CRM
shouldn't ship a second set. See `SKIP_TOOLS` in
[`backend/services/mcp/buildToolList.js`](./backend/services/mcp/buildToolList.js) —
one builder feeds both transports, so the stdio and HTTP surfaces can't drift.

- **The idea** → [docs/MANIFESTO.md](./docs/MANIFESTO.md) — why an agent is a
  function over rows, not a chatbot beside them.
- **The surface** → [docs/MCP.md](./docs/MCP.md) — the full tool list, the
  196-line bridge, and how to point Claude Code at your own instance.

## Run it

You need Docker and `openssl`. Nothing else.

```bash
git clone https://github.com/Holetron-lab/godcrm.git
cd godcrm/deploy/selfhost
./install.sh
```

The installer generates every secret, asks where agent memory should live, and
brings up the stack. Open **http://localhost:5000** — the first account you
register becomes the owner. Postgres 16 with `pgvector`, schema migrated on
boot, data in named volumes that survive `docker compose down`.

Prefer to do it by hand? `cp env.example .env`, fill the blanks, then
`docker compose up -d --build`. Full notes — memory modes, reverse proxy,
the shell-beats-`.env` trap — in
[`deploy/selfhost/README.md`](./deploy/selfhost/README.md).

### Point an MCP client at it

The repo ships an `.mcp.json` at the root. The entry that matters:

```json
{
  "mcpServers": {
    "godcrm": {
      "command": "node",
      "args": ["backend/mcp-server.js"],
      "env": { "MCP_SPACE_ID": "11" }
    }
  }
}
```

Run `claude --mcp-config .mcp.json`. `MCP_SPACE_ID` is the workspace the agent
is scoped to — it can't see rows outside it. The server reads `.env` from the
repo root, so it uses the same database and the same credentials as the app.

### Configuration

`deploy/selfhost/env.example` is the template. The ones you'll actually touch:

| Variable | What it does |
|---|---|
| `PUBLIC_URL` | the origin you open the app from. Must match, or CORS gates the assets and you get a white screen |
| `APP_PORT` | host port, default `5000` |
| `MEMORY_MODE` | `none` / `embedded` / `standalone` — where agent memory lives. Off by default |
| `POSTGRES_*` | database name, user, password |
| `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY` | `openssl rand -hex 32` each |
| `SECRETS_MASTER_KEY` | `openssl rand -base64 32` — encrypts the API-key vault at rest. **Lose it and the vault is unrecoverable** |
| `LLM_PROVIDER`, `LLM_API_KEY` | optional. `none` is fully supported — memory writes and recall still work without a model |

`install.sh` generates all of these for you. The table is here for the manual path.

## Open core. Forever.

The floor is open source and stays open. MIT, every line readable, self-hosted on your own VPS in a few minutes. I won't close it, won't rug-pull it into a "cloud edition," won't gate the engine behind a seat fee. Open *core* — not "free until we get traction." The core is yours, for good.

## The value moved from code to experience

For thirty years the scarce thing was code. AI ended that. Code is cheap now — anyone can generate a CRUD screen in an afternoon. What stayed scarce is experience.

You can't build a working automation for a pizzeria without knowing how a pizzeria actually runs — the Friday rush, the waste, the supplier who's always late. The code is trivial. The knowing is the whole job.

So GOD CRM is built around that shift. The thing worth paying for isn't the rows or the widgets — those are open and free. It's the *system* someone built because they ran the business for ten years and know exactly where it bleeds.

## A market for what you know — *(building)*

On top of the open core: a marketplace. You build a table-system, an automation, a playbook, a book — anything — and you trade it. Free or paid. You're both buyer and seller.

The first product to land here will be our own: **Table Wizard** — a paid Holetron Ltd tool, the first to ship on this marketplace. We sell what we build on the same terms as everyone else: we price ours, other builders price theirs, and no one's work is ours to give away.

Run a pizzeria and know it cold? Package the system and sell it to the next person opening one. Your experience and your name become the product — not your code. This part is in progress; the core is here today.

## Free forever for research

No fee, no seat cap, no upsell — for schools, independent teachers, universities, labs, peaceful research institutions, and registered non-profits. That's the open core, plus every product Holetron Ltd makes itself — Table Wizard and the paid first-party tools that follow — free, not a trial and not an "academic discount." What other builders sell on the marketplace stays theirs to price; we can't give away someone else's work — but our own we can, and for science we do.

## Three rules

Everything above is one conviction, held stubbornly: **reduce it to the primitive.**
A row. Then build only with that. We call it primitivism, and it comes down to
three rules:

1. **Don't overcomplicate.** If it needs a new primitive, you probably haven't understood the problem yet.
2. **Function first.** An agent is a function over rows. A widget is a function over rows. Behaviour before chrome.
3. **Reuse.** The human clicks `add_table_row`; the agent calls `add_table_row`. One verb, one path, no duplicates.

## Don't trust the pitch

Clone it and run it. That's the only benchmark that matters.

```bash
git clone https://github.com/Holetron-lab/godcrm.git
# or, from our own git:
git clone https://godcrm.ai/git/holetron-lab/godcrm.git
```

One command brings it up — see [Run it](#run-it) above.

MIT licensed. Postgres · Node/Express · React 19 · TypeScript. Early alpha — issues and PRs welcome.
