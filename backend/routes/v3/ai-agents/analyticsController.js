/**
 * Analytics & Logs Controller
 * POST /process-prompt, GET /logs/:spaceId, GET /analytics/:spaceId
 */

import { Router } from 'express';
import { dbGet, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, badRequest } from '../../../utils/response.js';
import { safeParseJSON } from './shared.js';

const router = Router();

/**
 * POST /api/v3/ai/process-prompt
 */
router.post('/process-prompt', async (req, res) => {
  try {
    const { spaceId, promptTemplate, variables = {} } = req.body;
    if (!promptTemplate) return badRequest(res, 'Prompt template is required');

    const variablePattern = /\{\{(\w+)\.(\w+)\}\}/g;
    let processedPrompt = promptTemplate;
    const resolvedVariables = {};

    const matches = [...promptTemplate.matchAll(variablePattern)];

    for (const match of matches) {
      const [fullMatch, tableName, columnName] = match;
      const variableKey = `${tableName}.${columnName}`;

      if (variables[variableKey] !== undefined) {
        processedPrompt = processedPrompt.replace(fullMatch, String(variables[variableKey]));
        resolvedVariables[variableKey] = variables[variableKey];
        continue;
      }

      if (spaceId) {
        try {
          const table = await dbGet(`
            SELECT ut.id FROM universal_tables ut
            JOIN projects p ON ut.project_id = p.id
            WHERE p.space_id = ? AND (ut.name LIKE ? OR LOWER(ut.name) LIKE ?)
            LIMIT 1
          `, [spaceId, `%${tableName}%`, `%${tableName.toLowerCase()}%`]);

          if (table) {
            const row = await dbGet(`SELECT data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC LIMIT 1`, [table.id]);
            if (row) {
              const data = safeParseJSON(row.data, {});
              const value = data[columnName] || data[columnName.toLowerCase()];
              if (value !== undefined) {
                processedPrompt = processedPrompt.replace(fullMatch, String(value));
                resolvedVariables[variableKey] = value;
              }
            }
          }
        } catch (e) {
          apiLogger.warn({ err: e.message }, 'Failed to resolve variable ${variableKey}');
        }
      }
    }

    return success(res, {
      original: promptTemplate, processed: processedPrompt,
      variables: resolvedVariables,
      unresolvedCount: (processedPrompt.match(variablePattern) || []).length
    });
  } catch (err) {
    apiLogger.error({ err }, 'Error processing prompt');
    return error(res, 'PROMPT_PROCESS_ERROR', 'Failed to process prompt template', 500);
  }
});

/**
 * GET /api/v3/ai/logs/:spaceId
 */
router.get('/logs/:spaceId', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { limit = 50, offset = 0, agent, status } = req.query;

    const table = await dbGet(`
      SELECT ut.id FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ? AND (
        ut.name LIKE '%Run Logs%' OR ut.name LIKE '%Message Logs%' OR
        ut.name LIKE '%Chat History%' OR ut.name LIKE '%Logs%'
      )
      ORDER BY CASE
        WHEN ut.name LIKE '%Run Logs%' THEN 1
        WHEN ut.name LIKE '%Chat History%' THEN 2
        ELSE 3
      END LIMIT 1
    `, [spaceId]);

    if (!table) return success(res, { logs: [], total: 0 });

    let query = `SELECT * FROM table_rows WHERE table_id = ?`;
    const params = [table.id];

    if (agent) { query += ` AND JSON_EXTRACT(data, '$.agent') = ?`; params.push(agent); }
    if (status) { query += ` AND JSON_EXTRACT(data, '$.status') = ?`; params.push(status); }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const rows = await dbAll(query, params);
    const countResult = await dbGet(`SELECT COUNT(*) as total FROM table_rows WHERE table_id = ?`, [table.id]);

    const logs = rows.map(row => ({ id: row.id, ...safeParseJSON(row.data, {}), createdAt: row.created_at }));

    return success(res, { logs, total: countResult.total, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching AI logs');
    return error(res, 'FETCH_LOGS_ERROR', 'Failed to fetch logs', 500);
  }
});

/**
 * GET /api/v3/ai/analytics/:spaceId
 */
router.get('/analytics/:spaceId', async (req, res) => {
  try {
    const { spaceId } = req.params;

    const table = await dbGet(`
      SELECT ut.id FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ? AND (
        ut.name LIKE '%Usage Analytics%' OR ut.name LIKE '%AI Analytics%' OR ut.name LIKE '%Аналитика%'
      ) LIMIT 1
    `, [spaceId]);

    if (!table) {
      const logsTable = await dbGet(`
        SELECT ut.id FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = ? AND (
          ut.name LIKE '%Run Logs%' OR ut.name LIKE '%Message Logs%' OR
          ut.name LIKE '%Chat History%' OR ut.name LIKE '%Logs%'
        )
        ORDER BY CASE
          WHEN ut.name LIKE '%Run Logs%' THEN 1
          WHEN ut.name LIKE '%Chat History%' THEN 2
          ELSE 3
        END LIMIT 1
      `, [spaceId]);

      if (!logsTable) return success(res, { analytics: [], summary: {} });

      const rows = await dbAll(`SELECT data FROM table_rows WHERE table_id = ?`, [logsTable.id]);
      const stats = { totalCalls: rows.length, totalTokens: 0, totalCost: 0, successRate: 0, avgResponseTime: 0 };
      let successCount = 0;
      let totalTime = 0;

      rows.forEach(row => {
        const data = safeParseJSON(row.data, {});
        stats.totalTokens += (data.tokens_in || 0) + (data.tokens_out || 0);
        stats.totalCost += data.cost || 0;
        if (data.status === 'success') successCount++;
        totalTime += data.response_time || 0;
      });

      stats.successRate = rows.length > 0 ? (successCount / rows.length) * 100 : 0;
      stats.avgResponseTime = rows.length > 0 ? totalTime / rows.length : 0;

      return success(res, { analytics: [], summary: stats });
    }

    const rows = await dbAll(`SELECT data FROM table_rows WHERE table_id = ?`, [table.id]);
    const analytics = rows.map(row => safeParseJSON(row.data, {}));

    const summary = analytics.reduce((acc, row) => {
      acc.totalCalls += row.calls || 0;
      acc.totalTokens += row.tokens_used || 0;
      acc.totalCost += row.cost || 0;
      acc.totalSuccessful += row.successful || 0;
      acc.totalErrors += row.errors || 0;
      return acc;
    }, { totalCalls: 0, totalTokens: 0, totalCost: 0, totalSuccessful: 0, totalErrors: 0 });

    summary.successRate = summary.totalCalls > 0 ? (summary.totalSuccessful / summary.totalCalls) * 100 : 0;

    return success(res, { analytics, summary });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching analytics');
    return error(res, 'FETCH_ANALYTICS_ERROR', 'Failed to fetch analytics', 500);
  }
});

export default router;
