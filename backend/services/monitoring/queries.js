/**
 * monitoring/queries.js
 * Data retrieval queries for MonitoringService
 */

import { dbGet, dbAll } from '../../database/connection.js';
import { tryParseJSON } from './db-helpers.js';

/**
 * Get runs with filtering and pagination
 */
export async function getRuns(options = {}) {
  const {
    type,
    status,
    userId,
    parentRunId,
    search,
    startDate,
    endDate,
    limit = 50,
    offset = 0,
    orderBy = 'created_at',
    order = 'DESC'
  } = options;

  const conditions = [];
  const values = [];

  if (type) {
    conditions.push('type = ?');
    values.push(type);
  }

  if (status) {
    conditions.push('status = ?');
    values.push(status);
  }

  if (userId) {
    conditions.push('user_id = ?');
    values.push(userId);
  }

  if (parentRunId) {
    conditions.push('parent_run_id = ?');
    values.push(parentRunId);
  }

  if (search) {
    conditions.push('(name LIKE ? OR input LIKE ? OR output LIKE ?)');
    const searchTerm = `%${search}%`;
    values.push(searchTerm, searchTerm, searchTerm);
  }

  if (startDate) {
    conditions.push('created_at >= ?');
    values.push(startDate);
  }

  if (endDate) {
    conditions.push('created_at <= ?');
    values.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const validOrder = ['ASC', 'DESC'].includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
  const validOrderBy = ['created_at', 'ended_at', 'duration_ms', 'cost', 'tokens_prompt'].includes(orderBy) ? orderBy : 'created_at';

  // Get total count
  const countResult = await dbGet(`
    SELECT COUNT(*) as total FROM monitoring_runs ${whereClause}
  `, values);

  // Get runs
  const runs = await dbAll(`
    SELECT
      id,
      parent_run_id as parentRunId,
      type,
      name,
      status,
      input,
      output,
      error,
      tokens_prompt as tokensPrompt,
      tokens_completion as tokensCompletion,
      cost,
      duration_ms as durationMs,
      model,
      provider,
      user_id as userId,
      tags,
      metadata,
      created_at as createdAt,
      ended_at as endedAt
    FROM monitoring_runs
    ${whereClause}
    ORDER BY ${validOrderBy} ${validOrder}
    LIMIT ? OFFSET ?
  `, [...values, limit, offset]);

  // Parse JSON fields
  return {
    runs: runs.map(run => ({
      ...run,
      input: tryParseJSON(run.input),
      output: tryParseJSON(run.output),
      error: tryParseJSON(run.error),
      tags: tryParseJSON(run.tags),
      metadata: tryParseJSON(run.metadata)
    })),
    total: countResult?.total || 0,
    limit,
    offset
  };
}

/**
 * Get a single run by ID with all details
 */
export async function getRunById(runId) {
  const run = await dbGet(`
    SELECT
      id,
      parent_run_id as parentRunId,
      type,
      name,
      status,
      input,
      output,
      error,
      tokens_prompt as tokensPrompt,
      tokens_completion as tokensCompletion,
      cost,
      duration_ms as durationMs,
      model,
      provider,
      user_id as userId,
      user_props as userProps,
      tags,
      metadata,
      params,
      template_id as templateId,
      runtime,
      created_at as createdAt,
      ended_at as endedAt
    FROM monitoring_runs
    WHERE id = ?
  `, [runId]);

  if (!run) return null;

  // Get child runs
  const children = await dbAll(`
    SELECT id, type, name, status, duration_ms as durationMs
    FROM monitoring_runs
    WHERE parent_run_id = ?
    ORDER BY created_at ASC
  `, [runId]);

  // Get feedback
  const feedback = await dbAll(`
    SELECT score, thumbs, comment, data, created_at as createdAt
    FROM monitoring_feedback
    WHERE run_id = ?
  `, [runId]);

  return {
    ...run,
    input: tryParseJSON(run.input),
    output: tryParseJSON(run.output),
    error: tryParseJSON(run.error),
    userProps: tryParseJSON(run.userProps),
    tags: tryParseJSON(run.tags),
    metadata: tryParseJSON(run.metadata),
    params: tryParseJSON(run.params),
    children,
    feedback: feedback.map(f => ({
      ...f,
      data: tryParseJSON(f.data)
    }))
  };
}

/**
 * Get feedback for a run
 */
export async function getRunFeedback(runId) {
  const feedback = await dbAll(`
    SELECT score, thumbs, comment, data, created_at as createdAt
    FROM monitoring_feedback
    WHERE run_id = ?
    ORDER BY created_at DESC
  `, [runId]);

  return feedback.map(f => ({
    ...f,
    data: tryParseJSON(f.data)
  }));
}
