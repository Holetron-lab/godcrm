# GOD CRM

> **Everything is a row.** One primitive — a row in Postgres — and everything
> is made of it. Tickets, documents, chat, the AI agents themselves. All the
> way down. That's not a tagline; it's the whole architecture.

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
**73 tools over one substrate.** Tables, documents, dashboards, chat, calendar,
agent memory, web research, image generation — every verb the UI has, an agent
has too. Same operations, same rows. No shadow API written just for the bot.

- **The idea** → [docs/MANIFESTO.md](./docs/MANIFESTO.md) — why an agent is a
  function over rows, not a chatbot beside them.
- **The surface** → [docs/MCP.md](./docs/MCP.md) — the full tool list, the
  ~160-line bridge, and how to point Claude Code at your own instance.

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

Clone it and read the code. That's the only benchmark that matters.

```
git clone https://godcrm.ai/git/holetron-lab/godcrm.git
```

MIT licensed. Postgres · Node/Express · React 19 · TypeScript. Early alpha — issues and PRs welcome.
