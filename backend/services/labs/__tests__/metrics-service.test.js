/**
 * Tests for Labs Metrics Service
 * @see ADR-043: Laboratories Feature - MindWorkflow Integration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateCost,
  logExecutionMetrics,
  getLabMetricsSummary,
  getNodeMetrics,
  getGlobalMetrics,
  ensureMetricsTable
} from '../metrics-service.js';

// Mock database functions
vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn(),
  dbAll: vi.fn(),
  dbRun: vi.fn(),
  sqlNow: vi.fn(() => 'CURRENT_TIMESTAMP')
}));

// Mock logger
vi.mock('../../../utils/logger.js', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}));

import { dbGet, dbAll, dbRun } from '../../../database/connection.js';

describe('Labs Metrics Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('calculateCost', () => {
    it('should calculate cost for GPT-4o model', () => {
      // GPT-4o: input $0.005/1K, output $0.015/1K
      const cost = calculateCost('gpt-4o', 1000, 500);
      // (1000/1000 * 0.005) + (500/1000 * 0.015) = 0.005 + 0.0075 = 0.0125
      expect(cost).toBe(0.0125);
    });

    it('should calculate cost for GPT-4o-mini model', () => {
      // GPT-4o-mini: input $0.00015/1K, output $0.0006/1K
      const cost = calculateCost('gpt-4o-mini', 2000, 1000);
      // (2000/1000 * 0.00015) + (1000/1000 * 0.0006) = 0.0003 + 0.0006 = 0.0009
      expect(cost).toBe(0.0009);
    });

    it('should calculate cost for Claude 3.5 Sonnet model', () => {
      // Claude 3.5 Sonnet: input $0.003/1K, output $0.015/1K
      const cost = calculateCost('claude-3.5-sonnet', 1000, 1000);
      // (1000/1000 * 0.003) + (1000/1000 * 0.015) = 0.003 + 0.015 = 0.018
      expect(cost).toBe(0.018);
    });

    it('should calculate cost for Claude 3 Opus model', () => {
      // Claude 3 Opus: input $0.015/1K, output $0.075/1K
      const cost = calculateCost('claude-3-opus', 500, 200);
      // (500/1000 * 0.015) + (200/1000 * 0.075) = 0.0075 + 0.015 = 0.0225
      expect(cost).toBe(0.0225);
    });

    it('should calculate cost for Gemini 2.0 Flash model', () => {
      // Gemini 2.0 Flash: input $0.000075/1K, output $0.0003/1K
      const cost = calculateCost('gemini-2.0-flash', 10000, 5000);
      // (10000/1000 * 0.000075) + (5000/1000 * 0.0003) = 0.00075 + 0.0015 = 0.00225
      expect(cost).toBe(0.00225);
    });

    it('should use default cost for unknown model', () => {
      // Default: input $0.001/1K, output $0.002/1K
      const cost = calculateCost('unknown-model-xyz', 1000, 1000);
      // (1000/1000 * 0.001) + (1000/1000 * 0.002) = 0.001 + 0.002 = 0.003
      expect(cost).toBe(0.003);
    });

    it('should handle zero tokens', () => {
      const cost = calculateCost('gpt-4o', 0, 0);
      expect(cost).toBe(0);
    });

    it('should handle null model gracefully', () => {
      const cost = calculateCost(null, 1000, 1000);
      // Should use default pricing
      expect(cost).toBe(0.003);
    });

    it('should match model names case-insensitively', () => {
      const cost1 = calculateCost('GPT-4O', 1000, 500);
      const cost2 = calculateCost('gpt-4o', 1000, 500);
      expect(cost1).toBe(cost2);
    });

    it('should round to 6 decimal places', () => {
      // Use values that would produce many decimal places
      const cost = calculateCost('gpt-4o', 333, 777);
      // Should be rounded to 6 decimal places
      expect(cost.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(6);
    });
  });

  describe('logExecutionMetrics', () => {
    it('should log metrics to database', async () => {
      dbRun.mockResolvedValue({ lastInsertRowid: 123 });

      const metrics = {
        labId: 'lab-001',
        nodeId: 'node-001',
        nodeType: 'ai_agent',
        agentId: 1,
        model: 'gpt-4o',
        provider: 'openai',
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        executionTime: 1500,
        success: true
      };

      const result = await logExecutionMetrics(metrics);

      expect(result).toBe(123);
      expect(dbRun).toHaveBeenCalledTimes(1);
      expect(dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO labs_execution_metrics'),
        expect.arrayContaining(['lab-001', 'node-001', 'ai_agent'])
      );
    });

    it('should calculate cost if not provided', async () => {
      dbRun.mockResolvedValue({ lastInsertRowid: 124 });

      const metrics = {
        labId: 'lab-002',
        nodeId: 'node-002',
        nodeType: 'ai_agent',
        model: 'gpt-4o',
        provider: 'openai',
        inputTokens: 1000,
        outputTokens: 500
      };

      await logExecutionMetrics(metrics);

      // Verify the cost was calculated (10th parameter)
      const callArgs = dbRun.mock.calls[0][1];
      expect(callArgs[9]).toBe(0.0125); // Calculated cost for gpt-4o
    });

    it('should use provided cost if given', async () => {
      dbRun.mockResolvedValue({ lastInsertRowid: 125 });

      const metrics = {
        labId: 'lab-003',
        nodeId: 'node-003',
        nodeType: 'ai_agent',
        model: 'gpt-4o',
        provider: 'openai',
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.05 // Custom cost
      };

      await logExecutionMetrics(metrics);

      const callArgs = dbRun.mock.calls[0][1];
      expect(callArgs[9]).toBe(0.05); // Should use provided cost
    });

    it('should handle database errors gracefully', async () => {
      dbRun.mockRejectedValue(new Error('Database error'));

      const metrics = {
        labId: 'lab-004',
        nodeId: 'node-004',
        nodeType: 'ai_agent',
        model: 'gpt-4o',
        provider: 'openai'
      };

      const result = await logExecutionMetrics(metrics);

      expect(result).toBeNull();
      // Should not throw
    });

    it('should log failed executions', async () => {
      dbRun.mockResolvedValue({ lastInsertRowid: 126 });

      const metrics = {
        labId: 'lab-005',
        nodeId: 'node-005',
        nodeType: 'ai_agent',
        model: 'gpt-4o',
        provider: 'openai',
        success: false,
        error: 'API rate limit exceeded'
      };

      await logExecutionMetrics(metrics);

      const callArgs = dbRun.mock.calls[0][1];
      expect(callArgs[11]).toBe(false); // success
      expect(callArgs[12]).toBe('API rate limit exceeded'); // error
    });
  });

  describe('getLabMetricsSummary', () => {
    it('should return metrics summary for a lab', async () => {
      dbGet.mockResolvedValue({
        total_executions: 100,
        successful_executions: 95,
        failed_executions: 5,
        total_input_tokens: 50000,
        total_output_tokens: 25000,
        total_tokens: 75000,
        total_cost: 1.5,
        avg_execution_time: 1200,
        min_execution_time: 500,
        max_execution_time: 3000,
        first_execution: '2026-01-01T00:00:00Z',
        last_execution: '2026-01-26T00:00:00Z'
      });

      dbAll.mockResolvedValueOnce([
        { model: 'gpt-4o', provider: 'openai', executions: 80, tokens: 60000, cost: 1.2, avg_time: 1100 },
        { model: 'claude-3.5-sonnet', provider: 'anthropic', executions: 20, tokens: 15000, cost: 0.3, avg_time: 1500 }
      ]).mockResolvedValueOnce([
        { node_type: 'ai_agent', executions: 100, tokens: 75000, cost: 1.5, avg_time: 1200 }
      ]);

      const result = await getLabMetricsSummary('lab-001');

      expect(result.summary.totalExecutions).toBe(100);
      expect(result.summary.successfulExecutions).toBe(95);
      expect(result.summary.failedExecutions).toBe(5);
      expect(result.summary.successRate).toBe('95.00%');
      expect(result.summary.totalTokens).toBe(75000);
      expect(result.summary.totalCost).toBe(1.5);
      expect(result.byModel).toHaveLength(2);
      expect(result.byNodeType).toHaveLength(1);
    });

    it('should handle empty results', async () => {
      dbGet.mockResolvedValue(null);
      dbAll.mockResolvedValue([]);

      const result = await getLabMetricsSummary('lab-empty');

      expect(result.summary.totalExecutions).toBe(0);
      expect(result.summary.successRate).toBe('0%');
      expect(result.byModel).toEqual([]);
      expect(result.byNodeType).toEqual([]);
    });

    it('should apply date filters', async () => {
      dbGet.mockResolvedValue({ total_executions: 50 });
      dbAll.mockResolvedValue([]);

      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-01-15');

      await getLabMetricsSummary('lab-001', { startDate, endDate });

      expect(dbGet).toHaveBeenCalledWith(
        expect.stringContaining('created_at >='),
        expect.arrayContaining(['lab-001', startDate.toISOString(), endDate.toISOString()])
      );
    });

    it('should handle database errors gracefully', async () => {
      dbGet.mockRejectedValue(new Error('Database error'));

      const result = await getLabMetricsSummary('lab-error');

      expect(result.summary.totalExecutions).toBe(0);
      expect(result.byModel).toEqual([]);
    });
  });

  describe('getNodeMetrics', () => {
    it('should return metrics for a specific node', async () => {
      dbGet.mockResolvedValue({
        total_executions: 50,
        successful: 48,
        total_tokens: 25000,
        total_cost: 0.5,
        avg_time: 1000
      });

      dbAll.mockResolvedValue([
        { id: 1, model: 'gpt-4o', provider: 'openai', input_tokens: 500, output_tokens: 200, total_tokens: 700, cost: 0.01, execution_time_ms: 1000, success: true, error: null, created_at: '2026-01-26T00:00:00Z' }
      ]);

      const result = await getNodeMetrics('node-001');

      expect(result.summary.totalExecutions).toBe(50);
      expect(result.summary.successfulExecutions).toBe(48);
      expect(result.summary.totalTokens).toBe(25000);
      expect(result.summary.totalCost).toBe(0.5);
      expect(result.recentExecutions).toHaveLength(1);
    });

    it('should respect limit parameter', async () => {
      dbGet.mockResolvedValue({ total_executions: 100 });
      dbAll.mockResolvedValue([]);

      await getNodeMetrics('node-001', 50);

      expect(dbAll).toHaveBeenCalledWith(
        expect.any(String),
        ['node-001', 50]
      );
    });

    it('should handle empty results', async () => {
      dbGet.mockResolvedValue(null);
      dbAll.mockResolvedValue([]);

      const result = await getNodeMetrics('node-empty');

      expect(result.summary.totalExecutions).toBe(0);
      expect(result.recentExecutions).toEqual([]);
    });
  });

  describe('getGlobalMetrics', () => {
    it('should return global metrics across all labs', async () => {
      dbGet.mockResolvedValue({
        total_executions: 1000,
        unique_labs: 10,
        unique_nodes: 50,
        total_tokens: 500000,
        total_cost: 10.5,
        avg_time: 1100
      });

      dbAll.mockResolvedValueOnce([
        { lab_id: 'lab-001', executions: 200, tokens: 100000, cost: 2.0 },
        { lab_id: 'lab-002', executions: 150, tokens: 75000, cost: 1.5 }
      ]).mockResolvedValueOnce([
        { model: 'gpt-4o', provider: 'openai', executions: 600, tokens: 300000, cost: 6.0 },
        { model: 'claude-3.5-sonnet', provider: 'anthropic', executions: 400, tokens: 200000, cost: 4.5 }
      ]).mockResolvedValueOnce([
        { date: '2026-01-26', executions: 50, tokens: 25000, cost: 0.5 },
        { date: '2026-01-25', executions: 45, tokens: 22500, cost: 0.45 }
      ]);

      const result = await getGlobalMetrics();

      expect(result.summary.totalExecutions).toBe(1000);
      expect(result.summary.uniqueLabs).toBe(10);
      expect(result.summary.uniqueNodes).toBe(50);
      expect(result.summary.totalTokens).toBe(500000);
      expect(result.summary.totalCost).toBe(10.5);
      expect(result.topLabs).toHaveLength(2);
      expect(result.topModels).toHaveLength(2);
      expect(result.dailyTrend).toHaveLength(2);
    });

    it('should apply date filters', async () => {
      dbGet.mockResolvedValue({ total_executions: 500 });
      dbAll.mockResolvedValue([]);

      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-01-15');

      await getGlobalMetrics({ startDate, endDate });

      expect(dbGet).toHaveBeenCalledWith(
        expect.stringContaining('created_at >='),
        expect.arrayContaining([startDate.toISOString(), endDate.toISOString()])
      );
    });

    it('should respect limit parameter', async () => {
      dbGet.mockResolvedValue({ total_executions: 1000 });
      dbAll.mockResolvedValue([]);

      await getGlobalMetrics({ limit: 5 });

      expect(dbAll).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([5])
      );
    });

    it('should handle database errors gracefully', async () => {
      dbGet.mockRejectedValue(new Error('Database error'));

      const result = await getGlobalMetrics();

      expect(result.summary.totalExecutions).toBe(0);
      expect(result.topLabs).toEqual([]);
      expect(result.topModels).toEqual([]);
    });
  });

  describe('ensureMetricsTable', () => {
    it('should create table and indexes', async () => {
      dbRun.mockResolvedValue({});

      await ensureMetricsTable();

      expect(dbRun).toHaveBeenCalledTimes(4); // 1 table + 3 indexes
      expect(dbRun).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS labs_execution_metrics')
      );
      expect(dbRun).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_labs_metrics_lab_id')
      );
      expect(dbRun).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_labs_metrics_node_id')
      );
      expect(dbRun).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_labs_metrics_created_at')
      );
    });

    it('should handle errors gracefully', async () => {
      dbRun.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(ensureMetricsTable()).resolves.not.toThrow();
    });
  });
});
