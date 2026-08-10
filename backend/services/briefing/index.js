/**
 * Briefing — barrel re-export
 *
 * Maintains backward compatibility: any import from the old
 * BriefingService.js will resolve to the same named exports.
 */

export {
  generateMorningBriefing,
  generateEveningCheckin,
  sendWellnessReminder,
  generateWellnessSchedule,
} from './generators.js';
