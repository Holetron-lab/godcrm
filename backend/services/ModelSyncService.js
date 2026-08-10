/**
 * ModelSyncService - Sync AI models from provider APIs to CRM table
 * Fetches available models from each operator's API and upserts into AI Models table
 */

import { dbAll, dbGet, dbRun, isPostgres } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import crypto from 'crypto';

/**
 * Safe JSON parse
 */
function safeParseJSON(str, defaultValue = {}) {
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

// ─── Model name normalization ───────────────────────────────────────

/**
 * Convert model_id to human-readable name
 * @param {string} modelId
 * @returns {string}
 */
export function normalizeModelName(modelId) {
  if (!modelId) return 'Unknown';

  // Known model patterns → human name
  const knownPatterns = [
    // Claude
    { pattern: /^claude-opus-4-6/, name: 'Claude Opus 4.6' },
    { pattern: /^claude-opus-4-5/, name: 'Claude Opus 4.5' },
    { pattern: /^claude-opus-4-1/, name: 'Claude Opus 4.1' },
    { pattern: /^claude-opus-4(?:-20|$)/, name: 'Claude Opus 4' },
    { pattern: /^claude-sonnet-4-5/, name: 'Claude Sonnet 4.5' },
    { pattern: /^claude-sonnet-4(?:-20|$)/, name: 'Claude Sonnet 4' },
    { pattern: /^claude-haiku-4-5/, name: 'Claude Haiku 4.5' },
    { pattern: /^claude-3-5-sonnet/, name: 'Claude 3.5 Sonnet' },
    { pattern: /^claude-3-5-haiku/, name: 'Claude 3.5 Haiku' },
    { pattern: /^claude-3-opus/, name: 'Claude 3 Opus' },
    { pattern: /^claude-3-sonnet/, name: 'Claude 3 Sonnet' },
    { pattern: /^claude-3-haiku/, name: 'Claude 3 Haiku' },
    // GPT
    { pattern: /^gpt-4o-mini/, name: 'GPT-4o Mini' },
    { pattern: /^gpt-4o(?:-|$)/, name: 'GPT-4o' },
    { pattern: /^gpt-4-turbo/, name: 'GPT-4 Turbo' },
    { pattern: /^gpt-4-(?:0125|1106)-preview/, name: 'GPT-4 Preview' },
    { pattern: /^gpt-4(?:-0613)?$/, name: 'GPT-4' },
    { pattern: /^gpt-3\.5-turbo-16k/, name: 'GPT-3.5 Turbo 16K' },
    { pattern: /^gpt-3\.5-turbo/, name: 'GPT-3.5 Turbo' },
    { pattern: /^chatgpt-4o/, name: 'ChatGPT-4o' },
    // Gemini
    { pattern: /^gemini-(\d[\d.]*)-flash/, name: (m) => `Gemini ${m[1]} Flash` },
    { pattern: /^gemini-(\d[\d.]*)-pro/, name: (m) => `Gemini ${m[1]} Pro` },
    { pattern: /^gemini-(\d[\d.]*)/, name: (m) => `Gemini ${m[1]}` },
  ];

  for (const { pattern, name } of knownPatterns) {
    const match = modelId.match(pattern);
    if (match) return typeof name === 'function' ? name(match) : name;
  }

  // Generic fallback: capitalize first letter of each segment
  return modelId
    .replace(/-\d{8}$/, '') // strip date suffix
    .replace(/[-_]/g, ' ')
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .trim();
}

// ─── Provider fetchers ──────────────────────────────────────────────

/**
 * Fetch models from OpenAI-compatible API
 * Works for OpenAI, DeepSeek, Groq (all use /v1/models)
 */
export async function fetchOpenAIModels(apiKey, apiUrl = 'https://api.openai.com/v1') {
  try {
    const url = `${apiUrl.replace(/\/$/, '')}/models`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      apiLogger.warn({ status: res.status, url }, 'Failed to fetch OpenAI models');
      return [];
    }

    const { data } = await res.json();
    if (!Array.isArray(data)) return [];

    // Filter to chat/completion models only (skip embeddings, tts, dall-e, whisper, etc.)
    const NON_CHAT_PREFIXES = [
      'dall-e', 'whisper', 'tts', 'text-embedding', 'text-moderation',
      'babbage', 'davinci', 'ada', 'curie', 'text-search', 'text-similarity',
      'code-search', 'code-davinci', 'text-davinci', 'text-ada', 'text-babbage', 'text-curie',
      'if-', 'canary-', 'cushman',
    ];

    return data
      .filter(m => !NON_CHAT_PREFIXES.some(p => m.id.startsWith(p)))
      .filter(m => !m.id.includes('realtime') && !m.id.includes('audio') && !m.id.includes('transcription'))
      .map(m => ({
        name: normalizeModelName(m.id),
        model_id: m.id,
      }));
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching OpenAI models');
    return [];
  }
}

/**
 * Fetch Anthropic models — uses known model list + optional API
 * Anthropic doesn't have a public /models endpoint, so we maintain a known list
 */
export async function fetchAnthropicModels(apiKey) {
  // Known Anthropic models (updated Feb 2026)
  const knownModels = [
    { model_id: 'claude-opus-4-6', name: 'Claude Opus 4.6', context_window: 200000, max_tokens: 32000 },
    { model_id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', context_window: 200000, max_tokens: 8192 },
    { model_id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', context_window: 200000, max_tokens: 32000 },
    { model_id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', context_window: 200000, max_tokens: 32000 },
    { model_id: 'claude-opus-4-20250514', name: 'Claude Opus 4', context_window: 200000, max_tokens: 32000 },
    { model_id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', context_window: 200000, max_tokens: 8192 },
    { model_id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', context_window: 200000, max_tokens: 8192 },
    { model_id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', context_window: 200000, max_tokens: 8192 },
    { model_id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', context_window: 200000, max_tokens: 8192 },
    { model_id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', context_window: 200000, max_tokens: 4096 },
  ];

  // Try to fetch from API if key available
  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const body = await res.json();
        if (body.data && Array.isArray(body.data)) {
          // Merge API data with known list
          const apiModels = body.data.map(m => ({
            model_id: m.id,
            name: normalizeModelName(m.id),
            context_window: m.context_window,
            max_tokens: m.max_output_tokens,
          }));

          // Merge: API models + any known models not in API response
          const apiIds = new Set(apiModels.map(m => m.model_id));
          const merged = [...apiModels];
          for (const km of knownModels) {
            if (!apiIds.has(km.model_id)) {
              merged.push(km);
            }
          }
          return merged;
        }
      }
    } catch (err) {
      apiLogger.warn({ err }, 'Failed to fetch Anthropic models API, using known list');
    }
  }

  return knownModels;
}

/**
 * Fetch models from OpenRouter (free, no auth)
 */
export async function fetchOpenRouterModels() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];

    const { data } = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(m => ({
      name: m.name || normalizeModelName(m.id),
      model_id: m.id,
      context_window: m.context_length || null,
      input_price: m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1000000 : null,
      output_price: m.pricing?.completion ? parseFloat(m.pricing.completion) * 1000000 : null,
    }));
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching OpenRouter models');
    return [];
  }
}

/**
 * Fetch Groq models
 */
export async function fetchGroqModels(apiKey) {
  return fetchOpenAIModels(apiKey, 'https://api.groq.com/openai/v1');
}

/**
 * Fetch DeepSeek models
 */
export async function fetchDeepSeekModels(apiKey) {
  return fetchOpenAIModels(apiKey, 'https://api.deepseek.com/v1');
}

/**
 * Known GitHub Copilot CLI models (from `gh copilot --list-models`)
 */
export async function fetchCopilotModels() {
  // These are the models available via `gh copilot --model`
  return [
    { model_id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
    { model_id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    { model_id: 'claude-opus-4.6', name: 'Claude Opus 4.6' },
    { model_id: 'claude-opus-4.5', name: 'Claude Opus 4.5' },
    { model_id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    { model_id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
    { model_id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
    { model_id: 'gpt-5.2', name: 'GPT-5.2' },
    { model_id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max' },
    { model_id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
    { model_id: 'gpt-5.1', name: 'GPT-5.1' },
    { model_id: 'gpt-5', name: 'GPT-5' },
    { model_id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini' },
    { model_id: 'gpt-5-mini', name: 'GPT-5 Mini' },
    { model_id: 'gpt-4.1', name: 'GPT-4.1' },
  ];
}

/**
 * Known Claude Code CLI models
 */
export async function fetchClaudeCodeModels() {
  return [
    { model_id: 'claude-opus-4-6', name: 'Claude Opus 4.6', context_window: 200000 },
    { model_id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', context_window: 200000 },
    { model_id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', context_window: 200000 },
  ];
}

/**
 * Fetch Ollama models (local)
 */
export async function fetchOllamaModels(apiUrl = 'http://localhost:11434') {
  try {
    const res = await fetch(`${apiUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];

    const { models } = await res.json();
    if (!Array.isArray(models)) return [];

    return models.map(m => ({
      name: m.name,
      model_id: m.name,
      context_window: m.details?.parameter_size ? null : null,
    }));
  } catch {
    // Ollama not running — that's fine
    return [];
  }
}

// ─── Sync logic ─────────────────────────────────────────────────────

/**
 * Get all existing models for an operator from CRM table
 */
async function getExistingModels(operatorId, modelsTableId) {
  const query = isPostgres()
    ? `SELECT tr.id, tr.data FROM table_rows tr WHERE tr.table_id = $1 AND tr.data->>'operator_id' = $2`
    : `SELECT tr.id, tr.data FROM table_rows tr WHERE tr.table_id = ? AND json_extract(tr.data, '$.operator_id') = ?`;

  return dbAll(query, [modelsTableId, String(operatorId)]);
}

/**
 * Sync models for a single operator into the CRM AI Models table
 * @param {number} operatorId - Operator row ID
 * @param {Array} models - Array of { name, model_id, context_window?, max_tokens?, input_price?, output_price? }
 * @param {number} modelsTableId - CRM table ID for AI Models
 * @param {Object} options - { update: boolean } - whether to update existing models
 * @returns {{ added: number, skipped: number, updated: number, errors: number }}
 */
export async function syncModelsForOperator(operatorId, models, modelsTableId, options = {}) {
  const { update = false } = options;
  const result = { added: 0, skipped: 0, updated: 0, errors: 0 };

  // Get existing models for this operator
  const existingRows = await getExistingModels(operatorId, modelsTableId);
  const existingByModelId = new Map();
  for (const row of existingRows) {
    const data = safeParseJSON(row.data, {});
    if (data.model_id) {
      existingByModelId.set(data.model_id, { rowId: row.id, data });
    }
  }

  for (const model of models) {
    try {
      const existing = existingByModelId.get(model.model_id);

      if (existing) {
        if (update) {
          // Update existing model with new data
          const updatedData = { ...existing.data };
          if (model.name) updatedData.name = model.name;
          if (model.context_window != null) updatedData.context_window = model.context_window;
          if (model.max_tokens != null) updatedData.max_tokens = model.max_tokens;
          if (model.input_price != null) updatedData.input_price = model.input_price;
          if (model.output_price != null) updatedData.output_price = model.output_price;

          await dbRun(
            'UPDATE table_rows SET data = $1, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(updatedData), existing.rowId]
          );
          result.updated++;
        } else {
          result.skipped++;
        }
      } else {
        // Insert new model
        const rowData = {
          name: model.name || normalizeModelName(model.model_id),
          model_id: model.model_id,
          operator_id: String(operatorId),
          max_tokens: model.max_tokens || null,
          context_window: model.context_window || null,
          input_price: model.input_price || null,
          output_price: model.output_price || null,
        };

        const baseId = crypto.randomBytes(4).toString('hex').toUpperCase();
        await dbRun(
          'INSERT INTO table_rows (table_id, base_id, data) VALUES ($1, $2, $3)',
          [modelsTableId, baseId, JSON.stringify(rowData)]
        );
        result.added++;
      }
    } catch (err) {
      apiLogger.error({ err, model: model.model_id }, 'Error syncing model');
      result.errors++;
    }
  }

  return result;
}

/**
 * Fetch models for a given provider type
 * @param {string} provider - Provider identifier (openai, anthropic, groq, etc.)
 * @param {string|null} apiKey - API key
 * @param {string|null} apiUrl - API URL
 * @returns {Promise<Array>}
 */
export async function fetchModelsForProvider(provider, apiKey, apiUrl) {
  switch (provider) {
    case 'openai':
      if (!apiKey) return [];
      return fetchOpenAIModels(apiKey, apiUrl || 'https://api.openai.com/v1');
    case 'anthropic':
      return fetchAnthropicModels(apiKey);
    case 'google':
      // Google AI doesn't have a simple models list API without SDK
      return [];
    case 'groq':
      if (!apiKey) return [];
      return fetchGroqModels(apiKey);
    case 'deepseek':
      if (!apiKey) return [];
      return fetchDeepSeekModels(apiKey);
    case 'copilot':
      return fetchCopilotModels();
    case 'claude-code':
      return fetchClaudeCodeModels();
    case 'local':
      return fetchOllamaModels(apiUrl || 'http://localhost:11434');
    default:
      apiLogger.warn({ provider }, 'Unknown provider for model sync');
      return [];
  }
}

// Providers that should never be bulk-synced into the AI Models table.
// OpenRouter returns 300+ models, Replicate returns 1000+. These flood
// the relation dropdown and make it unusable.
const BULK_SYNC_BLOCKED_PROVIDERS = new Set([
  'openrouter',
  'replicate',
]);

// Safety limit: refuse to insert more than this many models per operator
// in a single sync run. Prevents accidental mass-import from chatty APIs.
const MAX_MODELS_PER_SYNC = 100;

/**
 * Sync ALL operators — main entry point
 * @param {Object} options - { modelsTableId, operatorsTableId, update }
 * @returns {Promise<Object>} Results per operator
 */
export async function syncAllModels(options = {}) {
  const { modelsTableId = 1787, operatorsTableId = 1783, update = false } = options;

  // Get all operators
  const operators = await dbAll(
    'SELECT tr.id, tr.data FROM table_rows tr WHERE tr.table_id = $1',
    [operatorsTableId]
  );

  const results = {};

  for (const opRow of operators) {
    const opData = safeParseJSON(opRow.data, {});
    const provider = opData.provider;
    const name = opData.name;
    const status = opData.status;
    const apiKey = opData.api_key || null;
    const apiUrl = opData.api_url || null;

    // Skip inactive operators
    if (status === 'inactive') {
      apiLogger.info({ operator: name, status }, 'Skipping inactive operator');
      results[name] = { status: 'skipped_inactive', provider };
      continue;
    }

    // Detect effective provider from api_url
    let effectiveProvider = provider;
    if (provider === 'openai' && apiUrl) {
      if (apiUrl.includes('openrouter.ai')) effectiveProvider = 'openrouter';
      else if (apiUrl.includes('deepseek.com')) effectiveProvider = 'deepseek';
    }

    // Block providers that return too many models (floods relation dropdowns)
    if (BULK_SYNC_BLOCKED_PROVIDERS.has(effectiveProvider)) {
      apiLogger.warn({ operator: name, provider: effectiveProvider },
        'Skipping bulk-sync for blocked provider (too many models)');
      results[name] = { status: 'skipped_blocked', provider: effectiveProvider };
      continue;
    }

    apiLogger.info({ operator: name, provider: effectiveProvider }, 'Syncing models for operator');

    try {
      const models = await fetchModelsForProvider(effectiveProvider, apiKey, apiUrl);

      if (models.length === 0) {
        results[name] = { status: 'no_models', provider: effectiveProvider };
        continue;
      }

      // Safety limit: refuse suspiciously large model lists
      if (models.length > MAX_MODELS_PER_SYNC) {
        apiLogger.warn({ operator: name, count: models.length, limit: MAX_MODELS_PER_SYNC },
          'Model count exceeds safety limit, skipping sync');
        results[name] = {
          status: 'skipped_too_many',
          provider: effectiveProvider,
          totalFetched: models.length,
          limit: MAX_MODELS_PER_SYNC,
        };
        continue;
      }

      const syncResult = await syncModelsForOperator(opRow.id, models, modelsTableId, { update });
      results[name] = { ...syncResult, provider: effectiveProvider, totalFetched: models.length };
    } catch (err) {
      apiLogger.error({ err, operator: name }, 'Error syncing operator models');
      results[name] = { status: 'error', error: err.message };
    }
  }

  return results;
}
