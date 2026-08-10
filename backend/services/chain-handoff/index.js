/**
 * ChainHandoffService - Agent Chain Handoff Protocol
 *
 * ADR-077 / Ticket #40810: Implements the orchestrator's ability to dispatch
 * subtasks to specialist agents via CRM API.
 *
 * Protocol:
 * 1. Orchestrator creates a ticket (row in Tickets table) with assigned_to
 * 2. Assigned agent picks up ticket, updates state to in_progress
 * 3. On completion, agent sets state to done
 * 4. Chain metadata (chain_id, step, parent_ticket_id) tracks the flow
 * 5. Failed tasks remain in_progress with error details in 'why' field
 *
 * Tables:
 * - Tickets table (1708): Task dispatch and tracking
 * - Agent Activity table (1701): Activity logging
 * - AI Agents table (1784): Agent registry
 *
 * States: 24275=backlog, 24276=in_progress, 24277=review, 24278=done
 * Users: 18=Orchestrator, 19=DevRalph, 20=Developer, 21=Frontend, 22=FrontendQA, 23=TestRunner, 24=Architect, 51=Marketer, 53=Nikich
 */

import {
  STATE,
  AGENT_USERS,
  TICKETS_TABLE_ID,
  AGENT_ACTIVITY_TABLE_ID,
  AI_AGENTS_TABLE_ID,
  MAX_CHAIN_DEPTH,
  MAX_CHAIN_TASKS,
  SUPERVISOR_CONFIG,
  generateChainId,
  generateCycleGroupId,
} from './constants.js';

import {
  dispatchSubtask,
  dispatchChain,
} from './dispatch.js';

import {
  resolveAgentId,
  getAgentName,
  getStateName,
  getTicket,
  getChainTasks,
  getChainStatus,
  getAgentPendingTasks,
  buildHandoffMetadata,
  logActivity,
  updateTicketStatus,
} from './routing.js';

import {
  buildKnowledgeSummary,
  buildCycleKnowledgeEntry,
  formatSupervisorContext,
  triggerSupervisor,
  startNewCycle,
  autoEscalate,
} from './lifecycle.js';

// ===== CORE SERVICE =====

const ChainHandoffService = {
  // ----- DISPATCH -----
  dispatchSubtask,
  dispatchChain,

  // ----- STATUS TRACKING -----
  updateTicketStatus,

  // ----- TICKET QUERIES -----
  getTicket,

  // ----- CHAIN QUERIES -----
  getChainTasks,
  getChainStatus,
  getAgentPendingTasks,

  // ----- HANDOFF METADATA -----
  buildHandoffMetadata,

  // ----- ACTIVITY LOGGING -----
  logActivity,

  // ----- AGENT RESOLUTION -----
  resolveAgentId,
  getAgentName,
  getStateName,

  // ----- ADR-101 STAGE 2: KNOWLEDGE STACK -----
  buildKnowledgeSummary,
  buildCycleKnowledgeEntry,
  formatSupervisorContext,

  // ----- ADR-101 STAGE 3: SUPERVISOR ENGINE -----
  triggerSupervisor,
  startNewCycle,
  autoEscalate,

  // ----- EXPORTS -----
  STATE,
  AGENT_USERS,
  TICKETS_TABLE_ID,
  AGENT_ACTIVITY_TABLE_ID,
  AI_AGENTS_TABLE_ID,
  MAX_CHAIN_DEPTH,
  MAX_CHAIN_TASKS,
  SUPERVISOR_CONFIG,
  generateChainId,
  generateCycleGroupId,
};

export default ChainHandoffService;
export {
  ChainHandoffService,
  STATE,
  AGENT_USERS,
  TICKETS_TABLE_ID,
  AGENT_ACTIVITY_TABLE_ID,
  AI_AGENTS_TABLE_ID,
  SUPERVISOR_CONFIG,
  generateCycleGroupId,
};
