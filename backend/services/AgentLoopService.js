/**
 * AgentLoopService.js — ADR-094: Shared Agent Tool Loop Engine
 *
 * Split into modules under ./agent-loop/. This file re-exports everything
 * for backward compatibility.
 */

export {
  saveStepMessage,
  getAnthropicText,
  getMaxOutputTokens,
  sanitizeToolResult,
  toAnthropicTools,
  injectToolContext,
  resolveAllowedTools,
  createAgentStatusPlaceholder,
  findExistingAgentStatus,
  resetAgentStatusForReuse,
  updateAgentStatus,
  finalizeAgentStatus,
  agentLoop,
  executeAgentToolLoop
} from './agent-loop/index.js';
