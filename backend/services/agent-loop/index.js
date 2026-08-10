/**
 * agent-loop/index.js — Barrel re-export for AgentLoopService modules
 *
 * All public exports from the original AgentLoopService.js are re-exported here.
 */

export { saveStepMessage, getAnthropicText, getMaxOutputTokens, sanitizeToolResult } from './messages.js';
export { toAnthropicTools, injectToolContext, resolveAllowedTools } from './tools.js';
export {
  createAgentStatusPlaceholder,
  findExistingAgentStatus,
  resetAgentStatusForReuse,
  updateAgentStatus,
  finalizeAgentStatus
} from './status.js';
export { agentLoop, executeAgentToolLoop } from './loop.js';
