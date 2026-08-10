/**
 * Shared MCP tool-list builder.
 *
 * Single source of truth for the OpenAI-function → MCP-tool conversion and the
 * agent-only SKIP_TOOLS set. Imported by BOTH the stdio entrypoint
 * (`backend/mcp-server.js`) and the public HTTP mount
 * (`backend/services/mcp/publicMcp.js`) so the advertised tool surface can
 * never drift between transports (NO-SIGNUP-MCP.md §B1).
 */

import { AGENT_TOOLS } from '../agent-tools/tool-definitions.js';

// Tools that only make sense inside the agent runtime (planning, conversation
// context, sandboxed code, local file ops). Excluded from every MCP surface.
export const SKIP_TOOLS = new Set([
  'manage_plan',               // agent-internal planning
  'view_conversation_steps',   // needs conversation_id context
  'view_step_detail',          // needs message_id context
  'save_conversation_summary', // needs conversation context
  'supervisor_decide',         // agent chain orchestration
  'dispatch_task',             // agent orchestration
  'update_ticket_status',      // agent orchestration
  'send_ticket_message',       // agent orchestration
  'get_chain_status',          // agent orchestration
  'get_my_tasks',              // agent-only
  'run_code',                  // sandboxed code execution
  'validate_code',             // sandboxed code execution
  'run_code_loop',             // sandboxed code execution
  // File tools — Claude Code CLI already has its own file tools
  'read_file',
  'write_file',
  'list_directory',
  'search_files',
  'edit_file',
]);

/**
 * Convert an OpenAI function-tool definition to the MCP tool shape.
 * Returns null for malformed definitions (no function name).
 */
export function openaiToMcpTool(toolDef) {
  const fn = toolDef?.function;
  if (!fn?.name) return null;
  return {
    name: fn.name,
    description: fn.description || '',
    inputSchema: fn.parameters || { type: 'object', properties: {} },
  };
}

/**
 * Build the full MCP tool list (every non-skipped agent tool, with schemas).
 * Per NO-SIGNUP-MCP.md §B6 the public mount advertises this entire surface in
 * `tools/list`; capability isolation happens at `tools/call`, not here.
 */
export function buildToolList() {
  return AGENT_TOOLS
    .map(openaiToMcpTool)
    .filter((t) => t && !SKIP_TOOLS.has(t.name));
}
