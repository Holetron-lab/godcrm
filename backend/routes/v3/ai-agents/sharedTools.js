/**
 * Shared tool-related utilities for AI agents routes.
 * Extracted from shared.js for modular organization.
 */

import { dbAll } from '../../../database/connection.js';
import { AGENT_TOOLS } from '../../../services/AgentToolsService.js';
import { apiLogger } from '../../../utils/logger.js';
import { safeParseJSON, normalizeToolList } from './shared.js';

export async function resolveAiToolsTableId(spaceId) {
  const { dbGet } = await import('../../../database/connection.js');

  if (spaceId) {
    const table = await dbGet(`
      SELECT ut.id
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ? AND (ut.name = 'AI Tools' OR ut.name = 'ai_tools')
      LIMIT 1
    `, [spaceId]);
    if (table?.id) {
      return table.id;
    }
  }

  const fallback = await dbGet(`
    SELECT ut.id
    FROM universal_tables ut
    WHERE ut.name = 'AI Tools' OR ut.name = 'ai_tools'
    ORDER BY ut.id ASC
    LIMIT 1
  `);
  return fallback?.id || null;
}

export async function resolveToolNames(agentConfig, spaceId) {
  const toolEntries = normalizeToolList(agentConfig?.tools);
  if (!toolEntries.length) {
    return [];
  }

  const names = new Set();
  const ids = [];

  toolEntries.forEach((entry) => {
    if (entry == null) {
      return;
    }
    if (typeof entry === 'number') {
      ids.push(entry);
      return;
    }
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (!trimmed) {
        return;
      }
      if (/^\d+$/.test(trimmed)) {
        ids.push(Number(trimmed));
        return;
      }
      names.add(trimmed);
    }
  });

  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');

    const rows = await dbAll(
      `SELECT tr.id, tr.data
       FROM table_rows tr
       JOIN universal_tables ut ON tr.table_id = ut.id
       WHERE (ut.name LIKE '%Tools%' OR ut.name LIKE '%tools%')
         AND tr.id IN (${placeholders})`,
      ids
    );

    rows.forEach((row) => {
      try {
        const data = safeParseJSON(row.data, {});
        const toolName = data?.name || data?.tool_name || data?.function_name;
        if (toolName) {
          names.add(toolName);
        }
      } catch {
        // ignore malformed tool row
      }
    });

    if (ids.length > 0 && names.size === 0) {
      apiLogger.warn({ ids, spaceId }, 'Could not resolve tool IDs to names');
    }
  }

  return Array.from(names).filter(Boolean);
}

export async function getAllowedTools(agentConfig, spaceId) {
  const toolNames = await resolveToolNames(agentConfig, spaceId);

  const baseConsultingTools = [
    'get_workspace_info',
    'query_table_data',
    'get_table_schema',
    'list_tables',
    'analyze_table_data'
  ];

  let tools;
  if (!toolNames.length) {
    tools = [...AGENT_TOOLS];
  } else {
    const allToolNames = new Set([...toolNames, ...baseConsultingTools]);
    const filtered = AGENT_TOOLS.filter((tool) => tool?.function?.name && allToolNames.has(tool.function.name));
    tools = filtered.length ? filtered : [...AGENT_TOOLS];
  }

  // ADR-113: Inject manage_plan tool when planning is enabled
  const planningConfig = typeof agentConfig?.planning === 'object' && agentConfig.planning !== null
    ? agentConfig.planning
    : {};
  if (planningConfig.enabled) {
    const maxTasks = Number(planningConfig.max_tasks) > 0 ? Number(planningConfig.max_tasks) : 20;
    const threshold = Number(planningConfig.auto_plan_threshold) > 0
      ? Number(planningConfig.auto_plan_threshold)
      : 3;
    tools.push({
      type: 'function',
      function: {
        name: 'manage_plan',
        description: `Create or update a plan for the current conversation. Use this when a task requires ${threshold}+ steps. Maximum ${maxTasks} tasks per plan.`,
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'update_task', 'add_task', 'remove_task'],
              description: 'Action to perform on the plan'
            },
            tasks: {
              type: 'array',
              description: 'Array of tasks (for create action). Each task: { id, title, status }',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'number', description: 'Task ID (sequential integer)' },
                  title: { type: 'string', description: 'Short task title' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'], description: 'Task status' },
                  note: { type: 'string', description: 'Optional note (brief completion note or blocker reason)' }
                },
                required: ['id', 'title', 'status']
              }
            },
            task_id: {
              type: 'number',
              description: 'Task ID to update or remove (for update_task/remove_task actions)'
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'blocked'],
              description: 'New status (for update_task action)'
            },
            note: {
              type: 'string',
              description: 'Optional note to attach to the task (for update_task action)'
            },
            title: {
              type: 'string',
              description: 'Task title (for add_task action)'
            }
          },
          required: ['action']
        }
      }
    });
  }

  return tools;
}

/**
 * Auto-inject context into tool arguments
 */
export function injectToolContext(toolName, args, context) {
  const { spaceId, userId } = context;
  const result = { ...args };

  const needsSpaceId = [
    'get_workspace_info',
    'create_dashboard'
  ];

  const canUseSpaceId = [
    'list_tables'
  ];

  if (needsSpaceId.includes(toolName) && !result.space_id && spaceId) {
    result.space_id = spaceId;
  }

  if (canUseSpaceId.includes(toolName) && !result.project_id && !result.space_id && spaceId) {
    result.space_id = spaceId;
  }

  return result;
}

export function toAnthropicTools(tools) {
  return (tools || [])
    .map((tool) => {
      const fn = tool?.function;
      if (!fn?.name) {
        return null;
      }
      return {
        name: fn.name,
        description: fn.description || '',
        input_schema: fn.parameters || { type: 'object', properties: {} }
      };
    })
    .filter(Boolean);
}

export function getAnthropicText(content) {
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === 'text' && item?.text)
      .map((item) => item.text)
      .join('');
  }
  return '';
}

export function truncateArray(value, limit, label) {
  if (!Array.isArray(value) || value.length <= limit) {
    return value;
  }
  const trimmed = value.slice(0, limit);
  trimmed.push({ _truncated: true, total: value.length, label });
  return trimmed;
}

export function sanitizeToolResult(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }
  const cloned = safeParseJSON(JSON.stringify(result));
  if (!cloned || typeof cloned !== 'object') {
    return result;
  }
  if (Array.isArray(cloned.tables)) {
    cloned.tables = truncateArray(cloned.tables, 120, 'tables');
  }
  if (Array.isArray(cloned.rows)) {
    cloned.rows = truncateArray(cloned.rows, 50, 'rows');
  }
  if (Array.isArray(cloned.projects)) {
    cloned.projects = truncateArray(cloned.projects, 50, 'projects');
  }
  if (Array.isArray(cloned.widgets)) {
    cloned.widgets = truncateArray(cloned.widgets, 50, 'widgets');
  }
  return cloned;
}
