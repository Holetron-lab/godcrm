/**
 * monitoring/analytics.js
 * Analytics and data management for MonitoringService
 */

import { dbGet, dbRun, dbAll } from '../../database/connection.js';
import { aiLogger } from '../../utils/logger.js';

/**
 * Get analytics summary
 */
export async function getAnalyticsSummary(options = {}) {
  const { startDate, endDate, userId } = options;

  const conditions = [];
  const values = [];

  if (startDate) {
    conditions.push('created_at >= ?');
    values.push(startDate);
  }

  if (endDate) {
    conditions.push('created_at <= ?');
    values.push(endDate);
  }

  if (userId) {
    conditions.push('user_id = ?');
    values.push(userId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Overall stats
  const stats = await dbGet(`
    SELECT
      COUNT(*) as totalRuns,
      COUNT(CASE WHEN status = 'success' THEN 1 END) as successfulRuns,
      COUNT(CASE WHEN status = 'error' THEN 1 END) as failedRuns,
      SUM(tokens_prompt) as totalPromptTokens,
      SUM(tokens_completion) as totalCompletionTokens,
      SUM(cost) as totalCost,
      AVG(duration_ms) as avgDurationMs,
      COUNT(DISTINCT user_id) as uniqueUsers
    FROM monitoring_runs
    ${whereClause}
  `, values);

  // By type breakdown
  const byType = await dbAll(`
    SELECT
      type,
      COUNT(*) as count,
      SUM(tokens_prompt + tokens_completion) as tokens,
      SUM(cost) as cost,
      AVG(duration_ms) as avgDuration
    FROM monitoring_runs
    ${whereClause}
    GROUP BY type
    ORDER BY count DESC
  `, values);

  // By model breakdown
  const byModel = await dbAll(`
    SELECT
      model,
      COUNT(*) as count,
      SUM(tokens_prompt + tokens_completion) as tokens,
      SUM(cost) as cost
    FROM monitoring_runs
    ${whereClause} ${whereClause ? 'AND' : 'WHERE'} model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
    LIMIT 10
  `, values);

  // Daily trend (last 30 days)
  const dailyTrend = await dbAll(`
    SELECT
      date(created_at) as date,
      COUNT(*) as runs,
      SUM(cost) as cost,
      SUM(tokens_prompt + tokens_completion) as tokens
    FROM monitoring_runs
    ${whereClause} ${whereClause ? 'AND' : 'WHERE'} created_at >= date('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `, values);

  return {
    summary: {
      totalRuns: stats?.totalRuns || 0,
      successfulRuns: stats?.successfulRuns || 0,
      failedRuns: stats?.failedRuns || 0,
      successRate: stats?.totalRuns ? ((stats.successfulRuns / stats.totalRuns) * 100).toFixed(1) : 0,
      totalTokens: (stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0),
      totalPromptTokens: stats?.totalPromptTokens || 0,
      totalCompletionTokens: stats?.totalCompletionTokens || 0,
      totalCost: stats?.totalCost?.toFixed(4) || '0.0000',
      avgDurationMs: Math.round(stats?.avgDurationMs || 0),
      uniqueUsers: stats?.uniqueUsers || 0
    },
    byType,
    byModel,
    dailyTrend
  };
}

/**
 * Get top models by usage
 */
export async function getTopModels(options = {}) {
  const { limit = 10, startDate, endDate } = options;

  const conditions = ['model IS NOT NULL'];
  const values = [];

  if (startDate) {
    conditions.push('created_at >= ?');
    values.push(startDate);
  }

  if (endDate) {
    conditions.push('created_at <= ?');
    values.push(endDate);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  return dbAll(`
    SELECT
      model,
      COUNT(*) as count,
      SUM(tokens_prompt) as promptTokens,
      SUM(tokens_completion) as completionTokens,
      SUM(cost) as cost,
      AVG(duration_ms) as avgDuration
    FROM monitoring_runs
    ${whereClause}
    GROUP BY model
    ORDER BY count DESC
    LIMIT ?
  `, [...values, limit]);
}

/**
 * Clean old data (retention policy)
 */
export async function cleanOldData(daysToKeep = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString();

  const result = await dbRun(`
    DELETE FROM monitoring_events WHERE created_at < ?
  `, [cutoff]);

  const runsResult = await dbRun(`
    DELETE FROM monitoring_runs WHERE created_at < ?
  `, [cutoff]);

  const feedbackResult = await dbRun(`
    DELETE FROM monitoring_feedback WHERE created_at < ?
  `, [cutoff]);

  aiLogger.info({ daysToKeep }, 'Cleaned monitoring data');
  return {
    events: result?.changes || 0,
    runs: runsResult?.changes || 0,
    feedback: feedbackResult?.changes || 0
  };
}
