/**
 * Agent CRUD Controller
 * GET /agents, GET /agents/:spaceId, POST /agents/search
 * PUT /agents/:agentId
 */

import { Router } from 'express';
import { z } from 'zod';
import { dbGet, dbAll, dbRun, isPostgres, withTransactionAsync } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, error, conflict, forbidden } from '../../../utils/response.js';
import {
  safeParseJSON,
  resolveAgentRelations,
  deepMergeContextSettings,
} from './shared.js';
import { resolveEmbeddingConfig, generateEmbedding } from './sharedEmbedding.js';
import { resolveModel, resolveProvider, parseAgentRow } from './sharedAgentResolution.js';
import { resolvePassportAuthority } from '../../../services/passportAuthority.js';
import { writeAudit } from '../../../services/audit/writeAudit.js';

const router = Router();

/**
 * Mirror operator/model choices into the table's relation columns so the
 * universal-table UI shows the same value the agent runtime reads from
 * `data.operator_id` / `data.model`. `db` is `{ get, all }` — the pool
 * helpers for the legacy PUT, the trx object inside the atomic PUT.
 */
async function applyRelationColumns(db, tableId, data, { operatorId, model }) {
  const columns = await db.all(
    'SELECT id, column_name, config FROM table_columns WHERE table_id = ?',
    [tableId]
  );
  for (const col of columns) {
    const colConfig = safeParseJSON(col.config, {});
    if (!colConfig.relation?.enabled) continue;
    if (col.column_name === 'operator_id' && operatorId !== undefined) {
      data[String(col.id)] = String(operatorId);
    } else if (col.column_name === 'model' && model !== undefined) {
      const modelRow = await db.get(isPostgres()
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
}

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
      ORDER BY ut.id
    `, [userId]);

    if (!tables || tables.length === 0) {
      return success(res, { agents: [], total: 0, limit, offset });
    }

    // Count once per table. pg returns COUNT(*) (int8) as a string — Number() it,
    // or `total`/`skipped` concatenate and every page re-serves the last tables.
    let total = 0;
    for (const table of tables) {
      const countResult = await dbGet(
        'SELECT COUNT(*) as cnt FROM table_rows WHERE table_id = ?',
        [table.table_id]
      );
      table.row_count = Number(countResult?.cnt) || 0;
      total += table.row_count;
    }

    // Fetch rows with pagination across tables
    const allAgents = [];
    let skipped = 0;
    let collected = 0;

    for (const table of tables) {
      if (collected >= limit) break;

      const tableCount = table.row_count;

      // Skip entire table if offset hasn't been reached yet
      if (skipped + tableCount <= offset) {
        skipped += tableCount;
        continue;
      }

      const tableOffset = Math.max(offset - skipped, 0);
      const tableLimit = limit - collected;

      const rows = await dbAll(`
        SELECT id, data, created_at FROM table_rows
        WHERE table_id = ? ORDER BY created_at DESC, id DESC
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

    const total = Number(table.row_count) || 0;

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

    await applyRelationColumns({ get: dbGet, all: dbAll }, row.table_id, data, { operatorId: effectiveProviderId, model });

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

/**
 * PUT /api/v3/ai/agents/:agentId/configuration — atomic identity edit
 * (conversation 3692). Body: `{ data: { name?, slug?, color?, icon?,
 * operator_id?, model?, main_instructions?, crm_instructions? } }`, edited
 * keys only.
 *
 * The identity lives twice: name in the row and on the passport user, slug in
 * the row (`slug` and/or `agent_slug` — both legacy spellings are kept in
 * step) and as `users.handle`. One transaction updates all of it or nothing:
 * a slug that another agent in the same table already uses, or that any user
 * holds as a global handle, is a 409 with no partial write. Renames never
 * issue a passport: a user without a handle keeps none, and no user row is
 * created for an agent that has none.
 *
 * Authorization is derived from the agent's residence, never from the body:
 * admin access in the residence space is required for every edit, and the
 * full passport authority (global admin + space admin) when the agent holds a
 * handle and its name or slug changes — that edit rewrites a global identity.
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const instructionItem = z.union([z.string(), z.object({ content: z.string() }).passthrough()]);
const configurationSchema = z.object({
  data: z.object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    slug: z.string().trim().toLowerCase().max(64).regex(SLUG_RE, 'Slug must be lowercase letters, digits and hyphens'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #rrggbb value'),
    icon: z.string().max(64),
    operator_id: z.number().int().positive().nullable(),
    model: z.string().max(200),
    main_instructions: z.union([z.string(), z.array(instructionItem)]),
    crm_instructions: z.string(),
  }).strict().partial().refine((d) => Object.keys(d).length > 0, { message: 'No changes supplied' }),
}).strict();

const AUTHORITY_MESSAGES = {
  agent_principal: 'Agents cannot edit agent identities',
  global_role_required: 'A global admin role is required to rename an agent that holds a passport',
  space_admin_required: "Admin access in the agent's space is required to edit it",
};

router.put('/agents/:agentId/configuration', async (req, res) => {
  const agentId = Number(req.params.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) return badRequest(res, 'Invalid agent id');
  const parsed = configurationSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest(res, `${issue.path.join('.') || 'body'}: ${issue.message}`, 'VALIDATION_ERROR');
  }
  const changes = parsed.data.data;
  const identityChanged = changes.name !== undefined || changes.slug !== undefined;

  try {
    const authority = await resolvePassportAuthority({ actorUserId: req.user?.id, rowId: agentId });
    if (authority.reason === 'not_authenticated') return error(res, 'UNAUTHENTICATED', 'login required', 401);
    if (authority.reason === 'residence_not_found') return notFound(res, 'Agent');
    if (authority.reason === 'agent_principal' || !authority.space.admin) {
      return forbidden(res, AUTHORITY_MESSAGES[authority.reason] || AUTHORITY_MESSAGES.space_admin_required);
    }

    const result = await withTransactionAsync(async (trx) => {
      const row = await trx.get(`
        SELECT tr.id, tr.data, tr.table_id
        FROM table_rows tr
        JOIN universal_tables ut ON tr.table_id = ut.id
        WHERE tr.id = ? AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%' OR ut.name LIKE '%Агенты%')
        FOR UPDATE OF tr
      `, [agentId]);
      if (!row) return { status: 404 };

      const passport = await trx.get(
        `SELECT id, name, handle FROM users WHERE managed_by_agent_row_id = ? AND user_type = 'agent' ORDER BY id LIMIT 1 FOR UPDATE`,
        [agentId]
      );
      if (passport?.handle && identityChanged && !authority.allowed) {
        return { status: 403, message: AUTHORITY_MESSAGES[authority.reason] || 'Forbidden' };
      }

      const data = safeParseJSON(row.data, {});
      const prior = { name: data.name, slug: data.slug ?? data.agent_slug ?? null, handle: passport?.handle ?? null };

      if (changes.slug !== undefined) {
        // Serialize slug changes per agents table: the row has no unique index,
        // so two concurrent renames to the same slug must not both pass the check.
        await trx.get('SELECT pg_advisory_xact_lock(hashtext(?))', [`agent-slug:${row.table_id}`]);
        const rowClash = await trx.get(
          `SELECT id FROM table_rows
           WHERE table_id = ? AND id <> ? AND (lower(data->>'slug') = ? OR lower(data->>'agent_slug') = ?)
           LIMIT 1`,
          [row.table_id, agentId, changes.slug, changes.slug]
        );
        if (rowClash) return { status: 409, message: `Slug '${changes.slug}' is already used by another agent in this table` };
        const handleClash = await trx.get(
          'SELECT id FROM users WHERE lower(handle) = ? AND id <> ? LIMIT 1',
          [changes.slug, passport?.id ?? 0]
        );
        if (handleClash) return { status: 409, message: `Slug '${changes.slug}' is already taken as a global handle` };
        // Keep whichever spelling(s) the row already uses; new rows get `slug`.
        if ('agent_slug' in data) data.agent_slug = changes.slug;
        if ('slug' in data || !('agent_slug' in data)) data.slug = changes.slug;
      }

      for (const key of ['name', 'color', 'icon', 'model', 'main_instructions', 'crm_instructions']) {
        if (changes[key] !== undefined) data[key] = changes[key];
      }
      if (changes.operator_id !== undefined) data.operator_id = changes.operator_id;
      await applyRelationColumns(trx, row.table_id, data, { operatorId: changes.operator_id, model: changes.model });

      await trx.run(
        'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(data), new Date().toISOString(), agentId]
      );

      let passportOut = null;
      if (passport) {
        // A handle is only ever moved, never minted here: null stays null.
        const nextHandle = passport.handle ? (changes.slug ?? passport.handle) : null;
        const nextName = changes.name ?? passport.name;
        if (nextHandle !== passport.handle || nextName !== passport.name) {
          await trx.run('UPDATE users SET name = ?, handle = ?, updated_at = NOW() WHERE id = ?', [nextName, nextHandle, passport.id]);
        }
        passportOut = { user_id: passport.id, handle: nextHandle };
      }
      return { status: 200, data, prior, passport: passportOut, table_id: row.table_id };
    });

    if (result.status === 404) return notFound(res, 'Agent');
    if (result.status === 403) return forbidden(res, result.message);
    if (result.status === 409) return conflict(res, result.message);

    const { data, prior, passport } = result;
    const handleChanged = passport?.handle && passport.handle !== prior.handle;
    writeAudit(req, {
      action: 'agent.identity.update',
      entity_type: 'ai_agent',
      entity_id: agentId,
      details: {
        table_id: result.table_id,
        changed: Object.keys(changes),
        prior,
        next: { name: data.name, slug: data.slug ?? data.agent_slug ?? null, handle: passport?.handle ?? null },
        passport_user_id: passport?.user_id ?? null,
      },
    });
    if (handleChanged) {
      // ADR-198: the mailbox address is minted from the handle at issue time and is
      // keyed by user_id; it is deliberately NOT renamed here — a silently moving
      // address loses mail. Surface it so ops can decide.
      apiLogger.warn(
        { agentId, userId: passport.user_id, prior_handle: prior.handle, handle: passport.handle },
        'agent handle renamed — any provisioned mailbox keeps its old address'
      );
    }
    return success(res, { id: agentId, table_id: result.table_id, ...data, passport });
  } catch (err) {
    if (err?.code === '23505') return conflict(res, 'Slug is already taken as a global handle');
    apiLogger.error({ err, agentId }, 'Error updating agent configuration');
    return error(res, 'UPDATE_AGENT_CONFIGURATION_ERROR', 'Failed to update agent configuration', 500);
  }
});

export default router;
