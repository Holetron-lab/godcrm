# Everything as a Row

> Most apps add an AI feature. We exposed the entire application as tools
> and let the agents in through the front door.

## The bet everyone is losing

The industry is racing on benchmarks — stuffing more into the model, then
measuring how much stuck. But the oldest rule in computing didn't go away
when the models got big: garbage in, garbage out. A smarter model fed messy,
half-structured state gives you smarter mess.

The leverage was never only the model. It's the **substrate** you hand it.

## One idea

GOD CRM is built on a single principle: *everything is a row*. A contact, a
task, a document, a chat message, a dashboard widget, an agent's memory — all
of it lives as typed, structured state in one pool. Not a database hidden
behind an app, but the app itself, expressed as rows.

When state is clean and uniform, the thing operating on it gets simple. And
that changes what an AI agent *is*.

## An agent is a function, not a chat window

In most products the AI is grafted on the side: a chat box that pokes at the
real system through a narrow API somebody wrote for it. The agent is a guest.

Here the agent is a **first-class function over the state** — calling the
exact same operations the UI calls. `query_table_data`, `add_table_row`,
`create_document`: no special agent path, no shadow API. The human clicks it,
the agent calls it, they're the same verb over the same rows.

Function first. Because that's what real work needs — something reliable and
composable that operates on your actual state — not another window to talk to.

## Why Claude

We didn't pick Claude because it tops a leaderboard. We picked it because it
behaves best as a *function* in a system like this: reliable, steerable,
agentic. In a substrate where the agent has the keys to the whole house, the
question isn't "which model is loudest" — it's "which one is the best
citizen." For us that answer has been consistent.

## Open core. Forever.

The substrate only matters if you can build on it. The CRM is open — MIT, and
the MCP surface is right there in the repo, not behind a sales call. Connect
your own agent, read the tools, run it yourself.

→ The full tool surface and connection guide: **[MCP.md](./MCP.md)**.
