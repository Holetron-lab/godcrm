/**
 * AI Execution Service for Labs — Barrel re-export
 *
 * Extracted from ai-execution-service.js into focused modules:
 *   - process-management.js: Child process tracking, kill functions
 *   - api-providers.js: OpenAI, Anthropic, Google execution + data helpers
 *   - cli-providers.js: Claude Code CLI, GitHub Copilot CLI execution
 *   - execution.js: Main executeAI(), executeSimpleAI() orchestrators
 */

// ─── Process Management ──────────────────────────────────────
export {
  killProcessTree,
  killAllActiveProcesses,
  killOrphanMCPProcesses,
  getActiveProcessCount,
  getActiveProcessPids,
  trackChildProcess,
  untrackChildProcess,
} from './process-management.js';

// ─── API Providers & Data Helpers ────────────────────────────
export {
  getApiKeyForOperator,
  getOperatorDetails,
  getAgentDetails,
  executeOpenAI,
  executeAnthropic,
  executeGoogle,
} from './api-providers.js';

// ─── CLI Providers ───────────────────────────────────────────
export {
  executeClaudeCode,
  executeCopilotCli,
} from './cli-providers.js';

// ─── Main Execution ──────────────────────────────────────────
export {
  executeAI,
  executeSimpleAI,
} from './execution.js';

// ─── Default Export (backward compatibility) ─────────────────
import { executeAI, executeSimpleAI } from './execution.js';
import { executeClaudeCode, executeCopilotCli } from './cli-providers.js';
import { getAgentDetails, getOperatorDetails, getApiKeyForOperator } from './api-providers.js';

export default {
  executeAI,
  executeSimpleAI,
  executeClaudeCode,
  executeCopilotCli,
  getAgentDetails,
  getOperatorDetails,
  getApiKeyForOperator
};
