/**
 * Providers & Models Controller
 * GET/PUT /providers, GET /providers/:providerId/models
 * POST /providers/:providerId/refresh-models, GET /models
 */

import { Router } from 'express';
import { dbGet, dbRun, dbAll, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, error } from '../../../utils/response.js';
import { safeParseJSON } from './shared.js';

const router = Router();

/**
 * POST /api/v3/ai/providers/:providerId/refresh-models
 */
router.post('/providers/:providerId/refresh-models', async (req, res) => {
  try {
    const { providerId } = req.params;
    const userId = req.user?.id;

    const providerRow = await dbGet(`
      SELECT tr.id, tr.data, tr.table_id FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE tr.id = ? AND ut.name LIKE '%Providers%'
    `, [providerId]);

    if (!providerRow) return notFound(res, 'Provider not found');

    const provider = safeParseJSON(providerRow.data, {});

    let apiKey = null;
    if (provider.api_key_id) {
      const keyRow = await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [provider.api_key_id]);
      if (keyRow) { apiKey = safeParseJSON(keyRow.data, {}).api_key; }
    }
    if (!apiKey) return badRequest(res, 'No API key configured for this provider');

    const modelsTable = await dbGet(`
      SELECT ut.id FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE ut.name LIKE '%Models%' AND p.space_id = 10 LIMIT 1
    `);
    if (!modelsTable) return notFound(res, 'Models table not found');

    let models = [];

    if (provider.api_id === 'openai') {
      const response = await fetch(`${provider.base_url}/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (!response.ok) {
        const err = await response.text();
        return error(res, 'OPENAI_API_ERROR', `OpenAI API error: ${err}`, 500);
      }
      const data = await response.json();
      models = data.data
        .filter(m => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('chatgpt'))
        .map(m => ({
          model_id: m.id, name: m.id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          provider_id: providerId, context_window: m.id.includes('gpt-4') ? 128000 : 16385,
          is_active: true, deprecated: false
        }));
    } else if (provider.api_id === 'anthropic') {
      models = [
        { model_id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider_id: providerId, context_window: 200000, is_active: true },
        { model_id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider_id: providerId, context_window: 200000, is_active: true },
        { model_id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider_id: providerId, context_window: 200000, is_active: true },
        { model_id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider_id: providerId, context_window: 200000, is_active: true }
      ];
    } else if (provider.api_id === 'ollama') {
      const response = await fetch(`${provider.base_url}/api/tags`);
      if (!response.ok) return error(res, 'OLLAMA_ERROR', 'Failed to connect to Ollama', 500);
      const data = await response.json();
      models = (data.models || []).map(m => ({
        model_id: m.name, name: m.name, provider_id: providerId, context_window: 8192, is_active: true
      }));
    }

    await dbRun(`DELETE FROM table_rows WHERE table_id = ? AND json_extract(data, '$.provider_id') = ?`, [modelsTable.id, providerId]);

    let addedCount = 0;
    for (const model of models) {
      const baseId = `model-${provider.api_id}-${model.model_id.replace(/[^a-z0-9]/gi, '-')}`;
      await dbRun(`INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [modelsTable.id, baseId, JSON.stringify(model), userId]);
      addedCount++;
    }

    await dbRun(`UPDATE table_rows SET data = json_set(json_set(data, '$.models_count', ?), '$.last_refresh', ?) WHERE id = ?`,
      [addedCount, new Date().toISOString(), providerId]);

    return success(res, { data: { providerId, providerName: provider.name, modelsFound: models.length, modelsAdded: addedCount } });
  } catch (err) {
    apiLogger.error({ err }, 'Error refreshing models');
    return error(res, 'REFRESH_MODELS_ERROR', 'Failed to refresh models: ' + err.message, 500);
  }
});

/**
 * GET /api/v3/ai/providers
 */
router.get('/providers', async (req, res) => {
  try {
    const spaceId = req.query.spaceId || req.headers['x-space-id'];
    apiLogger.debug({ context: 'AI Providers', spaceId }, 'Request - spaceId');

    let table;
    if (spaceId) {
      table = await dbGet(`
        SELECT ut.id FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE (ut.name = 'AI Operators' OR ut.name = 'ai_operators') AND p.space_id = ?
        LIMIT 1
      `, [spaceId]);
    }

    if (!table) {
      table = await dbGet(`SELECT ut.id FROM universal_tables ut WHERE ut.name = 'AI Operators' OR ut.name = 'ai_operators' ORDER BY id ASC LIMIT 1`);
    }

    if (!table) return success(res, { providers: [] });

    const rows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [table.id]);
    const providers = rows.map(r => ({ id: r.id, ...safeParseJSON(r.data, {}) })).filter(p => p.id);

    return success(res, { providers });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching providers');
    return error(res, 'FETCH_PROVIDERS_ERROR', 'Failed to fetch providers', 500);
  }
});

/**
 * PUT /api/v3/ai/providers/:providerId
 */
router.put('/providers/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    const { api_key } = req.body;
    if (!api_key) return badRequest(res, 'api_key is required');

    const row = await dbGet(`SELECT id, data FROM table_rows WHERE id = ?`, [providerId]);
    if (!row) return notFound(res, 'Provider not found');

    const data = safeParseJSON(row.data, {});
    data.api_key = api_key;
    if (!data.status) data.status = 'active';

    await dbRun(`UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`, [JSON.stringify(data), providerId]);

    return success(res, null, 'Provider updated');
  } catch (err) {
    apiLogger.error({ err }, 'Error updating provider');
    return error(res, 'UPDATE_PROVIDER_ERROR', 'Failed to update provider', 500);
  }
});

/**
 * GET /api/v3/ai/providers/:providerId/models
 */
router.get('/providers/:providerId/models', async (req, res) => {
  try {
    const { providerId } = req.params;
    const spaceId = req.query.spaceId || req.headers['x-space-id'];

    let table;
    if (spaceId) {
      table = await dbGet(`SELECT ut.id FROM universal_tables ut JOIN projects p ON ut.project_id = p.id WHERE (ut.name = 'AI Models' OR ut.name = 'ai_models') AND p.space_id = ? LIMIT 1`, [spaceId]);
    }
    if (!table) {
      table = await dbGet(`SELECT ut.id FROM universal_tables ut WHERE ut.name = 'AI Models' OR ut.name = 'ai_models' LIMIT 1`);
    }
    if (!table) return success(res, { models: [] });

    const providerIds = [String(providerId)];
    const operatorRow = await dbGet('SELECT data FROM table_rows WHERE id = ?', [providerId]);
    if (operatorRow) {
      const opData = safeParseJSON(operatorRow.data, {});
      if (opData.provider === 'claude-code' || opData.provider === 'anthropic') {
        const anthropicOp = await dbGet(isPostgres()
          ? `SELECT tr.id FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id JOIN projects p ON ut.project_id = p.id
             WHERE (ut.name LIKE '%Operators%') AND tr.data->>'provider' = 'anthropic' AND tr.data->>'name' = 'Anthropic'
               AND p.space_id = (SELECT p2.space_id FROM universal_tables ut2 JOIN projects p2 ON ut2.project_id = p2.id WHERE ut2.id = $1) LIMIT 1`
          : `SELECT tr.id FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id JOIN projects p ON ut.project_id = p.id
             WHERE (ut.name LIKE '%Operators%') AND json_extract(tr.data, '$.provider') = 'anthropic' AND json_extract(tr.data, '$.name') = 'Anthropic'
               AND p.space_id = (SELECT p2.space_id FROM universal_tables ut2 JOIN projects p2 ON ut2.project_id = p2.id WHERE ut2.id = ?) LIMIT 1`,
          [table.id]);
        if (anthropicOp && String(anthropicOp.id) !== String(providerId)) {
          providerIds.push(String(anthropicOp.id));
        }
      }
    }

    const rows = await dbAll(isPostgres()
      ? `SELECT id, data FROM table_rows WHERE table_id = $1 AND (data->>'operator_id' = ANY($2) OR data->>'provider_id' = ANY($2)) ORDER BY data->>'name'`
      : `SELECT id, data FROM table_rows WHERE table_id = ?
           AND (${providerIds.map(() => "json_extract(data, '$.operator_id') = ?").join(' OR ')}
             OR ${providerIds.map(() => "json_extract(data, '$.provider_id') = ?").join(' OR ')})
           ORDER BY json_extract(data, '$.name')`,
      isPostgres() ? [table.id, providerIds] : [table.id, ...providerIds, ...providerIds]
    );

    const models = rows.map(r => {
      const data = safeParseJSON(r.data, {});
      return { id: r.id, name: data.name || data.model_id, model_id: data.model_id, operator_id: data.operator_id, provider_id: data.provider_id || data.operator_id };
    });

    return success(res, { models });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching provider models');
    return error(res, 'FETCH_MODELS_ERROR', 'Failed to fetch models', 500);
  }
});

/**
 * GET /api/v3/ai/models
 */
router.get('/models', async (req, res) => {
  try {
    const { providerId } = req.query;
    const spaceId = req.query.spaceId || req.headers['x-space-id'];

    let table;
    if (spaceId) {
      table = await dbGet(`SELECT ut.id FROM universal_tables ut JOIN projects p ON ut.project_id = p.id WHERE (ut.name = 'AI Models' OR ut.name = 'ai_models') AND p.space_id = ? LIMIT 1`, [spaceId]);
    }
    if (!table) {
      table = await dbGet(`SELECT ut.id FROM universal_tables ut WHERE ut.name = 'AI Models' OR ut.name = 'ai_models' LIMIT 1`);
    }
    if (!table) return success(res, { models: [] });

    let query = `SELECT id, data FROM table_rows WHERE table_id = ?`;
    const params = [table.id];

    if (providerId) {
      query += ` AND (json_extract(data, '$.provider_id') = ? OR json_extract(data, '$.operator_id') = ?)`;
      params.push(providerId, providerId);
    }
    query += ` ORDER BY json_extract(data, '$.name')`;

    const rows = await dbAll(query, params);
    const models = rows.map(r => ({ id: r.id, ...safeParseJSON(r.data, {}) })).filter(m => m.id);

    return success(res, { models });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching models');
    return error(res, 'FETCH_MODELS_ERROR', 'Failed to fetch models', 500);
  }
});

export default router;
