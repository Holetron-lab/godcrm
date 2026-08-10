/**
 * Admin Upgrade Controller
 * POST /upgrade-agents-tables — Upgrade all Agents tables (ADR-091)
 */

import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.js';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, forbidden, error } from '../../../utils/response.js';

const router = Router();

/**
 * POST /api/v3/ai/upgrade-agents-tables
 * Upgrade all Agents tables to add missing columns (tags, vector, response_mode)
 * and backfill existing agent rows with response_mode default.
 * ADR-091 Phase 1 Task 2: response_mode on AI Agents table.
 * Admin only
 */
router.post('/upgrade-agents-tables', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    // Only admins can upgrade
    if (userRole !== 'admin' && userRole !== 'owner') {
      return forbidden(res, 'Admin access required');
    }

    apiLogger.info({ userId }, 'Upgrading all Agents tables');

    // Find all Agents tables — match various naming conventions
    const agentsTables = await dbAll(`
      SELECT ut.id, ut.name, p.name as project_name, s.name as space_name
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      JOIN spaces s ON p.space_id = s.id
      WHERE LOWER(ut.name) = 'agents'
        OR LOWER(ut.name) = 'ai agents'
        OR LOWER(ut.name) LIKE '%ai_agents%'
        OR ut.name LIKE '%Agents%'
        OR ut.name LIKE '%agents%'
    `);

    const results = [];

    for (const table of agentsTables) {
      try {
        // Get existing columns
        const existingColumns = await dbAll(
          'SELECT column_name FROM table_columns WHERE table_id = ?',
          [table.id]
        );
        const existingNames = new Set(existingColumns.map(c => c.column_name));

        // Get max order_index
        const maxOrderRow = await dbGet(
          'SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?',
          [table.id]
        );
        let nextOrder = (maxOrderRow?.max_order || 0) + 1;

        const addedColumns = [];

        // Check for tags column
        if (!existingNames.has('tags')) {
          const config = {
            icon: '🏷️',
            options: [
              { value: 'assistant', label: 'Assistant', color: '#3B82F6' },
              { value: 'builder', label: 'Builder', color: '#10B981' },
              { value: 'analyst', label: 'Analyst', color: '#8B5CF6' },
              { value: 'creative', label: 'Creative', color: '#F59E0B' },
              { value: 'code', label: 'Code', color: '#EF4444' },
              { value: 'data', label: 'Data', color: '#06B6D4' },
              { value: 'utility', label: 'Utility', color: '#6B7280' }
            ]
          };
          await dbRun(`
            INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
            VALUES (?, 'tags', 'Tags', 'multi_select', ?, 150, 0, ?, datetime('now'), datetime('now'))
          `, [table.id, JSON.stringify(config), nextOrder++]);
          addedColumns.push('tags');
        }

        // Check for vector column
        if (!existingNames.has('vector')) {
          const config = {
            icon: '🧬',
            formula: '{{name}} | {{description}} | {{system_prompt}}',
            agent_id: null,
            auto_generate: true
          };
          await dbRun(`
            INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
            VALUES (?, 'vector', 'Vector', 'vector', ?, 150, 0, ?, datetime('now'), datetime('now'))
          `, [table.id, JSON.stringify(config), nextOrder++]);
          addedColumns.push('vector');
        }

        // ADR-091 Phase 1 Task 2: Check for response_mode column
        if (!existingNames.has('response_mode')) {
          const config = {
            icon: '💬',
            options: [
              { value: 'always', label: 'Always respond' },
              { value: 'topic_only', label: 'Topic only' },
              { value: 'mention_only', label: 'Mention only' }
            ],
            defaultValue: 'mention_only'
          };
          await dbRun(`
            INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
            VALUES (?, 'response_mode', 'Response Mode', 'select', ?, 150, 0, ?, datetime('now'), datetime('now'))
          `, [table.id, JSON.stringify(config), nextOrder++]);
          addedColumns.push('response_mode');
        }

        // ADR-085: Check for group_chat_behavior column
        if (!existingNames.has('group_chat_behavior')) {
          const config = {
            icon: '👥',
            options: [
              { value: 'silent', label: 'Silent' },
              { value: 'topic_only', label: 'Topic only' },
              { value: 'respond_all', label: 'Respond to all' }
            ],
            defaultValue: 'silent'
          };
          await dbRun(`
            INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
            VALUES (?, 'group_chat_behavior', 'Group Chat Behavior', 'select', ?, 170, 0, ?, datetime('now'), datetime('now'))
          `, [table.id, JSON.stringify(config), nextOrder++]);
          addedColumns.push('group_chat_behavior');
        }

        // ADR-091: Backfill existing agent rows that lack response_mode in JSON data.
        // Default is 'mention_only' — backward compatible with ADR-078 solo/group logic.
        let backfilledRows = 0;
        const backfillResult = await dbRun(`
          UPDATE table_rows
          SET data = jsonb_set(data::jsonb, '{response_mode}', '"mention_only"')
          WHERE table_id = $1
            AND (data::jsonb ->> 'response_mode') IS NULL
        `, [table.id]);
        backfilledRows = backfillResult?.changes || 0;

        results.push({
          tableId: table.id,
          tableName: table.name,
          spaceName: table.space_name,
          addedColumns,
          backfilledRows,
          existingColumns: [...existingNames]
        });

        if (addedColumns.length > 0 || backfilledRows > 0) {
          apiLogger.info({ tableId: table.id, addedColumns, backfilledRows }, 'Upgraded Agents table');
        }
      } catch (error) {
        apiLogger.error({ err: error, tableId: table.id }, 'Failed to upgrade Agents table');
        results.push({
          tableId: table.id,
          error: error.message
        });
      }
    }

    return success(res, {
      upgraded: results.filter(r => (r.addedColumns?.length > 0) || (r.backfilledRows > 0)).length,
      total: agentsTables.length,
      results
    });
  } catch (err) {
    apiLogger.error({ err }, 'Error upgrading Agents tables');
    return error(res, 'UPGRADE_TABLES_ERROR', 'Failed to upgrade tables: ' + err.message, 500);
  }
});

export default router;
