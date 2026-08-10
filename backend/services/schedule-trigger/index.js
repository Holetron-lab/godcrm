/**
 * ScheduleTriggerService — barrel re-export
 *
 * Maintains backward compatibility: the default export is the singleton
 * instance, same as the original monolith file.
 */

import ScheduleTriggerService from './service.js';

// Singleton export — mirrors CalendarSyncScheduler pattern
const scheduleTriggerService = new ScheduleTriggerService();
export default scheduleTriggerService;
