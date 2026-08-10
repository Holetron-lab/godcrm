/**
 * EmbeddingService — Shared embedding generation and vector search
 * ADR-110 AC9-AC10: Vector embedding for conversation summaries
 *
 * Extracted from ai-agents.js vector endpoints for reuse across services.
 * Uses OpenAI-compatible embedding API.
 */

import { dbGet, isPostgres } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { getSecret } from './secrets/getSecret.js';

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/**
 * Resolve embedding API configuration.
 * Fallback chain: env OPENAI_API_KEY → AI API Keys table → null
 *
 * @param {number|null} spaceId - Optional space ID for space-specific key resolution
 * @returns {Promise<{apiKey: string|null, model: string, baseUrl: string}>}
 */
export async function resolveEmbeddingConfig(spaceId = null) {
  let apiKey = null;
  let model = DEFAULT_EMBEDDING_MODEL;
  let baseUrl = 'https://api.openai.com/v1';

  // 1. Try vault first (ADR-0040 — was process.env.OPENAI_API_KEY)
  apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
  if (apiKey) {
    return { apiKey, model, baseUrl };
  }

  // 2. Try AI API Keys table
  try {
    const keyRow = await dbGet(
      isPostgres()
        ? `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE ut.name LIKE '%API Keys%'
             AND tr.data->>'status' = 'active'
             AND (tr.data->>'name' ILIKE '%openai%' OR tr.data->>'name' ILIKE '%embedding%')
           ORDER BY tr.created_at DESC LIMIT 1`
        : `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE ut.name LIKE '%API Keys%'
             AND json_extract(tr.data, '$.status') = 'active'
             AND (json_extract(tr.data, '$.name') LIKE '%OpenAI%' OR json_extract(tr.data, '$.name') LIKE '%Embedding%')
           ORDER BY tr.created_at DESC LIMIT 1`,
      []
    );

    if (keyRow) {
      const keyData = typeof keyRow.data === 'string' ? JSON.parse(keyRow.data) : keyRow.data;
      if (keyData?.api_key) {
        apiKey = keyData.api_key;
        baseUrl = keyData.base_url || baseUrl;
      }
    }
  } catch (err) {
    apiLogger.warn({ err: err.message }, 'EmbeddingService: Failed to resolve API key from table');
  }

  return { apiKey, model, baseUrl };
}

/**
 * Generate embedding vector for text using OpenAI-compatible API
 *
 * @param {string} text - Text to embed
 * @param {string} apiKey - OpenAI API key
 * @param {string} model - Embedding model name
 * @param {string} baseUrl - API base URL
 * @returns {Promise<number[]>} Embedding vector
 */
export async function generateEmbedding(text, apiKey, model = DEFAULT_EMBEDDING_MODEL, baseUrl = 'https://api.openai.com/v1') {
  if (!apiKey) {
    throw new Error('No API key configured for embedding generation');
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text is required for embedding generation');
  }

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: text.slice(0, 8000) // Limit input to avoid token overflow
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    apiLogger.error({ err: errorText, context: 'EmbeddingService' }, 'Embedding API error');
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const result = await response.json();
  return result.data[0].embedding;
}

/**
 * Compute cosine similarity between two vectors
 *
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Cosine similarity (0 to 1)
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return normA && normB ? dotProduct / (normA * normB) : 0;
}

/**
 * Embed text and return structured result
 *
 * @param {string} text - Text to embed
 * @param {number|null} spaceId - Optional space ID
 * @returns {Promise<{embedding: number[], model: string, dimensions: number}|null>}
 */
export async function embedText(text, spaceId = null) {
  try {
    const config = await resolveEmbeddingConfig(spaceId);
    if (!config.apiKey) {
      apiLogger.warn({ context: 'EmbeddingService' }, 'No API key available for embedding');
      return null;
    }

    const embedding = await generateEmbedding(text, config.apiKey, config.model, config.baseUrl);
    return {
      embedding,
      model: config.model,
      dimensions: embedding.length
    };
  } catch (err) {
    apiLogger.error({ err: err.message, context: 'EmbeddingService' }, 'Failed to generate embedding');
    return null;
  }
}

export default {
  resolveEmbeddingConfig,
  generateEmbedding,
  cosineSimilarity,
  embedText,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS
};
