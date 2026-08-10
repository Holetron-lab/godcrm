/**
 * Shared utilities, constants, and helper functions for AI agents routes.
 * Extracted from ai-agents.js for modular organization.
 *
 * Re-exports from sharedTools.js and sharedEmbedding.js for backward compatibility.
 */

import { dbGet, dbRun, dbAll, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';

/**
 * Generate unique base_id for rows
 */
export function generateBaseId(prefix = 'row') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Fetch with automatic retry on rate limit (429) errors.
 * Uses retry-after header or exponential backoff.
 */
export async function fetchWithRateRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(2000 * Math.pow(2, attempt), 60000);
      apiLogger.warn({ attempt: attempt + 1, waitMs }, 'Rate limited by API, retrying...');
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }

    return response;
  }
}

/**
 * Max output tokens per model.
 * Used as default when agent config doesn't specify max_tokens.
 * Key: substring match against model ID.
 */
export const MODEL_MAX_OUTPUT_TOKENS = {
  // Anthropic Claude 4.5
  'claude-opus-4-5':   16384,
  'claude-sonnet-4-5': 16384,
  'claude-haiku-4-5':  8192,
  // Anthropic Claude 4
  'claude-opus-4-1':   32768,
  'claude-opus-4':     32768,
  'claude-sonnet-4':   16384,
  // Anthropic Claude 3.5
  'claude-3-5-sonnet': 8192,
  'claude-3-5-haiku':  8192,
  // Anthropic Claude 3
  'claude-3-opus':     4096,
  'claude-3-sonnet':   4096,
  'claude-3-haiku':    4096,
  // OpenAI
  'gpt-4o':            16384,
  'gpt-4-turbo':       4096,
  'gpt-4':             8192,
  'gpt-3.5-turbo':     4096,
  'chatgpt-4o':        16384,
  'o1':                100000,
  'o3':                100000,
  // Google
  'gemini-2':          8192,
  'gemini-1.5':        8192,
  // Groq / Llama
  'llama':             32768,
};

/**
 * Get max output tokens for a model.
 * Checks agentConfig.max_tokens first, then model lookup, then default 4096.
 */
export function getMaxOutputTokens(modelId, agentConfig = {}) {
  if (Number(agentConfig.max_tokens) > 0) {
    return Number(agentConfig.max_tokens);
  }
  if (modelId) {
    const id = modelId.toLowerCase();
    const sortedKeys = Object.keys(MODEL_MAX_OUTPUT_TOKENS).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (id.includes(key)) {
        return MODEL_MAX_OUTPUT_TOKENS[key];
      }
    }
  }
  return 8192; // safe default
}

export function getConversationMessages(data) {
  if (!data || typeof data !== 'object') {
    return [];
  }
  if (Array.isArray(data.messages)) {
    return data.messages;
  }
  if (Array.isArray(data.content)) {
    return data.content;
  }
  return [];
}

export function normalizeToolList(toolsValue) {
  if (!toolsValue) {
    return [];
  }
  if (Array.isArray(toolsValue)) {
    return toolsValue;
  }
  if (typeof toolsValue === 'string') {
    const trimmed = toolsValue.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = safeParseJSON(trimmed, {});
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // fallback to comma-separated list
    }
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Safe JSON parse - handles already-parsed objects and invalid JSON
 * Returns fallback for invalid data instead of throwing
 */
export function safeParseJSON(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '[object Object]' || trimmed === 'undefined' || trimmed === 'null') {
      return fallback;
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      apiLogger.warn({ value: trimmed.substring(0, 100) }, 'Failed to parse JSON, using fallback');
      return fallback;
    }
  }
  return fallback;
}

/**
 * ADR-110: Deep merge for context_settings JSON.
 */
export function deepMergeContextSettings(existing, incoming) {
  const merged = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (
      key === 'context_levels' &&
      typeof incoming[key] === 'object' && incoming[key] !== null &&
      typeof merged[key] === 'object' && merged[key] !== null
    ) {
      merged[key] = { ...merged[key], ...incoming[key] };
    } else {
      merged[key] = incoming[key];
    }
  }
  return merged;
}

/**
 * Save a step message to the conversation during agent processing.
 */
export async function saveStepMessage(conversationId, opts) {
  const {
    content = '',
    contentType = 'text',
    role = 'assistant',
    senderType = 'agent',
    agentId = null,
    modelUsed = null,
    tokensIn = null,
    tokensOut = null,
    latencyMs = null,
    toolResults = null,
    senderId = null
  } = opts;

  const toolResultsJson = toolResults ? JSON.stringify(toolResults) : null;

  const result = await dbRun(
    isPostgres()
      ? `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, model_used, tokens_in, tokens_out, latency_ms, tool_results, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`
      : `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, model_used, tokens_in, tokens_out, latency_ms, tool_results, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [conversationId, senderId, senderType, role, content, contentType, agentId, modelUsed, tokensIn, tokensOut, latencyMs, toolResultsJson]
  );

  await dbRun(
    isPostgres()
      ? 'UPDATE conversations SET updated_at = NOW() WHERE id = $1'
      : `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
    [conversationId]
  );

  return result.lastInsertRowid;
}

/**
 * Set conversation processing flag (is_processing = 0 or 1)
 * ADR-093 Task 8: Also sets/clears processing_agent_id and processing_agent_name.
 */
export async function setConversationProcessing(conversationId, isProcessing, agentInfo = {}) {
  const { agentId = null, agentName = null } = agentInfo;
  if (isProcessing) {
    await dbRun(
      isPostgres()
        ? `UPDATE conversations SET is_processing = true, processing_started_at = NOW(), processing_agent_id = $2, processing_agent_name = $3, updated_at = NOW() WHERE id = $1`
        : `UPDATE conversations SET is_processing = 1, processing_started_at = datetime('now'), processing_agent_id = ?, processing_agent_name = ?, updated_at = datetime('now') WHERE id = ?`,
      isPostgres() ? [conversationId, agentId, agentName] : [agentId, agentName, conversationId]
    );
  } else {
    await dbRun(
      isPostgres()
        ? `UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE id = $1`
        : `UPDATE conversations SET is_processing = 0, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = datetime('now') WHERE id = ?`,
      [conversationId]
    );
  }
}

export async function resolveConversationsTableId({ spaceId, agentId }) {
  const requestedSpaceId = spaceId ? Number(spaceId) : null;
  let resolvedSpaceId = null;
  let tableId = null;

  if (agentId) {
    const agentRow = await dbGet(`
      SELECT tr.data, p.space_id
      FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      JOIN projects p ON ut.project_id = p.id
      WHERE tr.id = ?
    `, [agentId]);
    if (agentRow) {
      const agentData = safeParseJSON(agentRow.data, {});
      const candidate = agentData?.tables_config?.conversations_table_id;
      if (candidate) {
        tableId = Number(candidate);
      }
      if (!resolvedSpaceId && agentRow.space_id) {
        resolvedSpaceId = Number(agentRow.space_id);
      }
    }
  }

  if (!tableId && requestedSpaceId) {
    const table = await dbGet(`
      SELECT ut.id
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ? AND (
        ut.name = 'AI Chat History' OR ut.name LIKE '%Conversations%'
      )
      ORDER BY CASE WHEN ut.name = 'AI Chat History' THEN 1 ELSE 2 END
      LIMIT 1
    `, [requestedSpaceId]);
    tableId = table?.id || null;
    if (tableId) {
      resolvedSpaceId = requestedSpaceId;
    }
  }

  if (!tableId) {
    const table = await dbGet(`
      SELECT ut.id
      FROM universal_tables ut
      WHERE ut.name = 'AI Chat History' OR ut.name LIKE '%Conversations%'
      ORDER BY CASE WHEN ut.name = 'AI Chat History' THEN 1 ELSE 2 END
      LIMIT 1
    `);
    tableId = table?.id || null;
  }

  return { tableId, resolvedSpaceId };
}

/**
 * Resolve relation column values for agent config.
 */
export async function resolveAgentRelations(agentConfig, tableId) {
  if (!tableId) return agentConfig;

  try {
    const columns = await dbAll(
      'SELECT id, column_name, config FROM table_columns WHERE table_id = ?',
      [tableId]
    );

    for (const col of columns) {
      const colConfig = safeParseJSON(col.config, {});
      if (!colConfig.relation?.enabled) continue;

      const colValue = agentConfig[String(col.id)];
      if (!colValue) continue;

      const rowId = parseInt(colValue, 10);
      if (isNaN(rowId)) continue;

      if (col.column_name === 'operator_id') {
        agentConfig.operator_id = rowId;
      } else if (col.column_name === 'model') {
        agentConfig.model = rowId;
      }
    }
  } catch (err) {
    apiLogger.warn({ err, tableId }, 'Failed to resolve agent relations');
  }

  return agentConfig;
}

/**
 * Parse @mentions from message content
 */
export function parseMentions(content) {
  if (!content || typeof content !== 'string') return [];
  const mentionPattern = /@([a-z0-9_-]+)/gi;
  const matches = content.match(mentionPattern) || [];
  return matches.map(m => m.substring(1).toLowerCase());
}
