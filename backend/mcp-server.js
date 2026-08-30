#!/usr/bin/env node
/**
 * GOD CRM — MCP Server
 *
 * Exposes all CRM backend tools as MCP tools for Claude Code CLI.
 * Reads tool definitions from AGENT_TOOLS, executes via executeTool().
 *
 * Usage:
 *   node backend/mcp-server.js          (stdio transport)
 *
 * Connect via Claude Code CLI:
 *   claude --mcp-config .mcp.json
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Import CRM tool system
import { executeTool } from './services/agent-tools/executor.js';
import { buildToolList } from './services/mcp/buildToolList.js';

// ADR-0040: this stdio MCP server is a SEPARATE process from the Express boot,
// so it must initialize the SecretsVault itself. Without this, the vault
// singleton stays uninitialized in this process and vault-backed tools with no
// env fallback (e.g. bluesky_search → bluesky_handle/app_password) return
// "not configured" even though the creds are present and decrypt fine.
import secretsVault from './services/secrets/SecretsVault.js';
import { getAdapter as getDbAdapter, dbGet, safeJsonParse } from './database/connection.js';

// ── Caller identity ────────────────────────────────────────────
// This process is one CLI agent's bridge, so its identity is a property of the
// process, not of a request — resolved once and reused.
//
// AGENT_ID is injected per child by the CLI provider that spawns the agent
// (cli-providers.js), which makes it server-derived: the agent cannot choose
// it. That is why it outranks MCP_AGENT_SLUG (launch config) and both outrank
// a self-declared `author` tool argument.
//
// The lookup is a deliberate plain read, NOT resolveAgentUser(): that helper
// find-or-creates the agent's user row, and a memory write is no reason to
// mutate the users table.
let cachedIdentity;
async function resolveCallerIdentity() {
  if (cachedIdentity !== undefined) return cachedIdentity;

  const agentId = Number((process.env.AGENT_ID || '').trim());
  if (Number.isFinite(agentId) && agentId > 0) {
    try {
      const row = await dbGet(
        `SELECT tr.data
           FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
          WHERE ut.name = 'AI Agents' AND tr.id = $1`,
        [agentId]
      );
      const data = row ? safeJsonParse(row.data, {}) : {};
      const name = data.slug || data.name || null;
      if (name) {
        cachedIdentity = name;
        console.error(`[godcrm-mcp] caller identity: ${name} (AGENT_ID=${agentId})`);
        return cachedIdentity;
      }
      console.error(`[godcrm-mcp] AGENT_ID=${agentId} resolved to no agent row — falling back`);
    } catch (err) {
      console.error('[godcrm-mcp] agent identity lookup failed:', err?.message || err);
    }
  }

  cachedIdentity = (process.env.MCP_AGENT_SLUG || '').trim() || null;
  return cachedIdentity;
}

// ── Build tool list ────────────────────────────────────────────
// SKIP_TOOLS + the OpenAI→MCP conversion now live in the shared builder so the
// stdio surface here and the public HTTP mount can never drift (NO-SIGNUP-MCP §B1).

const mcpTools = buildToolList();

// ── MCP Server ─────────────────────────────────────────────────

const server = new Server(
  {
    name: 'godcrm',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: mcpTools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Validate tool exists
  const toolDef = mcpTools.find(t => t.name === name);
  if (!toolDef) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  try {
    // userId=1 (system/admin), context with space_id
    const context = {
      spaceId: parseInt(process.env.MCP_SPACE_ID || '11', 10),
      source: 'mcp',
    };

    // Author attribution for MCP/CLI callers. Threading the resolved identity
    // as agentName makes it outrank a self-declared `author` argument, exactly
    // as the in-CRM agent loop's identity does. Unresolvable → the tool falls
    // back to the argument, and warns if there is none.
    const callerIdentity = await resolveCallerIdentity();
    if (callerIdentity) context.agentName = callerIdentity;

    const result = await executeTool(name, args || {}, 1, context);

    const isError = result?.error ? true : false;
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    return {
      content: [{ type: 'text', text }],
      isError,
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// ── Start ──────────────────────────────────────────────────────

async function main() {
  // Initialize the SecretsVault before serving tools. Best-effort: a failure
  // here must not stop the MCP server (secret-less tools still work), but in
  // NODE_ENV=production with a missing master key init() self-exits (ADR-0040
  // AC4 fail-fast) — that is intentional. Logs to stderr to keep stdio clean.
  try {
    const adapter = await getDbAdapter();
    const health = await secretsVault.init({ adapter });
    console.error(`[godcrm-mcp] SecretsVault initialized (hasKey=${health.hasKey}, listening=${health.listening}).`);
  } catch (err) {
    console.error('[godcrm-mcp] SecretsVault init failed — vault-backed tools degraded:', err?.message || err);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with stdio protocol
  console.error(`[godcrm-mcp] Server started. ${mcpTools.length} tools registered.`);
}

main().catch((err) => {
  console.error('[godcrm-mcp] Fatal error:', err);
  process.exit(1);
});
