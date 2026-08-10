/**
 * Agent CRUD Controller
 * GET /agents, GET /agents/:spaceId, POST /agents/search
 * PUT /agents/:agentId
 */

import { Router } from 'express';
import { dbGet, dbAll, dbRun, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, error } from '../../../utils/response.js';
import {
  safeParseJSON,
  resolveAgentRelations,
  deepMergeContextSettings,
} from './shared.js';
import { resolveEmbeddingConfig, generateEmbedding } from './sharedEmbedding.js';
import { resolveModel, resolveProvider, parseAgentRow } from './sharedAgentResolution.js';

const router = Router();

/**
 * ADR-0079 P4: flip Tier-B `visibility: 'locked'` → `'unlocked'` for the agents
 * the user has unlocked via promo (MASTERMIND / MESHOK) stored in
 * `users.agent_config.unlocked_agent_slugs`. Mutates `agents` in place.
 * Best-effort — never throws.
 */
async function applyUnlockedAgentVisibility(agents, userId) {
  if (!userId || !Array.isArray(agents) || agents.length === 0) return;
  try {
    const row = await dbGet('SELECT agent_config FROM users WHERE id = ?', [userId]);
    if (!row) return;
    const cfg = typeof row.agent_config === 'string'
      ? safeParseJSON(row.agent_config, {})
      : (row.agent_config || {});
    const unlocked = Array.isArray(cfg.unlocked_agent_slugs) ? cfg.unlocked_agent_slugs : [];
    if (unlocked.length === 0) return;
    for (const a of agents) {
      if (a.visibility === 'locked' && a.agent_slug && unlocked.includes(a.agent_slug)) {
        a.visibility = 'unlocked';
      }
    }
  } catch (err) {
    apiLogger.warn({ err, userId }, '[ADR-0079] applyUnlockedAgentVisibility failed');
  }
}

/**
 * GET /api/v3/ai/agents
 * Get all AI agents across all spaces for current user
 */
router.get('/agents', async (req, res) => {
  try {
    const userId = req.user?.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const tables = await dbAll(`
      SELECT ut.id as table_id, s.id as space_id, s.name as space_name
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      JOIN spaces s ON p.space_id = s.id
      WHERE (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%' OR ut.name LIKE '%Агенты%')
        AND ut.name NOT LIKE 'doc\\_%' ESCAPE '\\'
        AND (s.owner_id = ? OR s.type = 'admin')
    `, [userId]);

    if (!tables || tables.length === 0) {
      return success(res, { agents: [], total: 0, limit, offset });
    }

    // Count total across all agent tables
    let total = 0;
    for (const table of tables) {
      const countResult = await dbGet(
        'SELECT COUNT(*) as cnt FROM table_rows WHERE table_id = ?',
        [table.table_id]
      );
      total += countResult?.cnt || 0;
    }

    // Fetch rows with pagination across tables
    const allAgents = [];
    let skipped = 0;
    let collected = 0;

    for (const table of tables) {
      if (collected >= limit) break;

      const tableCount = (await dbGet(
        'SELECT COUNT(*) as cnt FROM table_rows WHERE table_id = ?',
        [table.table_id]
      ))?.cnt || 0;

      // Skip entire table if offset hasn't been reached yet
      if (skipped + tableCount <= offset) {
        skipped += tableCount;
        continue;
      }

      const tableOffset = Math.max(offset - skipped, 0);
      const tableLimit = limit - collected;

      const rows = await dbAll(`
        SELECT id, data, created_at FROM table_rows
        WHERE table_id = ? ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `, [table.table_id, tableLimit, tableOffset]);

      skipped += tableOffset;

      for (const row of rows) {
        if (collected >= limit) break;
        try {
          const data = safeParseJSON(row.data, {});
          if (!data || typeof data !== 'object') continue;
          await resolveAgentRelations(data, table.table_id);

          const resolvedModel = await resolveModel(data.model);
          const resolvedProvider = await resolveProvider(data.provider_id || data.operator_id);

          allAgents.push(parseAgentRow(row, data, {
            table_id: table.table_id,
            model: resolvedModel.model_id,
            model_name: resolvedModel.name,
            model_id: resolvedModel.id,
            provider: resolvedProvider.api_identifier,
            provider_name: resolvedProvider.name,
            provider_id: resolvedProvider.id,
            space_id: table.space_id,
            space_name: table.space_name,
          }));
          collected++;
        } catch (e) {
          apiLogger.warn({ err: e }, 'Failed to parse agent data');
        }
      }
    }

    await applyUnlockedAgentVisibility(allAgents, userId);
    return success(res, { agents: allAgents, total, limit, offset });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching all AI agents');
    return error(res, 'FETCH_AGENTS_ERROR', 'Failed to fetch agents', 500);
  }
});

/**
 * GET /api/v3/ai/agents/:spaceId
 * Get all AI agents for a space
 */
router.get('/agents/:spaceId', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const table = await dbGet(`
      SELECT ut.id,
             (SELECT COUNT(*) FROM table_rows tr WHERE tr.table_id = ut.id) as row_count
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ? AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%' OR ut.name LIKE '%Агенты%')
        AND ut.name NOT LIKE 'doc\\_%' ESCAPE '\\'
      ORDER BY row_count DESC
      LIMIT 1
    `, [spaceId]);

    if (!table) {
      return success(res, { agents: [], total: 0, limit, offset });
    }

    const total = table.row_count || 0;

    const rows = await dbAll(`
      SELECT id, data, created_at FROM table_rows
      WHERE table_id = ? ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [table.id, limit, offset]);

    const agents = [];
    for (const row of rows) {
      const data = safeParseJSON(row.data, {});
      if (!data || typeof data !== 'object') continue;

      const resolvedModel = await resolveModel(data.model);
      const resolvedProvider = await resolveProvider(data.provider_id || data.operator_id);

      agents.push(parseAgentRow(row, data, {
        table_id: table.id,
        model: resolvedModel.model_id,
        model_name: resolvedModel.name,
        model_id: resolvedModel.id,
        provider: resolvedProvider.api_identifier,
        provider_name: resolvedProvider.name,
        provider_id: resolvedProvider.id,
      }));
    }

    await applyUnlockedAgentVisibility(agents, req.user?.id);
    return success(res, { agents, total, limit, offset });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching AI agents');
    return error(res, 'FETCH_AGENTS_ERROR', 'Failed to fetch agents', 500);
  }
});

/**
 * POST /api/v3/ai/agents/search
 * Semantic search for AI agents using vector embeddings
 */
router.post('/agents/search', async (req, res) => {
  try {
    const { query, spaceId, limit = 10 } = req.body;

    if (!query || !spaceId) {
      return badRequest(res, 'Query and spaceId are required');
    }

    const embeddingConfig = await resolveEmbeddingConfig(null, spaceId);

    if (!embeddingConfig.apiKey) {
      return badRequest(res, 'No embedding API key configured. Use text search instead.');
    }

    const queryEmbedding = await generateEmbedding(query, embeddingConfig.apiKey, embeddingConfig.model, embeddingConfig.baseUrl);

    const table = await dbGet(`
      SELECT ut.id
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ? AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%' OR ut.name LIKE '%Агенты%')
      LIMIT 1
    `, [spaceId]);

    if (!table) {
      return success(res, { agents: [], message: 'No agents table found' });
    }

    const rows = await dbAll(`
      SELECT id, data, created_at FROM table_rows WHERE table_id = ?
    `, [table.id]);

    const agentsWithScores = [];

    for (const row of rows) {
      const data = safeParseJSON(row.data, {});
      if (!data || typeof data !== 'object') continue;

      const searchableText = [
        data.name || '',
        data.description || '',
        data.system_prompt ? data.system_prompt.substring(0, 500) : ''
      ].filter(Boolean).join(' | ');

      if (!searchableText.trim()) continue;

      try {
        const agentEmbedding = await generateEmbedding(searchableText, embeddingConfig.apiKey, embeddingConfig.model, embeddingConfig.baseUrl);

        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < queryEmbedding.length; i++) {
          dotProduct += queryEmbedding[i] * agentEmbedding[i];
          normA += queryEmbedding[i] * queryEmbedding[i];
          normB += agentEmbedding[i] * agentEmbedding[i];
        }
        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

        const isActive = data.is_active === true || data.is_active === 1 || data.is_active === 'true' || data.status === 'active';

        agentsWithScores.push({
          id: row.id, name: data.name || 'Unnamed Agent',
          description: data.description || '', system_prompt: data.system_prompt || '',
          icon: data.icon || '🤖', is_active: isActive,
          response_mode: data.response_mode || 'mention_only', similarity
        });
      } catch (embError) {
        apiLogger.warn({ err: embError, agentId: row.id }, 'Failed to generate embedding for agent');
      }
    }

    agentsWithScores.sort((a, b) => b.similarity - a.similarity);

    return success(res, {
      agents: agentsWithScores.slice(0, parseInt(limit)),
      query, model: embeddingConfig.model
    });
  } catch (err) {
    apiLogger.error({ err }, 'Error in semantic agent search');
    return error(res, 'SEMANTIC_SEARCH_ERROR', 'Semantic search failed', 500);
  }
});

/**
 * POST /api/v3/ai/agents/:spaceId/:agentId/unlock
 * ADR-0079 §2.3 — Settings → Add Agent path: stash the agent's slug in
 * `users.agent_config.unlocked_agent_slugs` so subsequent GET /agents calls
 * surface it as `visibility='unlocked'` via applyUnlockedAgentVisibility().
 * Companion to /auth/register MASTERMIND / MESHOK promo (StarterPackService.applyPromoUnlock).
 *
 * Idempotent — duplicate unlocks deduplicate the slug list.
 */
router.post('/agents/:spaceId/:agentId/unlock', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'UNAUTHENTICATED', 'login required', 401);

    const { agentId } = req.params;
    const row = await dbGet(`
      SELECT tr.id, tr.data
        FROM table_rows tr
        JOIN universal_tables ut ON tr.table_id = ut.id
       WHERE tr.id = ? AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%')
    `, [agentId]);
    if (!row) return notFound(res, 'Agent');

    const data = safeParseJSON(row.data, {});
    const slug = data.agent_slug || data.slug;
    if (!slug) return badRequest(res, 'Agent has no slug to unlock');

    const userRow = await dbGet('SELECT agent_config FROM users WHERE id = ?', [userId]);
    const cfg = userRow && (typeof userRow.agent_config === 'string'
      ? safeParseJSON(userRow.agent_config, {})
      : (userRow.agent_config || {}));
    const current = Array.isArray(cfg?.unlocked_agent_slugs) ? cfg.unlocked_agent_slugs : [];
    if (current.includes(slug)) {
      return success(res, { slug, already: true, unlocked_agent_slugs: current });
    }
    const next = [...current, slug];

    await dbRun(
      `UPDATE users
          SET agent_config = jsonb_set(
                COALESCE(agent_config, '{}'::jsonb),
                '{unlocked_agent_slugs}',
                to_jsonb(?::text[]),
                true
              ),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [next, userId]
    );

    apiLogger.info({ userId, slug }, '[ADR-0079] agent unlocked via Settings → Add Agent');
    return success(res, { slug, already: false, unlocked_agent_slugs: next });
  } catch (err) {
    apiLogger.error({ err }, 'Error unlocking agent');
    return error(res, 'UNLOCK_AGENT_ERROR', err.message, 500);
  }
});

/**
 * PUT /api/v3/ai/agents/:agentId
 * Update agent settings
 * ADR-110: context_settings uses deep merge
 */
router.put('/agents/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { provider_id, operator_id, model, system_prompt, crm_instructions, main_instructions, name, description, icon, is_active, response_mode, invocation_mode, context_settings } = req.body;
    const effectiveProviderId = provider_id || operator_id;

    const row = await dbGet(`
      SELECT tr.id, tr.data, tr.table_id
      FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE tr.id = ? AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%')
    `, [agentId]);

    if (!row) return notFound(res, 'Agent');

    const data = safeParseJSON(row.data, {});

    if (effectiveProviderId !== undefined) data.operator_id = effectiveProviderId;
    if (model !== undefined) data.model = model;
    if (system_prompt !== undefined) data.system_prompt = system_prompt;
    if (crm_instructions !== undefined) data.crm_instructions = crm_instructions;
    if (main_instructions !== undefined) data.main_instructions = main_instructions;
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (icon !== undefined) data.icon = icon;
    if (is_active !== undefined) data.is_active = is_active;
    if (response_mode !== undefined) data.response_mode = response_mode;
    if (invocation_mode !== undefined) {
      const allowed = ['mention', 'command', 'both'];
      if (invocation_mode === null || invocation_mode === '') {
        data.invocation_mode = null;
      } else if (allowed.includes(invocation_mode)) {
        data.invocation_mode = invocation_mode;
      } else {
        return badRequest(res, `invocation_mode must be one of: ${allowed.join(', ')}`);
      }
    }

    // ADR-110: Deep merge context_settings
    if (context_settings !== undefined) {
      const incoming = typeof context_settings === 'string'
        ? safeParseJSON(context_settings, {}) : (context_settings || {});
      const existing = safeParseJSON(data.context_settings, {});
      data.context_settings = deepMergeContextSettings(existing, incoming);
    }

    // Update relation column values
    const columns = await dbAll(
      'SELECT id, column_name, config FROM table_columns WHERE table_id = ?',
      [row.table_id]
    );
    for (const col of columns) {
      const colConfig = safeParseJSON(col.config, {});
      if (!colConfig.relation?.enabled) continue;
      if (col.column_name === 'operator_id' && effectiveProviderId !== undefined) {
        data[String(col.id)] = String(effectiveProviderId);
      } else if (col.column_name === 'model' && model !== undefined) {
        const modelRow = await dbGet(isPostgres()
          ? `SELECT tr.id FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE (ut.name = 'AI Models' OR ut.name = 'ai_models')
               AND tr.data->>'model_id' = $1
             LIMIT 1`
          : `SELECT tr.id FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE (ut.name = 'AI Models' OR ut.name = 'ai_models')
               AND json_extract(tr.data, '$.model_id') = ?
             LIMIT 1`,
          [model]);
        if (modelRow) {
          data[String(col.id)] = String(modelRow.id);
        }
      }
    }

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), agentId]
    );

    return success(res, { id: Number(agentId), ...data });
  } catch (err) {
    apiLogger.error({ err }, 'Error updating agent');
    return error(res, 'UPDATE_AGENT_ERROR', err.message, 500);
  }
});

export default router;
