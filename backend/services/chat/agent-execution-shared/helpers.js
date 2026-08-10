/**
 * ADR-093/110/113: Shared helpers, constants, and formatting utilities
 * for agent execution services.
 *
 * Extracted from agent-execution-shared.js
 */

// ─── CONSTANTS ────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY = 50;

/** @type {import('../types').ContextLevelsDefaults} */
const CONTEXT_LEVELS_DEFAULTS = {
  thinking: false,
  thinking_preview_chars: 200,
  tool_summaries: false,
  tool_preview_chars: 100,
  full_tool_results: false,
};

/** Content types always included in history (Level 1) */
const BASE_CONTENT_TYPES = ['text', 'markdown', 'code', 'plan', 'moved'];

// ─── HELPERS ──────────────────────────────────────────────────

/**
 * Safe JSON parse (handles both string and object input)
 */
function safeParse(val, fallback = {}) {
  if (typeof val === 'object' && val !== null) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return fallback;
}

/**
 * Parse context_settings from agent config.
 * Handles string, object, and nested formats.
 */
function parseContextSettings(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  return safeParse(raw, {});
}

/**
 * Determine max history messages to include.
 * Priority: agentConfig.max_history -> agentConfig.history_limit
 *         -> context_settings.max_history -> context_settings.history_limit
 *         -> DEFAULT_MAX_HISTORY (50)
 */
function getHistoryLimit(agentConfig) {
  const contextSettings = parseContextSettings(agentConfig?.context_settings || agentConfig?.context);
  const rawLimit = agentConfig?.max_history
    ?? agentConfig?.history_limit
    ?? contextSettings?.max_history
    ?? contextSettings?.history_limit
    ?? contextSettings?.historyLimit
    ?? contextSettings?.last_messages;
  const limit = Number(rawLimit);
  if (Number.isFinite(limit) && limit > 0) {
    return Math.floor(limit);
  }
  return DEFAULT_MAX_HISTORY;
}

/**
 * ADR-110: Resolve context_levels from agent config, applying defaults.
 * @param {Object} agentConfig - Agent configuration
 * @returns {Object} Merged context levels with defaults applied
 */
function resolveContextLevels(agentConfig) {
  const contextSettings = parseContextSettings(agentConfig?.context_settings || agentConfig?.context);
  const raw = contextSettings?.context_levels;
  if (!raw || typeof raw !== 'object') {
    return { ...CONTEXT_LEVELS_DEFAULTS };
  }
  return { ...CONTEXT_LEVELS_DEFAULTS, ...raw };
}

/**
 * ADR-110: Build the list of content_type values for the SQL IN clause.
 * Level 1 (default): text, markdown, code
 * Level 2: + thinking
 * Level 3/4: + tool_call, tool_result
 *
 * @param {Object} contextLevels - Resolved context levels
 * @returns {string[]} Array of content_type strings
 */
function buildContentTypes(contextLevels) {
  const types = [...BASE_CONTENT_TYPES];
  if (contextLevels.thinking) {
    types.push('thinking');
  }
  if (contextLevels.tool_summaries || contextLevels.full_tool_results) {
    types.push('tool_call', 'tool_result');
  }
  return types;
}

/**
 * ADR-110: Extract tool name from a message's tool_results JSON or content.
 * @param {Object} message - DB message row
 * @returns {string} Tool name or 'unknown'
 */
function extractToolName(message) {
  if (message.tool_results) {
    const toolData = safeParse(message.tool_results, {});
    if (toolData.tool) return toolData.tool;
    if (toolData.name) return toolData.name;
  }
  // Fallback: try parsing content for tool name patterns
  if (message.content && message.content_type === 'tool_call') {
    // Content may be the tool name directly or JSON with tool info
    const parsed = safeParse(message.content, null);
    if (parsed && parsed.tool) return parsed.tool;
    if (parsed && parsed.name) return parsed.name;
    // If content is just the tool name string
    if (typeof message.content === 'string' && message.content.length < 100 && !message.content.includes(' ')) {
      return message.content;
    }
  }
  return 'unknown';
}

/**
 * ADR-110: Extract truncated tool arguments from a message.
 * @param {Object} message - DB message row
 * @param {number} maxLen - Maximum length for argument preview
 * @returns {string} Truncated args string
 */
function extractToolArgs(message, maxLen = 100) {
  if (message.tool_results) {
    const toolData = safeParse(message.tool_results, {});
    if (toolData.args) {
      const argsStr = typeof toolData.args === 'string'
        ? toolData.args
        : JSON.stringify(toolData.args);
      return argsStr.length > maxLen ? argsStr.substring(0, maxLen) + '...' : argsStr;
    }
  }
  return '';
}

/**
 * ADR-113: Format a plan message content (JSON with tasks array) into a compact
 * Markdown checklist for injection into agent context.
 *
 * @param {string} content - JSON string with { tasks: [...] }
 * @returns {string} Formatted checklist
 */
function formatPlanAsChecklist(content) {
  const parsed = safeParse(content, null);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return content || '';
  }

  const statusIcons = {
    completed: '[x]',
    in_progress: '[→]',
    pending: '[ ]',
    blocked: '[!]',
  };

  const lines = parsed.tasks.map(task => {
    const icon = statusIcons[task.status] || '[ ]';
    let line = `- ${icon} ${task.id}. ${task.title}`;
    if (task.note) {
      line += ` (${task.note})`;
    } else if (task.status === 'completed') {
      line += ' (done)';
    } else if (task.status === 'in_progress') {
      line += ' (in progress)';
    } else if (task.status === 'blocked') {
      line += ' (blocked)';
    }
    return line;
  });

  const completed = parsed.tasks.filter(t => t.status === 'completed').length;
  const total = parsed.tasks.length;

  return `## Current Plan (${completed}/${total})\n${lines.join('\n')}`;
}

/**
 * ADR-110: Format a message according to its content_type and context level settings.
 *
 * @param {Object} message - DB message row
 * @param {Object} contextLevels - Resolved context levels
 * @returns {string} Formatted content string
 */
function formatMessageByLevel(message, contextLevels) {
  const { content_type, content, id } = message;

  switch (content_type) {
    case 'thinking': {
      const limit = contextLevels.thinking_preview_chars || CONTEXT_LEVELS_DEFAULTS.thinking_preview_chars;
      const truncated = content && content.length > limit
        ? content.substring(0, limit) + '...'
        : (content || '');
      return `[Thinking step_id=${id}]: ${truncated}`;
    }

    case 'tool_call': {
      const toolName = extractToolName(message);
      const args = extractToolArgs(message, contextLevels.tool_preview_chars || CONTEXT_LEVELS_DEFAULTS.tool_preview_chars);
      return `[Tool Call step_id=${id}]: ${toolName}(${args})`;
    }

    case 'tool_result': {
      const toolName = extractToolName(message);
      if (contextLevels.full_tool_results) {
        return `[Tool Result step_id=${id} tool=${toolName}]: ${content || ''}`;
      }
      // tool_summaries mode: truncate
      const limit = contextLevels.tool_preview_chars || CONTEXT_LEVELS_DEFAULTS.tool_preview_chars;
      const preview = content && content.length > limit
        ? content.substring(0, limit) + '...'
        : (content || '');
      return `[Tool Result step_id=${id} tool=${toolName}]: ${preview}`;
    }

    case 'plan': {
      // ADR-113: Format plan as compact checklist for context injection
      return formatPlanAsChecklist(content);
    }

    case 'moved': {
      // ADR-0031 P5: stub-pointer to a continuation in another chat. The agent
      // gets a one-line breadcrumb instead of the original content so it can
      // recognize that the discussion continues elsewhere without re-reading it.
      const meta = safeParse(message.metadata, {});
      const movedTo = meta?.moved_to;
      const targetConv = movedTo?.conversation_id;
      if (targetConv) {
        return `[Moved to chat #${targetConv} — see metadata.moved_to.conversation_id for context]`;
      }
      return `[Moved to another chat]`;
    }

    default:
      return content || '';
  }
}

/**
 * ADR-113: Format plan data as compact checklist for agent context injection.
 *
 * @param {object} planData - { tasks: [...] }
 * @returns {string} Formatted checklist string, or empty string if no tasks
 */
function formatPlanAsContext(planData) {
  if (!planData?.tasks?.length) return '';

  const statusIcons = {
    completed: '[x]',
    in_progress: '[→]',
    pending: '[ ]',
    blocked: '[!]',
  };

  const lines = planData.tasks.map(task => {
    const icon = statusIcons[task.status] || '[ ]';
    const note = task.note ? ` (${task.note})` : '';
    return `- ${icon} ${task.id}. ${task.title}${note}`;
  });

  const completed = planData.tasks.filter(t => t.status === 'completed').length;
  const total = planData.tasks.length;

  return `## Current Plan (${completed}/${total} complete)\n${lines.join('\n')}`;
}

export {
  DEFAULT_MAX_HISTORY,
  CONTEXT_LEVELS_DEFAULTS,
  BASE_CONTENT_TYPES,
  safeParse,
  parseContextSettings,
  getHistoryLimit,
  resolveContextLevels,
  buildContentTypes,
  extractToolName,
  extractToolArgs,
  formatPlanAsChecklist,
  formatMessageByLevel,
  formatPlanAsContext,
};
