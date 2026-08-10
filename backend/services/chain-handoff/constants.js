/**
 * ChainHandoffService — Constants Module
 *
 * STATE, AGENT_USERS, table IDs, supervisor config, chain limits,
 * ID generation, and assigned_to normalization.
 */

import { getPipelineConfig, DEFAULT_SPACE_ID } from '../pipeline-config.js';
import crypto from 'crypto';

// ===== CONSTANTS (Space 11 defaults — backward compatible) =====
// These module-level constants remain for backward compatibility.
// Internally, methods now use getPipelineConfig(space_id) for lookups.

const _defaultConfig = getPipelineConfig(DEFAULT_SPACE_ID);

const TICKETS_TABLE_ID = _defaultConfig.TICKETS_TABLE_ID;
const AGENT_ACTIVITY_TABLE_ID = _defaultConfig.AGENT_ACTIVITY_TABLE_ID;
const AI_AGENTS_TABLE_ID = _defaultConfig.AI_AGENTS_TABLE_ID;

const STATE = _defaultConfig.STATE;
const AGENT_USERS = _defaultConfig.AGENT_USERS;

// Set of all valid agent user IDs for fast lookup
const VALID_AGENT_USER_IDS = new Set(Object.values(AGENT_USERS));

/**
 * Mapping from Users-table row IDs (table 1782) to integer user IDs.
 *
 * The CRM UI stores the row_id from the related Users table (1782) in the
 * assigned_to select column.  These row_ids are NOT the same as the integer
 * user IDs that AgentWorkerService expects.  This map allows normalisation
 * at ticket-creation time so the correct value is always persisted.
 *
 * ADR-077 fix: prevents invisible tickets caused by SELECT_OPTION_ID mismatch.
 */
const USERS_TABLE_ROW_TO_USER_ID = _defaultConfig.USERS_TABLE_ROW_TO_USER_ID;

// Chain safety limits
const MAX_CHAIN_DEPTH = 10;
const MAX_CHAIN_TASKS = 20;
const CHAIN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours per task

// === ASSIGNED_TO NORMALIZATION ===
// All valid agent user IDs (from AGENT_USERS above).
const VALID_AGENT_IDS = new Set(Object.values(AGENT_USERS));

// Row-ID → user-ID mapping (backward compat — derived from default config)
const ROW_ID_TO_USER_ID = _defaultConfig.ROW_ID_TO_USER_ID || {};

// === ADR-101: Chain Supervisor Config (backward compat — derived from default config) ===
const SUPERVISOR_CONFIG = _defaultConfig.SUPERVISOR_CONFIG;

// ===== CHAIN ID GENERATION =====

/**
 * Generate a unique chain ID for tracking a handoff sequence.
 * Format: chain-{timestamp}-{random}
 */
function generateChainId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `chain-${ts}-${rand}`;
}

/**
 * Generate a unique cycle group ID for tracking supervisor cycles.
 * Format: cg-{timestamp}-{random}
 * ADR-101 Stage 3
 */
function generateCycleGroupId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `cg-${ts}-${rand}`;
}

/**
 * Normalise an assigned_to value to a valid integer agent user ID.
 *
 * Handles three problematic formats:
 *   1. Users-table row_id (e.g. 26283 → 19)
 *   2. String slug (e.g. "developer-ralph" → 19)
 *   3. String display name (e.g. "Frontend Developer" → 21)
 *
 * Returns the integer user_id if resolvable, or the original value otherwise.
 *
 * @param {number|string} value - Raw assigned_to value
 * @param {number} [space_id] - Space ID for per-space row_id mapping
 * @returns {number|string} Normalised integer user_id, or original value
 */
function normalizeAssignedTo(value, space_id) {
  if (value === null || value === undefined) return value;

  const cfg = getPipelineConfig(space_id);
  const agentUsers = cfg.AGENT_USERS;
  const validIds = new Set(Object.values(agentUsers));
  const rowToUser = cfg.USERS_TABLE_ROW_TO_USER_ID || {};

  // Already a valid agent user ID (integer)
  if (typeof value === 'number' && validIds.has(value)) return value;

  // Numeric value — check if it's a Users-table row_id that needs remapping
  const numVal = typeof value === 'number' ? value : parseInt(value, 10);
  if (!isNaN(numVal)) {
    // Check row_id → user_id mapping first
    if (rowToUser[numVal] !== undefined) {
      return rowToUser[numVal];
    }
    // Already a valid agent user ID as numeric string
    if (validIds.has(numVal)) return numVal;
    // Unknown numeric value — return as number
    return numVal;
  }

  // String slug or display name — delegate to resolveAgentId (defined later)
  // We can't call it here directly since it's a method on ChainHandoffService,
  // so we use the same mapping inline.
  const name = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slugMapping = {
    'orchestrator': agentUsers.ORCHESTRATOR,
    'architect': agentUsers.ARCHITECT,
    'developer': agentUsers.DEVELOPER,
    'developer-ralph': agentUsers.DEV_RALPH,
    'dev-ralph': agentUsers.DEV_RALPH,
    'frontend': agentUsers.FRONTEND,
    'frontend-developer': agentUsers.FRONTEND,
    'frontend-qa': agentUsers.FRONTEND_QA,
    'frontendqa': agentUsers.FRONTEND_QA,
    'test-runner': agentUsers.TEST_RUNNER,
    'table-architect': agentUsers.TABLE_ARCHITECT,
    'widget-developer': agentUsers.WIDGET_DEVELOPER,
    'document-agent': agentUsers.DOCUMENT_AGENT,
    'marketer': agentUsers.MARKETER,
    'nikich': agentUsers.NIKICH,
    'n': agentUsers.NIKICH,
    'fitness-coach': agentUsers.FITNESS_COACH,
    'sysadmin': agentUsers.SYSADMIN,
    'sys-admin': agentUsers.SYSADMIN,
  };

  // Also check for PES if the space config has it
  if (agentUsers.PES) {
    slugMapping['pes'] = agentUsers.PES;
  }

  return slugMapping[name] || value;
}

export {
  _defaultConfig,
  TICKETS_TABLE_ID,
  AGENT_ACTIVITY_TABLE_ID,
  AI_AGENTS_TABLE_ID,
  STATE,
  AGENT_USERS,
  VALID_AGENT_USER_IDS,
  USERS_TABLE_ROW_TO_USER_ID,
  MAX_CHAIN_DEPTH,
  MAX_CHAIN_TASKS,
  CHAIN_TIMEOUT_MS,
  VALID_AGENT_IDS,
  ROW_ID_TO_USER_ID,
  SUPERVISOR_CONFIG,
  generateChainId,
  generateCycleGroupId,
  normalizeAssignedTo,
};
