# GOD CRM as an MCP Server

The entire CRM is exposed over the [Model Context Protocol](https://modelcontextprotocol.io).
This document is the reference: what's exposed, how it's wired, and how to
connect. For *why* it's built this way, see [MANIFESTO.md](./MANIFESTO.md).

## What's exposed

`backend/mcp-server.js` is a thin bridge: it reads the internal `AGENT_TOOLS`
definitions and serves them over MCP's stdio transport. **82 tools**, grouped:

| Domain | Examples |
|---|---|
| **Tables & data** | `query_table_data`, `get_table_schema`, `add_table_row`, `update_table_row`, `batch_update_rows`, `manage_columns`, `analyze_table_data` |
| **Projects & spaces** | `list_projects`, `create_project`, `create_space`, `move_project_to_space` |
| **Documents** | `list_documents`, `get_document_content`, `create_document` |
| **Dashboards & widgets** | `create_dashboard`, `create_widget`, `update_widget` |
| **Chat** | `send_chat_message`, `send_widget_message`, `create_conversation`, `spawn_ticket_from_chat` |
| **Calendar** | `list_events`, `create_event`, `update_event` |
| **Agent memory** | `memory_retain`, `memory_recall`, `memory_reflect` |
| **Web & research** | `web_search`, `deep_scrape`, `global_search` |
| **Media generation** | `replicate_image_generate`, `gemini_image_generate`, `replicate_3d_generate` |
| **Reach** | `send_telegram_message`, `slack_post_message` |
| **External sources** | `reddit_search`, `bluesky_search`, `github_get_user`, `figma_get_file` |
| **Agent identity** | `issue_passport`, `revoke_passport` |
| **Hardware** | `printer_status`, `printer_start`, `printer_slice_and_print` |

Agent-internal tools (planning, orchestration) and file tools are deliberately
*not* exposed over MCP — an MCP client like Claude Code already has its own.

## Architecture

The same `executeTool()` runs whether the caller is the in-app agent runtime
or an external MCP client. No second code path, no shim — the MCP server is
under 200 lines because the tools already existed for the in-app agents. MCP
wasn't a bolt-on; it's already how the system talks to itself.

Calls arriving over MCP carry the agent's own identity: `AGENT_ID` is injected
by the process that spawns the agent, so it is server-derived rather than
self-declared, and it lands in the audit trail as the acting agent (ADR-0066-B).

## Connect Claude Code to your instance

```bash
node backend/mcp-server.js   # stdio transport
```

```jsonc
// .mcp.json
{ "mcpServers": { "godcrm": { "command": "node", "args": ["backend/mcp-server.js"] } } }
```

```bash
claude --mcp-config .mcp.json
```

Your agent now operates the CRM the same way the in-app agents do — over rows.

## License

MIT.
