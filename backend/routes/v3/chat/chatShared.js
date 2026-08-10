/**
 * Chat shared imports, constants, and utility functions.
 * Used by all chat controller modules.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { dbRun, dbGet, dbAll, isPostgres, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden, unauthorized } from '../../../utils/response.js';
import { paginateByBubbles, BUBBLE_PAGE_SIZE } from '../../../utils/bubblePagination.js';
import { isMessageRelevantToAgent } from '../../../services/chat/response-mode.js';
// ADR-116: Centralized mention/command parsers
import {
  parseMentions, parseDelegations, parseInvocationMentions, parseInvocationCommands,
  parseReferenceMentions, parseReferenceCommands, parseAgentCommands
} from '../../../services/chat/mention-parsers.js';
import { resolveAgentUser as _resolveAgentUserService } from '../../../services/agent-users.js';
import {
  resolveAgentProvider as sharedResolveAgentProvider,
  buildAgentSystemPrompt as sharedBuildAgentSystemPrompt,
  loadConversationHistory as sharedLoadConversationHistory,
  fetchBoundRowContext,
  fetchAgentSkills,
  detectProvider,
  getHistoryLimit as sharedGetHistoryLimit,
} from '../../../services/chat/agent-execution-shared.js';
// ADR-094: Agent tool loop extracted to shared service
import { agentLoop as executeAgentToolLoop, saveStepMessage, resolveAllowedTools, createAgentStatusPlaceholder, updateAgentStatus, finalizeAgentStatus, findExistingAgentStatus, resetAgentStatusForReuse } from '../../../services/AgentLoopService.js';
// Ticket #40813: Agent Activity logging to table 1701
import { logAgentActivity, logMessageSent, logAgentMentioned, logToolUsed, logAgentError, logTaskCompleted } from '../../../services/AgentActivityLogger.js';
// Strategy B: Async agent dispatch for claude-code provider agents
import { createAndDispatchJob, getJobsForConversation, cancelJob } from '../../../services/AgentJobService.js';
// Ticket #74075: Tool Approval Flow — approve/reject tool executions
import {
  approveToolExecution, rejectToolExecution, getPendingApprovals,
  getApprovalRules, updateApprovalRule
} from '../../../services/ToolApprovalService.js';
// ADR-110: Auto-Summary trigger + context injection
import {
  triggerAutoSummaryIfNeeded,
  buildAIContext,
  parseAutoSummarySettings,
  resolveAutoSummaryModel,
  generateSummaryPrompt,
  searchSimilarSummaries,
  parseVectorSearchSettings,
} from '../../../services/chatChunkingService.js';
import { executeSimpleAI } from '../../../services/labs/ai-execution-service.js';
// ADR-077 Task #11: Agent chain status endpoint
import ChainHandoffService from '../../../services/ChainHandoffService.js';
// Bug fix: Per-conversation agent queue to prevent message interleaving
import conversationLock from '../../../services/ConversationLockService.js';
// ADR-077 Task #7: Auto-update ticket status when agent writes status directive
import { parseStatusDirective, STATE_MAP as TICKET_STATE_MAP, TRANSITIONS as TICKET_TRANSITIONS } from '../tickets.js';

const TICKETS_TABLE_ID_CHAT = 1708; // Mirror of TICKETS_TABLE_ID in tickets.js

// Bug fix: Base URL for constructing absolute attachment URLs for AI agents.
const BASE_URL_FOR_ATTACHMENTS = process.env.APP_URL || process.env.BASE_URL || '';

/**
 * Derive the base URL for attachments from the request if APP_URL is not set.
 */
function getAttachmentBaseUrl(req) {
  if (BASE_URL_FOR_ATTACHMENTS) return BASE_URL_FOR_ATTACHMENTS;
  const proto = req?.get?.('x-forwarded-proto') || req?.protocol || 'https';
  const host = req?.get?.('x-forwarded-host') || req?.get?.('host') || 'crm.hltrn.cc';
  return `${proto}://${host}`;
}

/**
 * Auth middleware - require authenticated user
 */
function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return unauthorized(res, 'Authentication required');
  }
  req.user.userId = req.user.id;
  next();
}

// ADR-093 D4: Load conversation history from DB.
const loadConversationHistory = sharedLoadConversationHistory;

export {
  // Express / DB
  Router, jwt, dbRun, dbGet, dbAll, isPostgres, safeJsonParse,
  apiLogger,
  success, created, error, badRequest, notFound, forbidden, unauthorized,
  paginateByBubbles, BUBBLE_PAGE_SIZE,
  // Mention parsers
  isMessageRelevantToAgent,
  parseMentions, parseDelegations, parseInvocationMentions, parseInvocationCommands,
  parseReferenceMentions, parseReferenceCommands, parseAgentCommands,
  _resolveAgentUserService,
  // Agent execution shared
  sharedResolveAgentProvider, sharedBuildAgentSystemPrompt, sharedLoadConversationHistory,
  fetchBoundRowContext, fetchAgentSkills, detectProvider, sharedGetHistoryLimit,
  loadConversationHistory,
  // Agent loop service
  executeAgentToolLoop, saveStepMessage, resolveAllowedTools,
  createAgentStatusPlaceholder, updateAgentStatus, finalizeAgentStatus,
  findExistingAgentStatus, resetAgentStatusForReuse,
  // Activity logging
  logAgentActivity, logMessageSent, logAgentMentioned, logToolUsed, logAgentError, logTaskCompleted,
  // Agent job service
  createAndDispatchJob, getJobsForConversation, cancelJob,
  // Tool approval
  approveToolExecution, rejectToolExecution, getPendingApprovals,
  getApprovalRules, updateApprovalRule,
  // Chunking / summaries
  triggerAutoSummaryIfNeeded, buildAIContext, parseAutoSummarySettings, resolveAutoSummaryModel,
  generateSummaryPrompt, searchSimilarSummaries, parseVectorSearchSettings,
  executeSimpleAI,
  // Chain / Lock / Tickets
  ChainHandoffService, conversationLock,
  parseStatusDirective, TICKET_STATE_MAP, TICKET_TRANSITIONS,
  // Constants
  TICKETS_TABLE_ID_CHAT, BASE_URL_FOR_ATTACHMENTS,
  // Utilities
  getAttachmentBaseUrl, requireAuth,
};
