/**
 * agent-loop/tools.js — Tool conversion, resolution, and context injection
 *
 * Extracted from AgentLoopService.js (ADR-094).
 */

import { AGENT_TOOLS } from '../AgentToolsService.js';

/**
 * Convert OpenAI-format tools to Anthropic tool format.
 * @param {Array} tools - OpenAI-format tool definitions
 * @returns {Array} Anthropic-format tool definitions
 */
export function toAnthropicTools(tools) {
  return (tools || [])
    .map((tool) => {
      const fn = tool?.function;
      if (!fn?.name) return null;
      return {
        name: fn.name,
        description: fn.description || '',
        input_schema: fn.parameters || { type: 'object', properties: {} }
      };
    })
    .filter(Boolean);
}

/**
 * Auto-inject context into tool arguments (space_id, etc.).
 * @param {string} toolName
 * @param {Object} args
 * @param {Object} context - { spaceId, userId }
 * @returns {Object} Enriched args
 */
export function injectToolContext(toolName, args, context) {
  const { spaceId, userId } = context;
  const result = { ...args };
  const needsSpaceId = ['get_workspace_info', 'create_dashboard'];
  const canUseSpaceId = ['list_tables'];
  if (needsSpaceId.includes(toolName) && !result.space_id && spaceId) {
    result.space_id = spaceId;
  }
  if (canUseSpaceId.includes(toolName) && !result.project_id && !result.space_id && spaceId) {
    result.space_id = spaceId;
  }
  return result;
}

/**
 * Resolve allowed tools for an agent config.
 * @param {Object} agentConfig
 * @param {number|null} spaceId
 * @returns {Promise<Array>} Filtered AGENT_TOOLS
 */
export async function resolveAllowedTools(agentConfig, spaceId) {
  let toolNames = [];
  const toolsValue = agentConfig.tools || agentConfig.allowed_tools;
  if (toolsValue) {
    if (Array.isArray(toolsValue)) {
      toolNames = toolsValue;
    } else if (typeof toolsValue === 'string') {
      try {
        const parsed = JSON.parse(toolsValue);
        toolNames = Array.isArray(parsed) ? parsed : [];
      } catch {
        toolNames = toolsValue.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
  }

  const baseConsultingTools = [
    'get_workspace_info', 'query_table_data', 'get_table_schema',
    'list_tables', 'analyze_table_data'
  ];

  if (!toolNames.length) return AGENT_TOOLS;

  const allToolNames = new Set([...toolNames, ...baseConsultingTools]);
  const filtered = AGENT_TOOLS.filter(t => t?.function?.name && allToolNames.has(t.function.name));
  return filtered.length ? filtered : AGENT_TOOLS;
}
