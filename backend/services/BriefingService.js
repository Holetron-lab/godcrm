/**
 * BriefingService — thin wrapper (ADR-119)
 *
 * All logic has been split into modules under ./briefing/.
 * This file re-exports everything to maintain backward compatibility.
 */

export {
  generateMorningBriefing,
  generateEveningCheckin,
  sendWellnessReminder,
  generateWellnessSchedule,
} from './briefing/generators.js';
