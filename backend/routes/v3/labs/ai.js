/**
 * Labs AI Integration Routes
 * Handles AI agents, providers, templates endpoints
 * Both v4 (direct DB) and legacy (universal tables) versions
 */
import { Router } from 'express';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, notFound, badRequest } from '../../../utils/response.js';
import { generateId } from './_helpers.js';
import { getAgentTableIds } from '../../../services/agentTableResolver.js';

const router = Router();

// === V4 AI INTEGRATION ENDPOINTS ===

/**
 * GET /api/v3/labs/ai/agents
 * Get all AI agents from GOD CRM AI Pack
 */
router.get('/ai/agents', async (req, res) => {
  try {
    const agents = await dbAll(`
      SELECT a.*, o.name as operator_name, o.integration_key, o.default_model
      FROM ai_agents a
      LEFT JOIN ai_operators o ON a.operator_id = o.id
      ORDER BY a.name
    `);
    success(res, agents);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get AI agents');
    badRequest(res, 'Failed to get AI agents');
  }
});

/**
 * GET /api/v3/labs/ai/providers
 * Get all AI providers/operators from GOD CRM AI Pack
 */
router.get('/ai/providers', async (req, res) => {
  try {
    const providers = await dbAll(`
      SELECT id, name, description, integration_key, default_model,
             supported_models, created_at
      FROM ai_operators
      ORDER BY name
    `);
    success(res, providers);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get AI providers');
    badRequest(res, 'Failed to get AI providers');
  }
});

/**
 * GET /api/v3/labs/ai/templates
 * Get AI templates (placeholder for MindWorkflow integration)
 */
router.get('/ai/templates', async (req, res) => {
  try {
    // For now, return empty array - will be populated when MindWorkflow sync is implemented
    const templates = [];
    success(res, templates);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get AI templates');
    badRequest(res, 'Failed to get AI templates');
  }
});

/**
 * POST /api/v3/labs/ai/templates/sync
 * Sync templates from MindWorkflow (placeholder)
 */
router.post('/ai/templates/sync', async (req, res) => {
  try {
    // Placeholder for MindWorkflow template sync
    apiLogger.info('AI templates sync requested (not yet implemented)');
    success(res, {
      synced: 0,
      message: 'Template sync not yet implemented'
    });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to sync AI templates');
    badRequest(res, 'Failed to sync AI templates');
  }
});

/**
 * POST /api/v3/labs/ai/templates/:templateId/create-agent
 * Create agent from template (placeholder)
 */
router.post('/ai/templates/:templateId/create-agent', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { operator_id, custom_name } = req.body;

    // Placeholder for agent creation from template
    apiLogger.info({ templateId, operator_id, custom_name }, 'Agent creation from template requested (not yet implemented)');

    // Return mock agent for now
    const mockAgent = {
      id: Date.now(),
      name: custom_name || `Agent from Template ${templateId}`,
      description: 'Created from MindWorkflow template',
      operator_id,
      created_at: new Date().toISOString()
    };

    created(res, mockAgent);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create agent from template');
    badRequest(res, 'Failed to create agent from template');
  }
});

// === LEGACY AI ENDPOINTS (universal tables system) ===

// GET /ai/agents (legacy - via universal tables)
// NOTE: This is registered after the v4 version above.
// Express uses the first matching route, so v4 version takes precedence.
// These legacy routes are kept for backward compatibility but won't be reached
// unless the v4 routes are removed. They are included here to preserve the
// exact same route registration order as the original file.

// Legacy: GET /ai/agents (via universal tables)
router.get('/ai/agents', async (req, res) => {
  try {
    // ADR-164 Phase 3a: resolve the AI Agents table via the marker-aware helper
    // (earliest table id preserves the old `ORDER BY ut.id ASC LIMIT 1`).
    const agentTableIds = await getAgentTableIds();
    const table = agentTableIds.length ? { id: Math.min(...agentTableIds) } : null;

    if (!table) {
      return success(res, []);
    }

    // Get agents from table_rows
    const agents = await dbAll(`
      SELECT tr.id, tr.data
      FROM table_rows tr
      WHERE tr.table_id = ?
      ORDER BY tr.id
    `, [table.id]);

    // Parse and format agent data
    const formattedAgents = agents.map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return {
        id: row.id,
        name: data.name || 'Unnamed Agent',
        description: data.description || '',
        system_prompt: data.system_prompt || '',
        operator_id: data.operator_id || null
      };
    });

    success(res, formattedAgents);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get AI agents');
    badRequest(res, 'Failed to get AI agents');
  }
});

// Legacy: GET /ai/providers (via universal tables)
router.get('/ai/providers', async (req, res) => {
  try {
    // Find AI Operators table through universal tables system
    const table = await dbGet(`
      SELECT ut.id
      FROM universal_tables ut
      WHERE ut.name = 'AI Operators' OR ut.name = 'ai_operators'
      ORDER BY ut.id ASC
      LIMIT 1
    `);

    if (!table) {
      return success(res, []);
    }

    // Get providers from table_rows
    const providers = await dbAll(`
      SELECT tr.id, tr.data
      FROM table_rows tr
      WHERE tr.table_id = ?
      ORDER BY tr.id
    `, [table.id]);

    // Parse and format provider data
    const formattedProviders = providers.map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return {
        id: row.id,
        name: data.name || 'Unnamed Provider',
        description: data.description || ''
      };
    });

    success(res, formattedProviders);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get AI providers');
    badRequest(res, 'Failed to get AI providers');
  }
});

// Legacy: GET /ai/templates - List AI templates
router.get('/ai/templates', async (req, res) => {
  try {
    const templates = await dbAll('SELECT * FROM labs_ai_templates ORDER BY name');
    success(res, templates);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get AI templates');
    badRequest(res, 'Failed to get AI templates');
  }
});

// Legacy: POST /ai/templates/:id/create-agent - Create agent from template
router.post('/ai/templates/:id/create-agent', async (req, res) => {
  try {
    const { id } = req.params;
    const { operator_id, custom_name } = req.body;

    const template = await dbGet('SELECT * FROM labs_ai_templates WHERE id = $1', [id]);
    if (!template) {
      return notFound(res, 'Template');
    }

    // ADR-164 Phase 3a: resolve the AI Agents table via the marker-aware helper
    // (earliest table id preserves the old `ORDER BY ut.id ASC LIMIT 1`).
    const agentTableIds = await getAgentTableIds();
    const table = agentTableIds.length ? { id: Math.min(...agentTableIds) } : null;

    if (!table) {
      return badRequest(res, 'AI Agents table not found');
    }

    // Parse settings and routing_config
    const settings = typeof template.settings === 'string'
      ? JSON.parse(template.settings)
      : template.settings || {};
    const routingConfig = typeof template.routing_config === 'string'
      ? JSON.parse(template.routing_config)
      : template.routing_config || {};

    // Create agent data
    const agentData = {
      name: custom_name || template.name,
      description: template.description,
      system_prompt: template.system_prompt,
      user_prompt: template.user_prompt_example,
      operator_id: operator_id || null,
      settings: {
        ...settings,
        routing_config: routingConfig,
        source_template: template.mindworkflow_id
      }
    };

    // Insert into table_rows
    const result = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
      VALUES ($1, $2, $3, datetime('now'), datetime('now'))
    `, [
      table.id,
      generateId('agent'),
      JSON.stringify(agentData)
    ]);

    const agentRowId = result.lastInsertRowid || result.insertId;

    // Update template reference
    if (agentRowId) {
      await dbRun('UPDATE labs_ai_templates SET ai_agent_id = $1 WHERE id = $2', [agentRowId, id]);
    }

    // Return the created agent
    const agent = {
      id: agentRowId,
      ...agentData
    };

    created(res, agent, 'Agent created from template');
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create agent from template');
    badRequest(res, 'Failed to create agent');
  }
});

// Legacy: POST /ai/templates/sync - Sync MindWorkflow templates
router.post('/ai/templates/sync', async (req, res) => {
  try {
    const mindworkflowTemplates = [
      {
        mindworkflow_id: 'planner_llm',
        name: 'Strategic Planner',
        category: 'text_to_text',
        description: 'Long-form reasoning model for planning multi-step creative pipelines',
        system_prompt: 'You are a senior creative strategist. Respond with numbered steps, each containing a goal, reasoning, and deliverable.',
        user_prompt_example: 'Draft a 5 step plan for launching a brand on social media.',
        settings: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.4 }),
        routing_config: JSON.stringify({ outputs: [{ id: 'text', type: 'text', enabled: true }] })
      },
      {
        mindworkflow_id: 'tone_refiner',
        name: 'Tone Refiner',
        category: 'text_to_text',
        description: 'Refines copy to match brand voice and tone guidelines',
        system_prompt: 'You are an expert copywriter. Refine the given text to match the specified tone.',
        settings: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.3 })
      },
      {
        mindworkflow_id: 'code_assistant',
        name: 'Code Assistant',
        category: 'text_to_text',
        description: 'Helps with code generation, review, and debugging',
        system_prompt: 'You are an expert developer. Help with code tasks.',
        settings: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2 })
      }
    ];

    let synced = 0;
    for (const tpl of mindworkflowTemplates) {
      const existing = await dbGet(
        'SELECT id FROM labs_ai_templates WHERE mindworkflow_id = $1',
        [tpl.mindworkflow_id]
      );

      if (!existing) {
        await dbRun(`
          INSERT INTO labs_ai_templates
          (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, settings, routing_config, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        `, [
          tpl.mindworkflow_id, tpl.name, tpl.category, tpl.description,
          tpl.system_prompt, tpl.user_prompt_example, tpl.settings, tpl.routing_config || '{}'
        ]);
        synced++;
      }
    }

    const templates = await dbAll('SELECT * FROM labs_ai_templates ORDER BY name');
    success(res, { synced, total: templates.length, templates });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to sync templates');
    badRequest(res, 'Failed to sync templates');
  }
});

export default router;
