/**
 * Chat Chunking Service
 * ADR-024: Unified Message Storage + AI Summaries
 * ADR-110: Hierarchical Smart Context — Auto-Summary + Vector Memory
 *
 * Implements message chunking and summarization for infinite chat.
 * Uses `messages` table and `conversation_summaries` table (NOT table_rows JSON).
 *
 * Config:
 * - CHUNK_SIZE: 10 (messages per chunk, overridable per-agent via auto_summary.chunk_size)
 * - KEEP_RECENT_MESSAGES: 5 (always keep in full context, overridable via auto_summary.keep_recent)
 */

import { dbAll, dbGet, dbRun, isPostgres } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { embedText, cosineSimilarity } from './EmbeddingService.js';

export const CHUNK_SIZE = 10;
export const KEEP_RECENT_MESSAGES = 5;

/**
 * Parse auto_summary settings from agent config with defaults.
 * Supports `agent` field (agent row ID) — model is resolved at call time via resolveAutoSummaryModel().
 * @param {Object} agentConfig - Agent configuration
 * @returns {{ enabled: boolean, chunk_size: number, keep_recent: number, model: string, agent: number|null, inject_in_system: boolean }}
 */
export function parseAutoSummarySettings(agentConfig) {
  const contextSettings = typeof agentConfig?.context_settings === 'string'
    ? JSON.parse(agentConfig.context_settings || '{}')
    : (agentConfig?.context_settings || {});

  const raw = contextSettings?.auto_summary || {};
  return {
    enabled: raw.enabled === true,
    chunk_size: Number(raw.chunk_size) || CHUNK_SIZE,
    keep_recent: Number(raw.keep_recent) || KEEP_RECENT_MESSAGES,
    model: raw.model || 'gpt-4o-mini',
    agent: raw.agent ? Number(raw.agent) : null,
    inject_in_system: raw.inject_in_system === true,
  };
}

/**
 * Resolve auto_summary model: if `agent` is set, look up the agent's model from DB.
 * Falls back to the static `model` field if agent lookup fails.
 * @param {Object} summarySettings - Parsed auto_summary settings
 * @returns {Promise<string>} - Resolved model ID string
 */
export async function resolveAutoSummaryModel(summarySettings) {
  if (!summarySettings.agent) {
    return summarySettings.model;
  }
  try {
    // Look up agent row → get model row ID → look up model row → get model_id string
    const agentRow = await dbGet(
      isPostgres()
        ? `SELECT data->>'model' as model_ref FROM table_rows WHERE id = $1 AND deleted_at IS NULL`
        : `SELECT json_extract(data, '$.model') as model_ref FROM table_rows WHERE id = ? AND deleted_at IS NULL`,
      [summarySettings.agent]
    );
    if (!agentRow?.model_ref) {
      apiLogger.warn({ agentId: summarySettings.agent }, 'auto_summary: agent has no model, falling back');
      return summarySettings.model;
    }
    // model_ref is a row ID in AI Models table (1787) — resolve to model_id string
    const modelRow = await dbGet(
      isPostgres()
        ? `SELECT data->>'model_id' as model_id FROM table_rows WHERE id = $1 AND deleted_at IS NULL`
        : `SELECT json_extract(data, '$.model_id') as model_id FROM table_rows WHERE id = ? AND deleted_at IS NULL`,
      [Number(agentRow.model_ref)]
    );
    if (!modelRow?.model_id) {
      apiLogger.warn({ modelRef: agentRow.model_ref }, 'auto_summary: model row not found, falling back');
      return summarySettings.model;
    }
    return modelRow.model_id;
  } catch (err) {
    apiLogger.warn({ err: err.message, agentId: summarySettings.agent }, 'auto_summary: agent resolution failed, falling back');
    return summarySettings.model;
  }
}

/**
 * Parse vector_search settings from agent config with defaults
 * @param {Object} agentConfig - Agent configuration
 * @returns {{ enabled: boolean, top_k: number, similarity_threshold: number, embed_model: string }}
 */
export function parseVectorSearchSettings(agentConfig) {
  const contextSettings = typeof agentConfig?.context_settings === 'string'
    ? JSON.parse(agentConfig.context_settings || '{}')
    : (agentConfig?.context_settings || {});

  const raw = contextSettings?.vector_search || {};
  return {
    enabled: raw.enabled === true,
    top_k: Number(raw.top_k) || 3,
    similarity_threshold: Number(raw.similarity_threshold) || 0.7,
    embed_model: raw.embed_model || 'text-embedding-3-small',
  };
}

/**
 * Generate summary prompt for a chunk of messages
 * @param {Array} messages - Messages to summarize
 * @returns {string} Prompt for LLM summarization
 */
export function generateSummaryPrompt(messages) {
  const formattedMessages = messages.map(m => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    return `[${role}]: ${m.content}`;
  }).join('\n');

  return `Summarize the following conversation in 2-3 concise sentences, capturing the main topics discussed, any decisions made, and key information exchanged:

${formattedMessages}

Summary:`;
}

export default {
  CHUNK_SIZE,
  KEEP_RECENT_MESSAGES,
  generateSummaryPrompt,
  parseAutoSummarySettings,
  parseVectorSearchSettings,
  // Primary functions (ADR-024)
  getMessageCount,
  getSummarizedMessageCount,
  shouldCreateSummary,
  createSummary,
  buildAIContext,
  // ADR-110: Vector search
  embedSummary,
  searchSimilarSummaries,
  // ADR-110: Auto-summary trigger
  triggerAutoSummaryIfNeeded,
};

// ============================================================================
// ADR-024: Database-based Chunking Functions
// Uses `messages` table and `conversation_summaries` table
// ============================================================================

/**
 * Get total message count for a conversation
 * @param {number} conversationId - Conversation ID
 * @returns {Promise<number>} - Total message count
 */
export async function getMessageCount(conversationId) {
  const result = await dbGet(
    isPostgres()
      ? 'SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1'
      : 'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
    [conversationId]
  );
  return result?.count || 0;
}

/**
 * Get count of messages that have been summarized
 * @param {number} conversationId - Conversation ID
 * @returns {Promise<number>} - Summarized message count (sum of messages_count from all summaries)
 */
export async function getSummarizedMessageCount(conversationId) {
  const result = await dbGet(
    isPostgres()
      ? 'SELECT COALESCE(SUM(messages_count), 0) as count FROM conversation_summaries WHERE conversation_id = $1'
      : 'SELECT COALESCE(SUM(messages_count), 0) as count FROM conversation_summaries WHERE conversation_id = ?',
    [conversationId]
  );
  return result?.count || 0;
}

/**
 * Check if a new summary should be created
 * Rule: unsummarized = total - summarized - keep_recent
 *       if unsummarized >= chunk_size, create summary
 *
 * @param {number} conversationId - Conversation ID
 * @param {number} chunkSize - Messages per chunk (default CHUNK_SIZE)
 * @param {number} keepRecent - Messages to keep recent (default KEEP_RECENT_MESSAGES)
 * @returns {Promise<boolean>} - True if summarization is needed
 */
export async function shouldCreateSummary(conversationId, chunkSize = CHUNK_SIZE, keepRecent = KEEP_RECENT_MESSAGES) {
  const totalMessages = await getMessageCount(conversationId);
  const summarizedCount = await getSummarizedMessageCount(conversationId);
  const unsummarized = totalMessages - summarizedCount - keepRecent;

  return unsummarized >= chunkSize;
}

/**
 * Create a summary for the oldest unsummarized chunk
 *
 * @param {number} conversationId - Conversation ID
 * @param {Function} summarizeFunc - Async function that generates summary text from messages
 * @param {Object} options - { chunkSize, model }
 * @returns {Promise<Object|null>} - Created summary or null if not needed
 */
export async function createSummary(conversationId, summarizeFunc, options = {}) {
  const chunkSize = options.chunkSize || CHUNK_SIZE;
  const keepRecent = options.keepRecent || KEEP_RECENT_MESSAGES;
  const summaryModel = options.model || 'gpt-4o-mini';

  const needsSummary = await shouldCreateSummary(conversationId, chunkSize, keepRecent);
  if (!needsSummary) {
    return null;
  }

  // Get the last summary to determine next chunk number and start ID
  const lastSummary = await dbGet(
    isPostgres()
      ? 'SELECT * FROM conversation_summaries WHERE conversation_id = $1 ORDER BY chunk_number DESC LIMIT 1'
      : 'SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY chunk_number DESC LIMIT 1',
    [conversationId]
  );

  const nextChunkNumber = lastSummary ? lastSummary.chunk_number + 1 : 1;
  const startFromId = lastSummary ? lastSummary.messages_end_id + 1 : 0;

  // Get messages for this chunk (chunkSize messages starting from startFromId)
  const messages = await dbAll(
    isPostgres()
      ? `SELECT * FROM messages WHERE conversation_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3`
      : `SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
    [conversationId, startFromId, chunkSize]
  );

  if (messages.length === 0) {
    return null;
  }

  // Generate summary using provided function
  const summaryText = await summarizeFunc(messages);

  // Determine message IDs
  const messagesStartId = messages[0].id;
  const messagesEndId = messages[messages.length - 1].id;
  const messagesCount = messages.length;

  // Save to database
  await dbRun(
    isPostgres()
      ? `INSERT INTO conversation_summaries
         (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, summary_model, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`
      : `INSERT INTO conversation_summaries
         (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, summary_model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [conversationId, nextChunkNumber, messagesStartId, messagesEndId, messagesCount, summaryText, summaryModel]
  );

  // Return the saved summary
  const savedSummary = await dbGet(
    isPostgres()
      ? 'SELECT * FROM conversation_summaries WHERE conversation_id = $1 AND chunk_number = $2'
      : 'SELECT * FROM conversation_summaries WHERE conversation_id = ? AND chunk_number = ?',
    [conversationId, nextChunkNumber]
  );

  return savedSummary;
}

/**
 * Build AI context from DB summaries + recent messages
 *
 * @param {number} conversationId - Conversation ID
 * @returns {Promise<Object>} - { summaries: string[], recentMessages: Object[], systemContext: string, ... }
 */
export async function buildAIContext(conversationId) {
  // Get all summaries ordered by chunk number
  const summaryRows = await dbAll(
    isPostgres()
      ? 'SELECT * FROM conversation_summaries WHERE conversation_id = $1 ORDER BY chunk_number ASC'
      : 'SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY chunk_number ASC',
    [conversationId]
  );

  const summaries = summaryRows.map(s => s.summary);
  const summarizedCount = summaryRows.reduce((sum, s) => sum + s.messages_count, 0);

  // Get recent messages (more than KEEP_RECENT to give some context)
  const recentCount = KEEP_RECENT_MESSAGES + CHUNK_SIZE;
  const recentMessages = await dbAll(
    isPostgres()
      ? `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`
      : `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`,
    [conversationId, recentCount]
  );

  // Reverse to chronological order
  recentMessages.reverse();

  // Get total message count
  const totalMessages = await getMessageCount(conversationId);

  // Build system context string
  let systemContext = '';
  if (summaries.length > 0) {
    systemContext = 'Previous conversation summary:\n';
    summaries.forEach((summary, i) => {
      systemContext += `- Chunk ${i + 1}: ${summary}\n`;
    });
    systemContext += '\nRecent messages follow:';
  }

  return {
    summaries,
    recentMessages,
    systemContext,
    totalMessages,
    summarizedMessages: summarizedCount,
    unsummarizedMessages: totalMessages - summarizedCount
  };
}

// ============================================================================
// ADR-110: Vector Embedding for Summaries
// ============================================================================

/**
 * Generate and store embedding for a conversation summary
 * Called after createSummary() as a fire-and-forget operation.
 *
 * @param {number} summaryId - conversation_summaries row ID
 * @param {string} summaryText - Summary text to embed
 * @param {number|null} spaceId - Optional space ID for key resolution
 * @returns {Promise<boolean>} - true if embedding was stored successfully
 */
export async function embedSummary(summaryId, summaryText, spaceId = null) {
  try {
    const result = await embedText(summaryText, spaceId);
    if (!result) {
      apiLogger.debug({ summaryId }, 'ADR-110: No embedding API available, skipping embedding');
      return false;
    }

    await dbRun(
      isPostgres()
        ? `UPDATE conversation_summaries SET embedding = $1, embedding_model = $2 WHERE id = $3`
        : `UPDATE conversation_summaries SET embedding = ?, embedding_model = ? WHERE id = ?`,
      [JSON.stringify(result.embedding), result.model, summaryId]
    );

    apiLogger.info({ summaryId, model: result.model, dims: result.dimensions }, 'ADR-110: Summary embedding stored');
    return true;
  } catch (err) {
    apiLogger.warn({ err: err.message, summaryId }, 'ADR-110: Failed to embed summary (non-fatal)');
    return false;
  }
}

/**
 * Search for the most semantically similar summaries to a query text
 * ADR-110 AC10: Vector search retrieves top-K most relevant summaries
 *
 * @param {number} conversationId - Conversation ID
 * @param {string} queryText - Text to search for
 * @param {Object} options - { top_k, similarity_threshold, spaceId }
 * @returns {Promise<Array<{summary: string, similarity: number, chunk_number: number}>>}
 */
export async function searchSimilarSummaries(conversationId, queryText, options = {}) {
  const topK = options.top_k || 3;
  const threshold = options.similarity_threshold || 0.7;

  try {
    // Generate embedding for query
    const queryResult = await embedText(queryText, options.spaceId);
    if (!queryResult) {
      apiLogger.debug({ conversationId }, 'ADR-110: No embedding API for vector search, returning empty');
      return [];
    }

    // Get all summaries with embeddings
    const summaries = await dbAll(
      isPostgres()
        ? `SELECT id, chunk_number, summary, embedding, embedding_model
           FROM conversation_summaries
           WHERE conversation_id = $1 AND embedding IS NOT NULL
           ORDER BY chunk_number ASC`
        : `SELECT id, chunk_number, summary, embedding, embedding_model
           FROM conversation_summaries
           WHERE conversation_id = ? AND embedding IS NOT NULL
           ORDER BY chunk_number ASC`,
      [conversationId]
    );

    if (summaries.length === 0) return [];

    // Compute cosine similarity for each
    const results = [];
    for (const row of summaries) {
      try {
        const storedEmbedding = typeof row.embedding === 'string'
          ? JSON.parse(row.embedding)
          : row.embedding;

        if (Array.isArray(storedEmbedding)) {
          const similarity = cosineSimilarity(queryResult.embedding, storedEmbedding);
          if (similarity >= threshold) {
            results.push({
              id: row.id,
              chunk_number: row.chunk_number,
              summary: row.summary,
              similarity,
            });
          }
        }
      } catch (parseErr) {
        // Skip rows with invalid embeddings
      }
    }

    // Sort by similarity descending, take top_k
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  } catch (err) {
    apiLogger.warn({ err: err.message, conversationId }, 'ADR-110: Vector search failed (non-fatal)');
    return [];
  }
}

// ============================================================================
// ADR-110: Auto-Summary Trigger
// ============================================================================

/**
 * Trigger auto-summary if agent has it enabled and enough messages accumulated.
 * Fire-and-forget: errors are logged but never thrown to caller.
 *
 * @param {number} conversationId - Conversation ID
 * @param {Object} agentConfig - Agent configuration with context_settings
 * @param {Function} summarizeFunc - Async function (messages) => summary string
 * @param {number|null} spaceId - Optional space ID for embedding key resolution
 * @returns {Promise<Object|null>} - Created summary or null
 */
export async function triggerAutoSummaryIfNeeded(conversationId, agentConfig, summarizeFunc, spaceId = null) {
  try {
    const settings = parseAutoSummarySettings(agentConfig);
    if (!settings.enabled) {
      return null;
    }

    apiLogger.debug({ conversationId, settings }, 'ADR-110: Checking auto-summary trigger');

    // Create summary with agent-specific settings
    const summary = await createSummary(conversationId, summarizeFunc, {
      chunkSize: settings.chunk_size,
      keepRecent: settings.keep_recent,
      model: settings.model,
    });

    if (!summary) {
      return null;
    }

    apiLogger.info(
      { conversationId, chunkNumber: summary.chunk_number, summaryLen: summary.summary?.length },
      'ADR-110: Auto-summary created'
    );

    // Fire-and-forget: generate embedding for the new summary
    embedSummary(summary.id, summary.summary, spaceId).catch(err => {
      apiLogger.warn({ err: err.message, summaryId: summary.id }, 'ADR-110: Background embedding failed');
    });

    return summary;
  } catch (err) {
    apiLogger.error({ err: err.message, conversationId }, 'ADR-110: Auto-summary trigger failed (non-fatal)');
    return null;
  }
}
