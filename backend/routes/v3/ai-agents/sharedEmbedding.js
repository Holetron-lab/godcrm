/**
 * Shared embedding/vector utilities for AI agents routes.
 * Extracted from shared.js for modular organization.
 */

import { dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { getSecret } from '../../../services/secrets/getSecret.js';
import { safeParseJSON, resolveAgentRelations } from './shared.js';

/**
 * Default embedding model configuration
 */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/**
 * Resolve API key and model for embedding generation
 */
export async function resolveEmbeddingConfig(agentId, spaceId) {
  let apiKey = null;
  let model = DEFAULT_EMBEDDING_MODEL;
  let baseUrl = 'https://api.openai.com/v1';
  let agentName = 'System Default';

  // 1. Try to use specific agent if provided
  if (agentId) {
    const agentRow = await dbGet(`
      SELECT tr.data, tr.table_id, ut.project_id, p.space_id
      FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      JOIN projects p ON ut.project_id = p.id
      WHERE tr.id = ? AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%')
    `, [agentId]);

    if (agentRow) {
      const agentConfig = safeParseJSON(agentRow.data, {});
      await resolveAgentRelations(agentConfig, agentRow.table_id);
      agentName = agentConfig.name || 'Custom Agent';
      model = agentConfig.model || model;

      if (agentConfig.operator_id) {
        const operatorRow = await dbGet(`
          SELECT tr.data
          FROM table_rows tr
          JOIN universal_tables ut ON tr.table_id = ut.id
          WHERE tr.id = ? AND ut.name LIKE '%Operators%'
        `, [agentConfig.operator_id]);

        if (operatorRow) {
          const operatorData = safeParseJSON(operatorRow.data, {});
          if (operatorData.api_key) {
            apiKey = operatorData.api_key;
            baseUrl = operatorData.base_url || baseUrl;
          }
        }
      }
    }
  }

  // 2. Try to find default embedding agent in space
  if (!apiKey && spaceId) {
    const embeddingAgent = await dbGet(
      isPostgres()
        ? `SELECT tr.id, tr.data, tr.table_id
           FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           JOIN projects p ON ut.project_id = p.id
           WHERE p.space_id = $1
             AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%')
             AND (
               tr.data->>'agent_type' = 'embedding'
               OR tr.data->>'name' LIKE '%Embedding%'
             )
             AND (
               tr.data->>'is_active' = '1'
               OR tr.data->>'is_active' = 'true'
               OR tr.data->>'status' = 'active'
             )
           ORDER BY tr.created_at ASC
           LIMIT 1`
        : `SELECT tr.id, tr.data, tr.table_id
           FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           JOIN projects p ON ut.project_id = p.id
           WHERE p.space_id = ?
             AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%')
             AND (
               json_extract(tr.data, '$.agent_type') = 'embedding'
               OR json_extract(tr.data, '$.name') LIKE '%Embedding%'
             )
             AND (
               json_extract(tr.data, '$.is_active') = '1'
               OR json_extract(tr.data, '$.is_active') = 'true'
               OR json_extract(tr.data, '$.status') = 'active'
             )
           ORDER BY tr.created_at ASC
           LIMIT 1`,
      [spaceId]);

    if (embeddingAgent) {
      const agentConfig = safeParseJSON(embeddingAgent.data, {});
      await resolveAgentRelations(agentConfig, embeddingAgent.table_id);
      agentName = agentConfig.name || 'Embedding Agent';
      model = agentConfig.model || model;

      if (agentConfig.operator_id) {
        const operatorRow = await dbGet(`
          SELECT tr.data
          FROM table_rows tr
          JOIN universal_tables ut ON tr.table_id = ut.id
          WHERE tr.id = ? AND ut.name LIKE '%Operators%'
        `, [agentConfig.operator_id]);

        if (operatorRow) {
          const operatorData = safeParseJSON(operatorRow.data, {});
          if (operatorData.api_key) {
            apiKey = operatorData.api_key;
            baseUrl = operatorData.base_url || baseUrl;
          }
        }
      }
    }
  }

  // 3. Fallback to AI API Keys table
  if (!apiKey) {
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
      const keyData = safeParseJSON(keyRow.data, {});
      if (keyData.api_key) {
        apiKey = keyData.api_key;
        agentName = 'AI API Keys Fallback';
        apiLogger.debug({ context: 'Vector' }, 'Using API key from AI API Keys table');
      }
    }
  }

  // 4. Fallback to vault (ADR-0040 — was process.env.OPENAI_API_KEY)
  if (!apiKey) {
    apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
    agentName = 'Vault Fallback';
    apiLogger.debug({ context: 'Vector' }, 'Using vault fallback (openai_api_key)');
  }

  return { apiKey, model, baseUrl, agentName };
}

/**
 * Generate embedding using OpenAI API
 */
export async function generateEmbedding(text, apiKey, model = DEFAULT_EMBEDDING_MODEL, baseUrl = 'https://api.openai.com/v1') {
  if (!apiKey) {
    throw new Error('No API key configured for embedding generation');
  }

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      input: text
    })
  });

  if (!response.ok) {
    const error = await response.text();
    apiLogger.error({ err: error, context: 'Vector' }, 'OpenAI API error');
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const result = await response.json();
  return result.data[0].embedding;
}

/**
 * Apply formula template to row data
 */
export function applyFormula(formula, rowData) {
  if (!formula) return '';

  return formula.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = rowData[key];
    return value != null ? String(value) : '';
  });
}
