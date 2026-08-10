/**
 * Vector Embedding Controller
 * POST /vector/generate-cell, POST /vector/embed, POST /vector/search,
 * POST /vector/batch, GET /vector/agents
 */

import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.js';
import { dbGet, dbRun, dbAll, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, error } from '../../../utils/response.js';
import { safeParseJSON } from './shared.js';
import { resolveEmbeddingConfig, generateEmbedding, applyFormula } from './sharedEmbedding.js';

const router = Router();

/**
 * POST /vector/generate-cell
 */
router.post('/vector/generate-cell', authenticate, async (req, res) => {
  const { tableId, rowId, columnId, agentId } = req.body;
  const userId = req.user.id;

  try {
    const table = await dbGet(`
      SELECT t.*, p.space_id FROM universal_tables t
      JOIN projects p ON t.project_id = p.id
      WHERE t.id = ? AND p.owner_id = ?
    `, [tableId, userId]);

    if (!table) return notFound(res, 'Table not found or access denied');

    const column = await dbGet('SELECT * FROM table_columns WHERE table_id = ? AND id = ?', [tableId, columnId]);
    if (!column) return notFound(res, 'Column not found');
    if (column.type !== 'vector') return badRequest(res, 'Column is not a vector type');

    let row = await dbGet('SELECT * FROM table_rows WHERE table_id = ? AND id = ?', [tableId, rowId]);
    if (!row) row = await dbGet('SELECT * FROM table_rows WHERE table_id = ? AND base_id = ?', [tableId, rowId]);
    if (!row) return notFound(res, 'Row not found');

    const columns = await dbAll('SELECT id, column_name FROM table_columns WHERE table_id = ?', [tableId]);

    let rowData = {};
    if (table.data_source_id && table.source_table_name) {
      try {
        const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
        const dataSourceService = new DataSourceService();
        const originalId = row.base_id.split('_').pop();
        const externalRow = await dataSourceService.queryRowById(table.data_source_id, table.source_table_name, originalId);
        if (externalRow) {
          for (const col of columns) {
            if (externalRow[col.column_name] !== undefined) rowData[col.id] = externalRow[col.column_name];
          }
        }
      } catch (err) {
        apiLogger.debug({ context: 'Vector', data: err.message }, 'Failed to load from external source');
      }
    }

    if (Object.keys(rowData).length === 0) {
      try { rowData = safeParseJSON(row.data || '{}', {}); } catch (e) { rowData = {}; }
    }

    const rowDataByName = {};
    for (const col of columns) {
      if (rowData[col.id] !== undefined) rowDataByName[col.column_name] = rowData[col.id];
      else if (rowData[col.column_name] !== undefined) rowDataByName[col.column_name] = rowData[col.column_name];
    }

    let config = {};
    try { config = safeParseJSON(column.config || '{}', {}); } catch (e) { config = {}; }

    const vectorConfig = config.vector || {};
    const effectiveAgentId = agentId || vectorConfig.agent_id;
    const embeddingConfig = await resolveEmbeddingConfig(effectiveAgentId, table.space_id);

    if (!embeddingConfig.apiKey) return badRequest(res, 'No API key configured for embedding generation');

    let text = applyFormula(vectorConfig.formula || '', rowDataByName);
    if (!text) {
      text = Object.values(rowData).filter(v => typeof v === 'string' && v.length > 0).join(' ');
    }
    if (vectorConfig.prefix || vectorConfig.suffix) {
      text = `${vectorConfig.prefix || ''}${text}${vectorConfig.suffix || ''}`;
    }
    if (!text || text.trim().length === 0) return badRequest(res, 'No text content to generate embedding from');

    const embedding = await generateEmbedding(text, embeddingConfig.apiKey, embeddingConfig.model, embeddingConfig.baseUrl);

    const vectorValue = {
      text, embedding, generated_at: new Date().toISOString(),
      model: embeddingConfig.model, dimensions: embedding.length, agent: embeddingConfig.agentName
    };

    rowData[columnId] = vectorValue;
    await dbRun('UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(rowData), row.id]);

    return success(res, {
      result: {
        text, text_length: text.length, embedding_dimension: embedding.length,
        generated_at: vectorValue.generated_at, model: embeddingConfig.model, agent: embeddingConfig.agentName
      }
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Vector' }, 'Generation error');
    return error(res, 'VECTOR_GENERATION_ERROR', err.message || 'Failed to generate vector', 500);
  }
});

/**
 * POST /vector/embed
 */
router.post('/vector/embed', authenticate, async (req, res) => {
  const { text, agentId, spaceId } = req.body;
  if (!text || typeof text !== 'string') return badRequest(res, 'text is required');

  try {
    const embeddingConfig = await resolveEmbeddingConfig(agentId, spaceId);
    if (!embeddingConfig.apiKey) return badRequest(res, 'No API key configured');

    const embedding = await generateEmbedding(text, embeddingConfig.apiKey, embeddingConfig.model, embeddingConfig.baseUrl);

    return success(res, {
      result: { embedding, dimensions: embedding.length, model: embeddingConfig.model, agent: embeddingConfig.agentName }
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Vector' }, 'Embed error');
    return error(res, 'EMBED_ERROR', err.message, 500);
  }
});

/**
 * POST /vector/search
 */
router.post('/vector/search', authenticate, async (req, res) => {
  const { queryText, queryEmbedding, tableId, columnId, limit = 10, threshold = 0.4, agentId, spaceId } = req.body;
  const userId = req.user.id;

  try {
    let embedding = queryEmbedding;
    if (!embedding && queryText) {
      const embeddingConfig = await resolveEmbeddingConfig(agentId, spaceId);
      if (!embeddingConfig.apiKey) return badRequest(res, 'No API key configured');
      embedding = await generateEmbedding(queryText, embeddingConfig.apiKey, embeddingConfig.model, embeddingConfig.baseUrl);
    }
    if (!embedding) return badRequest(res, 'queryText or queryEmbedding is required');

    const table = await dbGet(`
      SELECT t.* FROM universal_tables t JOIN projects p ON t.project_id = p.id
      WHERE t.id = ? AND p.owner_id = ?
    `, [tableId, userId]);
    if (!table) return notFound(res, 'Table not found');

    const rows = await dbAll('SELECT id, base_id, data FROM table_rows WHERE table_id = ?', [tableId]);

    const cosineSimilarity = (vecA, vecB) => {
      if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
      const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
      const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
      const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
      return normA && normB ? dotProduct / (normA * normB) : 0;
    };

    const results = [];
    for (const row of rows) {
      try {
        const data = safeParseJSON(row.data || '{}', {});
        const vectorData = data[columnId];
        if (vectorData?.embedding) {
          const similarity = cosineSimilarity(embedding, vectorData.embedding);
          if (similarity >= threshold) {
            results.push({ row_id: row.id, base_id: row.base_id, similarity, text: vectorData.text, data });
          }
        }
      } catch (e) { /* Skip malformed rows */ }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return success(res, { results: results.slice(0, limit), total: results.length });
  } catch (err) {
    apiLogger.error({ err, context: 'Vector' }, 'Search error');
    return error(res, 'VECTOR_SEARCH_ERROR', err.message, 500);
  }
});

/**
 * POST /vector/batch
 */
router.post('/vector/batch', authenticate, async (req, res) => {
  const { tableId, columnId, rowIds, agentId } = req.body;
  const userId = req.user.id;

  if (!tableId || !columnId || !Array.isArray(rowIds)) return badRequest(res, 'tableId, columnId, and rowIds array are required');

  try {
    const table = await dbGet(`
      SELECT t.*, p.space_id FROM universal_tables t JOIN projects p ON t.project_id = p.id
      WHERE t.id = ? AND p.owner_id = ?
    `, [tableId, userId]);
    if (!table) return notFound(res, 'Table not found');

    const embeddingConfig = await resolveEmbeddingConfig(agentId, table.space_id);
    if (!embeddingConfig.apiKey) return badRequest(res, 'No API key configured');

    const columns = await dbAll('SELECT id, column_name FROM table_columns WHERE table_id = ?', [tableId]);
    const column = await dbGet('SELECT * FROM table_columns WHERE table_id = ? AND id = ?', [tableId, columnId]);

    let config = {};
    try { config = safeParseJSON(column?.config || '{}', {}); } catch (_e) { /* use default */ }
    const vectorConfig = config.vector || {};

    const results = { success: 0, failed: 0, errors: [] };

    for (const rowId of rowIds) {
      try {
        let row = await dbGet('SELECT * FROM table_rows WHERE table_id = ? AND id = ?', [tableId, rowId]);
        if (!row) row = await dbGet('SELECT * FROM table_rows WHERE table_id = ? AND base_id = ?', [tableId, rowId]);
        if (!row) { results.failed++; results.errors.push({ rowId, error: 'Row not found' }); continue; }

        let rowData = {};
        try { rowData = safeParseJSON(row.data || '{}', {}); } catch (_e) { /* use default */ }

        const rowDataByName = {};
        for (const col of columns) {
          if (rowData[col.id] !== undefined) rowDataByName[col.column_name] = rowData[col.id];
          else if (rowData[col.column_name] !== undefined) rowDataByName[col.column_name] = rowData[col.column_name];
        }

        let text = applyFormula(vectorConfig.formula || '', rowDataByName);
        if (!text) text = Object.values(rowData).filter(v => typeof v === 'string' && v.length > 0).join(' ');
        if (vectorConfig.prefix || vectorConfig.suffix) text = `${vectorConfig.prefix || ''}${text}${vectorConfig.suffix || ''}`;

        if (!text || text.trim().length === 0) { results.failed++; results.errors.push({ rowId, error: 'No text content' }); continue; }

        const embedding = await generateEmbedding(text, embeddingConfig.apiKey, embeddingConfig.model, embeddingConfig.baseUrl);

        rowData[columnId] = {
          text, embedding, generated_at: new Date().toISOString(),
          model: embeddingConfig.model, dimensions: embedding.length, agent: embeddingConfig.agentName
        };

        await dbRun('UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(rowData), row.id]);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ rowId, error: err.message });
      }
    }

    return success(res, { results });
  } catch (err) {
    apiLogger.error({ err, context: 'Vector' }, 'Batch error');
    return error(res, 'VECTOR_BATCH_ERROR', err.message, 500);
  }
});

/**
 * GET /vector/agents
 */
router.get('/vector/agents', authenticate, async (req, res) => {
  const { spaceId } = req.query;

  try {
    let query = isPostgres()
      ? `SELECT tr.id, tr.data, ut.name as table_name, p.space_id FROM table_rows tr
         JOIN universal_tables ut ON tr.table_id = ut.id JOIN projects p ON ut.project_id = p.id
         WHERE (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%')
           AND (tr.data->>'agent_type' = 'embedding' OR tr.data->>'name' LIKE '%Embedding%')
           AND (tr.data->>'is_active' = '1' OR tr.data->>'is_active' = 'true' OR tr.data->>'status' = 'active')`
      : `SELECT tr.id, tr.data, ut.name as table_name, p.space_id FROM table_rows tr
         JOIN universal_tables ut ON tr.table_id = ut.id JOIN projects p ON ut.project_id = p.id
         WHERE (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%')
           AND (json_extract(tr.data, '$.agent_type') = 'embedding' OR json_extract(tr.data, '$.name') LIKE '%Embedding%')
           AND (json_extract(tr.data, '$.is_active') = '1' OR json_extract(tr.data, '$.is_active') = 'true' OR json_extract(tr.data, '$.status') = 'active')`;
    const params = [];

    if (spaceId) {
      query += isPostgres() ? ` AND p.space_id = $${params.length + 1}` : ' AND p.space_id = ?';
      params.push(spaceId);
    }
    query += ' ORDER BY tr.created_at ASC';

    const agents = await dbAll(query, params);
    const result = agents.map(row => {
      const data = safeParseJSON(row.data, {});
      return { id: row.id, name: data.name, model: data.model, icon: data.icon, color: data.color, space_id: row.space_id };
    });

    return success(res, { agents: result });
  } catch (err) {
    apiLogger.error({ err, context: 'Vector' }, 'List agents error');
    return error(res, 'LIST_AGENTS_ERROR', err.message, 500);
  }
});

export default router;
