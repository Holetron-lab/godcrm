/**
 * ADR-093: Shared Agent Execution Services — Barrel re-export
 *
 * Extracted from agent-execution-shared.js into focused modules:
 *   - helpers.js: Constants, parsing, formatting utilities
 *   - provider-resolution.js: resolveAgentProvider(), detectProvider()
 *   - context-builders.js: Ticket, handoff, delegation, plan context helpers
 *   - system-prompt.js: buildAgentSystemPrompt()
 *   - conversation-history.js: loadConversationHistory(), fetchBoundRowContext(), fetchAgentSkills()
 *   - processing-state.js: setConversationProcessing(), handleManagePlan()
 */

// ─── Helpers & Constants ─────────────────────────────────────
export {
  DEFAULT_MAX_HISTORY,
  CONTEXT_LEVELS_DEFAULTS,
  BASE_CONTENT_TYPES,
  getHistoryLimit,
  resolveContextLevels,
  buildContentTypes,
  formatMessageByLevel,
  extractToolName,
  extractToolArgs,
  formatPlanAsContext,
} from './helpers.js';

// ─── Provider Resolution ─────────────────────────────────────
export {
  resolveAgentProvider,
  detectProvider,
} from './provider-resolution.js';

// ─── Context Builders ────────────────────────────────────────
export {
  isTicketsTable,
  buildTicketContext,
  buildDelegationInstructions,
  buildHandoffProtocol,
  buildGroupChatAwareness,
  fetchLatestPlan,
} from './context-builders.js';

// ─── System Prompt ───────────────────────────────────────────
export {
  buildAgentSystemPrompt,
} from './system-prompt.js';

// ─── Conversation History ────────────────────────────────────
export {
  loadConversationHistory,
  loadNewMessagesSince,
  fetchBoundRowContext,
  fetchAgentSkills,
} from './conversation-history.js';

// ─── Processing State ────────────────────────────────────────
export {
  setConversationProcessing,
  handleManagePlan,
} from './processing-state.js';

// ─── Sync-agent activity registry ────────────────────────────
export {
  SYNC_ACTIVITY_MAX_MS,
  markSyncActive,
  markSyncInactive,
  isSyncActive,
  activeSyncCount,
} from './sync-activity.js';
