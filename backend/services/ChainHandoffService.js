/**
 * ChainHandoffService - Agent Chain Handoff Protocol
 *
 * Split into modules under ./chain-handoff/:
 *   - constants.js  — STATE, AGENT_USERS, table IDs, supervisor config
 *   - dispatch.js   — subtask dispatch logic
 *   - routing.js    — agent routing/selection, queries, activity logging
 *   - lifecycle.js  — knowledge stack, supervisor engine, cycle management
 *   - index.js      — barrel re-export
 */

export {
  default,
  ChainHandoffService,
  STATE,
  AGENT_USERS,
  TICKETS_TABLE_ID,
  AGENT_ACTIVITY_TABLE_ID,
  AI_AGENTS_TABLE_ID,
  SUPERVISOR_CONFIG,
  generateCycleGroupId,
} from './chain-handoff/index.js';
