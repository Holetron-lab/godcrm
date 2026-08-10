/**
 * Setup Tables Controller
 * POST /setup-tables — Create AI tables in System Data project for a space
 */

import { Router } from 'express';
import { dbGet, dbRun } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, badRequest, error } from '../../../utils/response.js';
import { generateBaseId } from './shared.js';
import { getTableDefinitions, getDefaultAgents } from './setupTablesData.js';

const router = Router();

/**
 * POST /api/v3/ai/setup-tables
 */
router.post('/setup-tables', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { spaceId } = req.body;

    if (!spaceId) return badRequest(res, 'spaceId is required');

    apiLogger.debug({ context: 'AI Setup' }, `Creating AI tables for space ${spaceId} by user ${userId}`);

    // Step 1: Find or create System Data project
    let projectId = null;
    const existingProject = await dbGet(`
      SELECT id FROM projects
      WHERE space_id = ? AND (type = 'system_data' OR name = 'System Data')
      LIMIT 1
    `, [spaceId]);

    if (existingProject) {
      projectId = existingProject.id;
    } else {
      const result = await dbRun(`
        INSERT INTO projects (name, description, icon, space_id, type, owner_id, created_at, updated_at)
        VALUES ('System Data', 'System configuration and logs', '⚙️', ?, 'system_data', ?, datetime('now'), datetime('now'))
      `, [spaceId, userId]);
      projectId = result.lastInsertRowid;
    }

    // Step 2: Get table definitions
    const aiTables = getTableDefinitions();

    const createdTables = {};

    // Step 3: Create tables that don't exist
    for (const tableDef of aiTables) {
      const existing = await dbGet(`SELECT id FROM universal_tables WHERE project_id = ? AND name = ?`, [projectId, tableDef.name]);

      if (existing) {
        createdTables[tableDef.name] = { id: existing.id, existed: true };
        continue;
      }

      // ADR-164 Phase 3a: stamp the stable agent-table marker at birth so the
      // AI Agents table is marker-identifiable without the name convention.
      const tableResult = await dbRun(`
        INSERT INTO universal_tables (name, display_name, icon, project_id, table_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [tableDef.name, tableDef.name, tableDef.icon, projectId,
          tableDef.name === 'AI Agents' ? 'ai_agents' : null]);

      const tableId = tableResult.lastInsertRowid;
      createdTables[tableDef.name] = { id: tableId, existed: false };

      let orderIdx = 0;
      for (const col of tableDef.columns) {
        await dbRun(`
          INSERT INTO table_columns (table_id, column_name, display_name, type, is_required, config, order_index, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `, [tableId, col.name, col.name, col.type, col.isRequired ? 1 : 0, JSON.stringify(col.config || {}), orderIdx++]);
      }
    }

    // Step 4: Create default operators
    const operatorIds = {};
    if (createdTables['AI Operators'] && !createdTables['AI Operators'].existed) {
      const defaultOperators = [
        { name: 'OpenAI', provider: 'openai', api_url: 'https://api.openai.com/v1', status: 'active', description: 'OpenAI GPT models' },
        { name: 'Anthropic', provider: 'anthropic', api_url: 'https://api.anthropic.com/v1', status: 'active', description: 'Claude models' },
        { name: 'Google AI', provider: 'google', api_url: 'https://generativelanguage.googleapis.com/v1beta', status: 'active', description: 'Gemini models' },
        { name: 'OpenRouter', provider: 'openai', api_url: 'https://openrouter.ai/api/v1', status: 'active', description: 'Multi-provider router' },
        { name: 'Groq', provider: 'groq', api_url: 'https://api.groq.com/openai/v1', status: 'active', description: 'Fast inference' },
        { name: 'DeepSeek', provider: 'openai', api_url: 'https://api.deepseek.com/v1', status: 'active', description: 'DeepSeek models' },
        { name: 'Local Ollama', provider: 'local', api_url: 'http://localhost:11434/v1', status: 'inactive', description: 'Local Ollama server' }
      ];

      for (const op of defaultOperators) {
        const result = await dbRun(`
          INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
        `, [createdTables['AI Operators'].id, generateBaseId('op'), JSON.stringify(op)]);
        operatorIds[op.name] = result.lastInsertRowid;
      }
    }

    // Create default AI Agents
    if (createdTables['AI Agents'] && !createdTables['AI Agents'].existed) {
      const defaultAgents = getDefaultAgents(operatorIds);
      for (const agent of defaultAgents) {
        await dbRun(`
          INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
        `, [createdTables['AI Agents'].id, generateBaseId('agent'), JSON.stringify(agent)]);
      }
    }

    // Create automations for AI Models table
    if (createdTables['AI Models'] && !createdTables['AI Models'].existed) {
      const defaultAutomations = [
        { name: 'Синхронизация моделей Anthropic', description: 'Автоматическая синхронизация списка моделей Anthropic', trigger_type: 'schedule', trigger_config: JSON.stringify({ cron: '0 3 * * *' }), action_type: 'webhook', action_config: JSON.stringify({ url: '/api/v3/ai/sync-models', method: 'POST', body: { provider: 'anthropic' } }), is_active: 1 },
        { name: 'Синхронизация моделей OpenAI', description: 'Автоматическая синхронизация списка моделей OpenAI', trigger_type: 'schedule', trigger_config: JSON.stringify({ cron: '0 3 * * *' }), action_type: 'webhook', action_config: JSON.stringify({ url: '/api/v3/ai/sync-models', method: 'POST', body: { provider: 'openai' } }), is_active: 1 }
      ];

      for (const auto of defaultAutomations) {
        await dbRun(`
          INSERT INTO automations (name, description, table_id, trigger_type, trigger_config, action_type, action_config, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `, [auto.name, auto.description, createdTables['AI Models'].id, auto.trigger_type, auto.trigger_config, auto.action_type, auto.action_config, auto.is_active]);
      }
    }

    // Create default Storage Provider
    if (createdTables['Storage Providers'] && !createdTables['Storage Providers'].existed) {
      await dbRun(`
        INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `, [createdTables['Storage Providers'].id, generateBaseId('storage'), JSON.stringify({
        name: 'Local Storage', type: 'local', is_default: true, is_enabled: true,
        config: JSON.stringify({ basePath: '/uploads' }),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      })]);
    }

    // Create default AI Tools
    if (createdTables['AI Tools'] && !createdTables['AI Tools'].existed) {
      const { getDefaultTools } = await import('./setupTablesData.js');
      const defaultTools = getDefaultTools();
      for (const tool of defaultTools) {
        await dbRun(`
          INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
        `, [createdTables['AI Tools'].id, generateBaseId('tool'), JSON.stringify(tool)]);
      }
    }

    return success(res, { tables: createdTables, projectId });
  } catch (err) {
    apiLogger.error({ err, context: 'AI Setup' }, 'Error');
    return error(res, 'SETUP_TABLES_ERROR', 'Failed to setup AI tables', 500);
  }
});

export default router;
