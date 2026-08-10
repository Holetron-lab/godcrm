// agent-worker/constants.js — Configuration, mappings, and slug resolution
import ChainHandoffService, { STATE, AGENT_USERS } from '../ChainHandoffService.js';

// ===== CONFIGURATION =====

const TICKETS_TABLE_ID = 1708;
const AI_AGENTS_TABLE_ID = 1784;
const SPACE_ID = 11;

const POLL_INTERVAL_MS = parseInt(process.env.AGENT_WORKER_POLL_MS || '5000', 10);
const MAX_CONCURRENT = parseInt(process.env.AGENT_WORKER_MAX_CONCURRENT || '3', 10);
const EXECUTION_TIMEOUT_MS = parseInt(process.env.AGENT_WORKER_TIMEOUT_MS || '1800000', 10); // 30 min

// Agent user IDs that the worker should pick up tickets for
const AGENT_USER_IDS = Object.values(AGENT_USERS);

// Map agent user ID → agent row ID in AI Agents table (1784)
const AGENT_USER_TO_ROW = {
  [AGENT_USERS.ORCHESTRATOR]: 31112,
  [AGENT_USERS.DEV_RALPH]: 31113,
  [AGENT_USERS.DEVELOPER]: 33483,
  [AGENT_USERS.FRONTEND]: 31114,
  [AGENT_USERS.FRONTEND_QA]: 33485,
  [AGENT_USERS.TEST_RUNNER]: 31115,
  [AGENT_USERS.ARCHITECT]: 33491,
  [AGENT_USERS.TABLE_ARCHITECT]: 33487,
  [AGENT_USERS.WIDGET_DEVELOPER]: 33488,
  [AGENT_USERS.DOCUMENT_AGENT]: 33489,
  [AGENT_USERS.MARKETER]: 44465,
  [AGENT_USERS.NIKICH]: 54430,
  [AGENT_USERS.FITNESS_COACH]: 75107, // Fitness Coach agent — user 54, row 75107
  [AGENT_USERS.SYSADMIN]: 33484, // SysAdmin agent — user 67, row 33484
};

/**
 * All string slugs that may appear in assigned_to for agent tickets.
 *
 * The orchestrator AI (and supervisor_decide tool) sometimes stores a string
 * slug like "orchestrator" or "developer-ralph" in the ticket's assigned_to
 * field instead of the integer user ID. This happens when resolveAgentId()
 * falls back to the raw string (returns null for an unknown slug) or when
 * tickets are created through paths that bypass slug resolution.
 *
 * findReadyTickets() and _recoverStuckTickets() include these slugs in the
 * SQL IN clause so those tickets are picked up. executeTicket() normalises
 * the raw value to an integer via normalizeAgentId() before proceeding.
 */
const AGENT_SLUGS = Object.keys(
  // Re-use the same slug→ID mapping that ChainHandoffService already maintains
  // so we never drift out of sync. We call resolveAgentId at build time once.
  Object.fromEntries(
    [
      'orchestrator',
      'architect',
      'developer',
      'developer-ralph',
      'dev-ralph',
      'frontend',
      'frontend-qa',
      'frontendqa',
      'test-runner',
      'test_runner',
      'table-architect',
      'widget-developer',
      'document-agent',
      'marketer',
      'nikich',
      'fitness-coach',
      'sysadmin',
    ].map(slug => [slug, slug])
  )
);

/**
 * Normalise an assigned_to value that may be a string slug or numeric string
 * to a proper integer agent user ID.  Returns the original value unchanged if
 * it is already a known integer ID or cannot be resolved.
 *
 * @param {string|number} value - Raw assigned_to from ticket data
 * @returns {number|string} Integer user ID, or original value if unresolvable
 */
function normalizeAgentId(value) {
  if (typeof value === 'number') return value;

  // Numeric string like "18" — cast to integer
  const asInt = parseInt(value, 10);
  if (!isNaN(asInt) && String(asInt) === String(value)) return asInt;

  // String slug — delegate to ChainHandoffService slug map
  const resolved = ChainHandoffService.resolveAgentId(value);
  if (resolved !== null) return resolved;

  // Unknown — return as-is so callers can surface a clear error
  return value;
}

export {
  TICKETS_TABLE_ID,
  AI_AGENTS_TABLE_ID,
  SPACE_ID,
  POLL_INTERVAL_MS,
  MAX_CONCURRENT,
  EXECUTION_TIMEOUT_MS,
  AGENT_USER_IDS,
  AGENT_USER_TO_ROW,
  AGENT_SLUGS,
  normalizeAgentId,
};
