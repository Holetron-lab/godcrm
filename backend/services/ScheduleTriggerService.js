/**
 * ScheduleTriggerService — thin wrapper
 *
 * All logic has been split into modules under ./schedule-trigger/:
 *   - action-executors.js — Action executor functions (webhook, notification, etc.)
 *   - cron.js             — Cron expression matching
 *   - logging.js          — Automation logging and stats helpers
 *   - service.js          — Main ScheduleTriggerService class
 *   - index.js            — barrel re-export (singleton)
 *
 * This file re-exports the singleton for backward compatibility.
 */

export { default } from './schedule-trigger/index.js';
