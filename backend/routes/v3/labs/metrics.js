/**
 * Labs Metrics Routes
 * Global, per-lab, and per-node metrics endpoints
 */
import { Router } from 'express';
import { apiLogger } from '../../../utils/logger.js';
import { success, badRequest } from '../../../utils/response.js';
import {
  getLabMetricsSummary,
  getNodeMetrics,
  getGlobalMetrics,
  ensureMetricsTable
} from '../../../services/labs/metrics-service.js';

const router = Router();

/**
 * GET /api/v3/labs/metrics
 * Get global metrics across all labs
 */
router.get('/metrics', async (req, res) => {
  try {
    const { start_date, end_date, limit } = req.query;

    const options = {};
    if (start_date) options.startDate = new Date(start_date);
    if (end_date) options.endDate = new Date(end_date);
    if (limit) options.limit = parseInt(limit, 10);

    const metrics = await getGlobalMetrics(options);
    success(res, metrics);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get global metrics');
    badRequest(res, 'Failed to get global metrics');
  }
});

/**
 * GET /api/v3/labs/:labId/metrics
 * Get metrics summary for a specific lab
 */
router.get('/:labId/metrics', async (req, res) => {
  try {
    const { labId } = req.params;
    const { start_date, end_date } = req.query;

    const options = {};
    if (start_date) options.startDate = new Date(start_date);
    if (end_date) options.endDate = new Date(end_date);

    const metrics = await getLabMetricsSummary(labId, options);
    success(res, metrics);
  } catch (err) {
    apiLogger.error({ err, labId: req.params.labId }, 'Failed to get lab metrics');
    badRequest(res, 'Failed to get lab metrics');
  }
});

/**
 * GET /api/v3/labs/nodes/:nodeId/metrics
 * Get metrics for a specific node
 */
router.get('/nodes/:nodeId/metrics', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { limit } = req.query;

    const metrics = await getNodeMetrics(nodeId, limit ? parseInt(limit, 10) : 100);
    success(res, metrics);
  } catch (err) {
    apiLogger.error({ err, nodeId: req.params.nodeId }, 'Failed to get node metrics');
    badRequest(res, 'Failed to get node metrics');
  }
});

/**
 * POST /api/v3/labs/metrics/init
 * Initialize metrics table (admin only)
 */
router.post('/metrics/init', async (req, res) => {
  try {
    await ensureMetricsTable();
    success(res, { initialized: true, message: 'Metrics table initialized' });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to initialize metrics table');
    badRequest(res, 'Failed to initialize metrics table');
  }
});

export default router;
