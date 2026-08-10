/**
 * monitoring/router.js
 * Express router for MonitoringService endpoints
 */

import { Router } from 'express';
import { aiLogger } from '../../utils/logger.js';
import { initMonitoringTables } from './init.js';
import { ingestEvents, handleFeedback } from './ingestion.js';
import { getRuns, getRunById, getRunFeedback } from './queries.js';
import { getAnalyticsSummary, getTopModels, cleanOldData } from './analytics.js';

export function createMonitoringRouter() {
  const router = Router();

  // Initialize tables on router creation
  initMonitoringTables();

  /**
   * POST /runs/ingest
   * Lunary SDK compatible endpoint
   */
  router.post('/runs/ingest', async (req, res) => {
    try {
      const { events } = req.body;
      const result = await ingestEvents(events || []);
      res.json(result);
    } catch (error) {
      aiLogger.error({ err: error }, 'Ingest error');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /runs
   * List runs with filters
   */
  router.get('/runs', async (req, res) => {
    try {
      const result = await getRuns({
        type: req.query.type,
        status: req.query.status,
        userId: req.query.userId,
        search: req.query.search,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
        orderBy: req.query.orderBy,
        order: req.query.order
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /runs/:id
   * Get run details
   */
  router.get('/runs/:id', async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) {
        return res.status(404).json({ success: false, error: 'Run not found' });
      }
      res.json(run);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /runs/:id/feedback
   * Get feedback for a run
   */
  router.get('/runs/:id/feedback', async (req, res) => {
    try {
      const feedback = await getRunFeedback(req.params.id);
      res.json(feedback);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /runs/:id/feedback
   * Add feedback to a run
   */
  router.post('/runs/:id/feedback', async (req, res) => {
    try {
      await handleFeedback(req.params.id, req.body, req.body.overwrite);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /analytics/summary
   * Get analytics summary
   */
  router.get('/analytics/summary', async (req, res) => {
    try {
      const result = await getAnalyticsSummary({
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        userId: req.query.userId
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /analytics/models
   * Get top models
   */
  router.get('/analytics/models', async (req, res) => {
    try {
      const result = await getTopModels({
        limit: parseInt(req.query.limit) || 10,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * DELETE /runs/cleanup
   * Clean old data
   */
  router.delete('/runs/cleanup', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 90;
      const result = await cleanOldData(days);
      res.json({ success: true, cleaned: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
