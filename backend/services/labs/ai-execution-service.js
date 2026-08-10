/**
 * AI Execution Service for Labs
 *
 * Thin re-export wrapper. All implementation has been split into:
 *   backend/services/labs/ai-execution/
 *     - process-management.js
 *     - api-providers.js
 *     - cli-providers.js
 *     - execution.js
 *     - index.js (barrel)
 */

export {
  // Process Management
  killAllActiveProcesses,
  killOrphanMCPProcesses,
  getActiveProcessCount,
  getActiveProcessPids,
  // Main Execution
  executeAI,
  executeSimpleAI,
  // CLI Providers
  executeClaudeCode,
  executeCopilotCli,
  // Data Helpers
  getAgentDetails,
  getOperatorDetails,
  getApiKeyForOperator,
} from './ai-execution/index.js';

// Preserve default export for backward compatibility
export { default } from './ai-execution/index.js';
