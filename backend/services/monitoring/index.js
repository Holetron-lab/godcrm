/**
 * monitoring/index.js
 * Barrel export for MonitoringService
 */

export { initMonitoringTables } from './init.js';
export { ingestEvents, handleFeedback } from './ingestion.js';
export { getRuns, getRunById, getRunFeedback } from './queries.js';
export { getAnalyticsSummary, getTopModels, cleanOldData } from './analytics.js';
export { createMonitoringRouter } from './router.js';

// Default export for backward compatibility
import { initMonitoringTables } from './init.js';
import { ingestEvents } from './ingestion.js';
import { getRuns, getRunById, getRunFeedback } from './queries.js';
import { getAnalyticsSummary, getTopModels, cleanOldData } from './analytics.js';
import { createMonitoringRouter } from './router.js';

export default {
  initMonitoringTables,
  ingestEvents,
  getRuns,
  getRunById,
  getRunFeedback,
  getAnalyticsSummary,
  getTopModels,
  cleanOldData,
  createMonitoringRouter
};
