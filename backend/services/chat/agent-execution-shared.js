/**
 * ADR-093: Shared Agent Execution Services
 *
 * Thin re-export wrapper. All implementation has been split into:
 *   backend/services/chat/agent-execution-shared/
 *     - helpers.js
 *     - provider-resolution.js
 *     - context-builders.js
 *     - system-prompt.js
 *     - conversation-history.js
 *     - processing-state.js
 *     - index.js (barrel)
 */

export {
  // Helpers & Constants
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
  // Provider Resolution
  resolveAgentProvider,
  detectProvider,
  // Context Builders
  isTicketsTable,
  buildTicketContext,
  buildDelegationInstructions,
  buildHandoffProtocol,
  fetchLatestPlan,
  // System Prompt
  buildAgentSystemPrompt,
  // Conversation History
  loadConversationHistory,
  loadNewMessagesSince,
  fetchBoundRowContext,
  fetchAgentSkills,
  // Processing State
  setConversationProcessing,
  handleManagePlan,
  // Sync-agent activity registry
  SYNC_ACTIVITY_MAX_MS,
  markSyncActive,
  markSyncInactive,
  isSyncActive,
  activeSyncCount,
} from './agent-execution-shared/index.js';
