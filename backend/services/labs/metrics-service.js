/**
 * Labs Metrics Service
 * Tracks execution metrics, token usage, costs, and performance
 * @see ADR-043: Laboratories Feature - MindWorkflow Integration
 */
import { dbGet, dbAll, dbRun, sqlNow } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

/**
 * Cost per 1K tokens for different models (in USD)
 * Updated pricing as of 2026
 */
const MODEL_COSTS = {
  // OpenAI
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'chatgpt-4o-latest': { input: 0.005, output: 0.015 },
  
  // Anthropic
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  
  // Google
  'gemini-pro': { input: 0.00025, output: 0.0005 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.0-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.5-pro': { input: 0.00125, output: 0.005 },
  
  // Default fallback
  'default': { input: 0.001, output: 0.002 }
};

/**
 * Calculate cost for token usage
 * @param {string} model - Model name
 * @param {number} inputTokens - Input token count
 * @param {number} outputTokens - Output token count
 * @returns {number} Cost in USD
 */
export function calculateCost(model, inputTokens, outputTokens) {
  // Find matching model cost or use default
  let costs = MODEL_COSTS.default;
  
  // Sort entries by key length (longest first) to match more specific models first
  // e.g., 'gpt-4o-mini' should match before 'gpt-4o'
  const sortedEntries = Object.entries(MODEL_COSTS)
    .filter(([key]) => key !== 'default')
    .sort((a, b) => b[0].length - a[0].length);
  
  for (const [key, value] of sortedEntries) {
    if (model && model.toLowerCase().includes(key.toLowerCase())) {
      costs = value;
      break;
    }
  }
  
  const inputCost = (inputTokens / 1000) * costs.input;
  const outputCost = (outputTokens / 1000) * costs.output;
  
  return Math.round((inputCost + outputCost) * 1000000) / 1000000; // Round to 6 decimal places
}

/**
 * Metrics data structure
 * @typedef {Object} ExecutionMetrics
 * @property {string} labId - Lab ID
 * @property {string} nodeId - Node ID
 * @property {string} nodeType - Node type
 * @property {string} agentId - AI Agent ID (if applicable)
 * @property {string} model - Model used
 * @property {string} provider - Provider (openai, anthropic, google)
 * @property {number} inputTokens - Input tokens
 * @property {number} outputTokens - Output tokens
 * @property {number} totalTokens - Total tokens
 * @property {number} cost - Cost in USD
 * @property {number} executionTime - Execution time in ms
 * @property {boolean} success - Whether execution succeeded
 * @property {string} error - Error message if failed
 * @property {Date} timestamp - Execution timestamp
 */

/**
 * Log execution metrics to database
 * @param {ExecutionMetrics} metrics - Metrics to log
 * @returns {Promise<number>} Inserted row ID
 */
export async function logExecutionMetrics(metrics) {
  try {
    const {
      labId,
      nodeId,
      nodeType,
      agentId,
      model,
      provider,
      inputTokens = 0,
      outputTokens = 0,
      totalTokens = 0,
      cost = 0,
      executionTime = 0,
      success = true,
      error = null
    } = metrics;
    
    // Calculate cost if not provided
    const finalCost = cost || calculateCost(model, inputTokens, outputTokens);
    
    const result = await dbRun(`
      INSERT INTO labs_execution_metrics (
        lab_id, node_id, node_type, agent_id, model, provider,
        input_tokens, output_tokens, total_tokens, cost,
        execution_time_ms, success, error, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, ${sqlNow()}
      )
    `, [
      labId, nodeId, nodeType, agentId, model, provider,
      inputTokens, outputTokens, totalTokens, finalCost,
      executionTime, success, error
    ]);
    
    apiLogger.debug({
      labId,
      nodeId,
      model,
      totalTokens,
      cost: finalCost,
      executionTime
    }, 'Logged execution metrics');
    
    return result.lastInsertRowid || result.lastID;
  } catch (err) {
    apiLogger.error({ err, metrics }, 'Failed to log execution metrics');
    // Don't throw - metrics logging should not break execution
    return null;
  }
}

/**
 * Get metrics summary for a lab
 * @param {string} labId - Lab ID
 * @param {Object} options - Query options
 * @param {Date} options.startDate - Start date filter
 * @param {Date} options.endDate - End date filter
 * @returns {Promise<Object>} Metrics summary
 */
export async function getLabMetricsSummary(labId, options = {}) {
  try {
    const { startDate, endDate } = options;
    
    let query = `
      SELECT 
        COUNT(*) as total_executions,
        SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as successful_executions,
        SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as failed_executions,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost,
        AVG(execution_time_ms) as avg_execution_time,
        MIN(execution_time_ms) as min_execution_time,
        MAX(execution_time_ms) as max_execution_time,
        MIN(created_at) as first_execution,
        MAX(created_at) as last_execution
      FROM labs_execution_metrics
      WHERE lab_id = $1
    `;
    
    const params = [labId];
    
    if (startDate) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate.toISOString());
    }
    
    if (endDate) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(endDate.toISOString());
    }
    
    const summary = await dbGet(query, params);
    
    // Get breakdown by model
    const modelBreakdown = await dbAll(`
      SELECT 
        model,
        provider,
        COUNT(*) as executions,
        SUM(total_tokens) as tokens,
        SUM(cost) as cost,
        AVG(execution_time_ms) as avg_time
      FROM labs_execution_metrics
      WHERE lab_id = $1
      GROUP BY model, provider
      ORDER BY executions DESC
    `, [labId]);
    
    // Get breakdown by node type
    const nodeTypeBreakdown = await dbAll(`
      SELECT 
        node_type,
        COUNT(*) as executions,
        SUM(total_tokens) as tokens,
        SUM(cost) as cost,
        AVG(execution_time_ms) as avg_time
      FROM labs_execution_metrics
      WHERE lab_id = $1
      GROUP BY node_type
      ORDER BY executions DESC
    `, [labId]);
    
    return {
      summary: {
        totalExecutions: summary?.total_executions || 0,
        successfulExecutions: summary?.successful_executions || 0,
        failedExecutions: summary?.failed_executions || 0,
        successRate: summary?.total_executions > 0 
          ? ((summary.successful_executions / summary.total_executions) * 100).toFixed(2) + '%'
          : '0%',
        totalInputTokens: summary?.total_input_tokens || 0,
        totalOutputTokens: summary?.total_output_tokens || 0,
        totalTokens: summary?.total_tokens || 0,
        totalCost: summary?.total_cost || 0,
        avgExecutionTime: Math.round(summary?.avg_execution_time || 0),
        minExecutionTime: summary?.min_execution_time || 0,
        maxExecutionTime: summary?.max_execution_time || 0,
        firstExecution: summary?.first_execution,
        lastExecution: summary?.last_execution
      },
      byModel: modelBreakdown || [],
      byNodeType: nodeTypeBreakdown || []
    };
  } catch (err) {
    apiLogger.error({ err, labId }, 'Failed to get lab metrics summary');
    return {
      summary: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        successRate: '0%',
        totalTokens: 0,
        totalCost: 0,
        avgExecutionTime: 0
      },
      byModel: [],
      byNodeType: []
    };
  }
}

/**
 * Get metrics for a specific node
 * @param {string} nodeId - Node ID
 * @param {number} limit - Max records to return
 * @returns {Promise<Object>} Node metrics
 */
export async function getNodeMetrics(nodeId, limit = 100) {
  try {
    // Get summary
    const summary = await dbGet(`
      SELECT 
        COUNT(*) as total_executions,
        SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as successful,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost,
        AVG(execution_time_ms) as avg_time
      FROM labs_execution_metrics
      WHERE node_id = $1
    `, [nodeId]);
    
    // Get recent executions
    const recentExecutions = await dbAll(`
      SELECT 
        id, model, provider, input_tokens, output_tokens, total_tokens,
        cost, execution_time_ms, success, error, created_at
      FROM labs_execution_metrics
      WHERE node_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [nodeId, limit]);
    
    return {
      summary: {
        totalExecutions: summary?.total_executions || 0,
        successfulExecutions: summary?.successful || 0,
        totalTokens: summary?.total_tokens || 0,
        totalCost: summary?.total_cost || 0,
        avgExecutionTime: Math.round(summary?.avg_time || 0)
      },
      recentExecutions: recentExecutions || []
    };
  } catch (err) {
    apiLogger.error({ err, nodeId }, 'Failed to get node metrics');
    return {
      summary: { totalExecutions: 0, totalTokens: 0, totalCost: 0, avgExecutionTime: 0 },
      recentExecutions: []
    };
  }
}

/**
 * Get global metrics across all labs
 * @param {Object} options - Query options
 * @param {Date} options.startDate - Start date filter
 * @param {Date} options.endDate - End date filter
 * @param {number} options.limit - Limit for top lists
 * @returns {Promise<Object>} Global metrics
 */
export async function getGlobalMetrics(options = {}) {
  try {
    const { startDate, endDate, limit = 10 } = options;
    
    let dateFilter = '';
    const params = [];
    
    if (startDate) {
      dateFilter += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate.toISOString());
    }
    
    if (endDate) {
      dateFilter += ` AND created_at <= $${params.length + 1}`;
      params.push(endDate.toISOString());
    }
    
    // Overall summary
    const summary = await dbGet(`
      SELECT 
        COUNT(*) as total_executions,
        COUNT(DISTINCT lab_id) as unique_labs,
        COUNT(DISTINCT node_id) as unique_nodes,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost,
        AVG(execution_time_ms) as avg_time
      FROM labs_execution_metrics
      WHERE 1=1 ${dateFilter}
    `, params);
    
    // Top labs by usage
    const topLabs = await dbAll(`
      SELECT 
        lab_id,
        COUNT(*) as executions,
        SUM(total_tokens) as tokens,
        SUM(cost) as cost
      FROM labs_execution_metrics
      WHERE 1=1 ${dateFilter}
      GROUP BY lab_id
      ORDER BY executions DESC
      LIMIT $${params.length + 1}
    `, [...params, limit]);
    
    // Top models by usage
    const topModels = await dbAll(`
      SELECT 
        model,
        provider,
        COUNT(*) as executions,
        SUM(total_tokens) as tokens,
        SUM(cost) as cost
      FROM labs_execution_metrics
      WHERE 1=1 ${dateFilter}
      GROUP BY model, provider
      ORDER BY executions DESC
      LIMIT $${params.length + 1}
    `, [...params, limit]);
    
    // Daily usage trend (last 30 days)
    const dailyTrend = await dbAll(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as executions,
        SUM(total_tokens) as tokens,
        SUM(cost) as cost
      FROM labs_execution_metrics
      WHERE created_at >= datetime('now', '-30 days') ${dateFilter}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, params);
    
    return {
      summary: {
        totalExecutions: summary?.total_executions || 0,
        uniqueLabs: summary?.unique_labs || 0,
        uniqueNodes: summary?.unique_nodes || 0,
        totalTokens: summary?.total_tokens || 0,
        totalCost: summary?.total_cost || 0,
        avgExecutionTime: Math.round(summary?.avg_time || 0)
      },
      topLabs: topLabs || [],
      topModels: topModels || [],
      dailyTrend: dailyTrend || []
    };
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get global metrics');
    return {
      summary: { totalExecutions: 0, totalTokens: 0, totalCost: 0 },
      topLabs: [],
      topModels: [],
      dailyTrend: []
    };
  }
}

/**
 * Create metrics table if not exists
 * @returns {Promise<void>}
 */
export async function ensureMetricsTable() {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS labs_execution_metrics (
        id SERIAL PRIMARY KEY,
        lab_id VARCHAR(255) NOT NULL,
        node_id VARCHAR(255) NOT NULL,
        node_type VARCHAR(100),
        agent_id INTEGER,
        model VARCHAR(255),
        provider VARCHAR(100),
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cost DECIMAL(10, 6) DEFAULT 0,
        execution_time_ms INTEGER DEFAULT 0,
        success BOOLEAN DEFAULT true,
        error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes for common queries
    await dbRun(`
      CREATE INDEX IF NOT EXISTS idx_labs_metrics_lab_id 
      ON labs_execution_metrics(lab_id)
    `);
    
    await dbRun(`
      CREATE INDEX IF NOT EXISTS idx_labs_metrics_node_id 
      ON labs_execution_metrics(node_id)
    `);
    
    await dbRun(`
      CREATE INDEX IF NOT EXISTS idx_labs_metrics_created_at 
      ON labs_execution_metrics(created_at)
    `);
    
    apiLogger.info('Labs metrics table ensured');
  } catch (err) {
    apiLogger.error({ err }, 'Failed to ensure metrics table');
  }
}

export default {
  calculateCost,
  logExecutionMetrics,
  getLabMetricsSummary,
  getNodeMetrics,
  getGlobalMetrics,
  ensureMetricsTable,
  MODEL_COSTS
};
