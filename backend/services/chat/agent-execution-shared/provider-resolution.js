/**
 * ADR-093: Provider resolution and detection.
 *
 * Extracted from agent-execution-shared.js
 */

import { dbGet, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { getSecret } from '../../secrets/getSecret.js';
import { safeParse } from './helpers.js';

// ─── 1. resolveAgentProvider() ────────────────────────────────

/**
 * ADR-093 Task 1: Unified operator, API key, model, and provider resolution.
 *
 * Resolution chain:
 *   1. Agent's operator_id -> operator row -> api_key + provider
 *   2. Fallback: AI API Keys table for the same operator_id
 *   3. Fallback: Any operator with api_key in the same space
 *   4. Fallback: process.env.OPENAI_API_KEY
 *
 * Model resolution:
 *   1. modelIdOverride (if provided)
 *   2. agentConfig.model (if numeric -> lookup from Models table)
 *   3. operatorData.model or agentConfig.model (string)
 *   4. Default: 'gpt-4o'
 *
 * @param {Object} agentConfig - Agent configuration (from table_rows data)
 * @param {Object} options - { spaceId, modelIdOverride }
 * @returns {Promise<{operatorData: Object|null, apiKey: string|null, model: string, provider: string, isLocal: boolean}>}
 */
export async function resolveAgentProvider(agentConfig, options = {}) {
  const { spaceId = null, modelIdOverride = null } = options;

  let apiKey = null;
  let operatorData = null;

  // Step 1: Resolve operator by operator_id
  if (agentConfig.operator_id) {
    const operatorRow = await dbGet(
      isPostgres()
        ? `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE tr.id = $1 AND ut.name LIKE '%Operators%'`
        : `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE tr.id = ? AND ut.name LIKE '%Operators%'`,
      [agentConfig.operator_id]
    );

    if (operatorRow) {
      operatorData = safeParse(operatorRow.data, {});
      if (operatorData.api_key) {
        apiKey = operatorData.api_key;
      }
    }

    // Step 2: Fallback to AI API Keys table
    if (!apiKey) {
      const keyRow = isPostgres()
        ? await dbGet(`
            SELECT tr.data FROM table_rows tr
            JOIN universal_tables ut ON tr.table_id = ut.id
            WHERE ut.name LIKE '%API Keys%'
              AND tr.data->>'operator_id' = $1
              AND tr.data->>'status' = 'active'
            ORDER BY tr.created_at DESC LIMIT 1
          `, [String(agentConfig.operator_id)])
        : await dbGet(`
            SELECT tr.data FROM table_rows tr
            JOIN universal_tables ut ON tr.table_id = ut.id
            WHERE ut.name LIKE '%API Keys%'
              AND json_extract(tr.data, '$.operator_id') = ?
              AND json_extract(tr.data, '$.status') = 'active'
            ORDER BY tr.created_at DESC LIMIT 1
          `, [String(agentConfig.operator_id)]);

      if (keyRow) {
        const keyData = safeParse(keyRow.data, {});
        apiKey = keyData.api_key;
      }
    }
  }

  // Detect local providers (no API key needed)
  const isLocal = operatorData?.provider === 'claude-code'
    || operatorData?.provider === 'local'
    || operatorData?.is_local === true;

  // Step 3: Fallback — find any operator with api_key in the same space
  if (!isLocal && !apiKey && spaceId) {
    apiLogger.debug({ spaceId }, 'ADR-093: No operator API key, searching space fallback');

    const fallbackOperator = isPostgres()
      ? await dbGet(`
          SELECT tr.data FROM table_rows tr
          JOIN universal_tables ut ON tr.table_id = ut.id
          JOIN projects p ON ut.project_id = p.id
          WHERE p.space_id = $1
            AND ut.name LIKE '%Operators%'
            AND tr.data->>'api_key' IS NOT NULL
            AND tr.data->>'api_key' != ''
          ORDER BY tr.created_at DESC LIMIT 1
        `, [spaceId])
      : await dbGet(`
          SELECT tr.data FROM table_rows tr
          JOIN universal_tables ut ON tr.table_id = ut.id
          JOIN projects p ON ut.project_id = p.id
          WHERE p.space_id = ?
            AND ut.name LIKE '%Operators%'
            AND json_extract(tr.data, '$.api_key') IS NOT NULL
            AND json_extract(tr.data, '$.api_key') != ''
          ORDER BY tr.created_at DESC LIMIT 1
        `, [spaceId]);

    if (fallbackOperator) {
      operatorData = safeParse(fallbackOperator.data, {});
      apiKey = operatorData.api_key;
      apiLogger.debug({ provider: operatorData.provider }, 'ADR-093: Found fallback operator');
    }
  }

  // Step 4: Vault fallback (ADR-0040 — was process.env.OPENAI_API_KEY)
  if (!isLocal && !apiKey) {
    apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
  }

  // ── Model resolution ──

  let modelId = agentConfig.model || 'gpt-4o';
  let providerName = operatorData?.provider || 'openai';

  const rawModel = modelIdOverride || agentConfig.model;
  const modelRowId = rawModel && !isNaN(Number(rawModel)) ? Number(rawModel) : null;

  if (modelRowId) {
    const modelRow = await dbGet(
      isPostgres()
        ? `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE tr.id = $1 AND ut.name LIKE '%Models%'`
        : `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE tr.id = ? AND ut.name LIKE '%Models%'`,
      [modelRowId]
    );

    if (modelRow) {
      const modelData = safeParse(modelRow.data, {});
      modelId = modelData.model_id || modelData.api_id || modelId;
    }
  }

  if (operatorData?.provider) {
    providerName = operatorData.provider.toLowerCase();
  }

  return {
    operatorData,
    apiKey,
    model: modelId,
    provider: providerName,
    isLocal,
  };
}

// ─── 2. detectProvider() ──────────────────────────────────────

/**
 * ADR-093: Detect provider type flags from provider name and model.
 *
 * @param {string} providerName - Provider identifier (e.g. 'openai', 'anthropic', 'claude-code')
 * @param {string} model - Model identifier (e.g. 'claude-sonnet-4', 'gpt-4-turbo')
 * @returns {{ isClaudeCode: boolean, isCopilot: boolean, isAnthropic: boolean }}
 */
export function detectProvider(providerName, model) {
  const isClaudeCode = providerName === 'claude-code';
  const isCopilot = providerName === 'copilot';
  const isAnthropic = !isClaudeCode && !isCopilot
    && (model.includes('claude') || providerName === 'anthropic');

  return { isClaudeCode, isCopilot, isAnthropic };
}
