/**
 * AgentWorkerService Tests — ADR-104
 *
 * Tests the async agent dispatch system:
 *   - findReadyTickets: query for backlog/assigned tickets
 *   - executeTicket: full lifecycle (assign → execute → review/error)
 *   - ensureTicketConversation: ticket-conversation binding
 *   - poll: concurrency limits, deduplication
 *   - buildTicketUserMessage / buildTicketSystemPrompt: context builders
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ===== MOCKS =====

const mockDbGet = vi.fn();
const mockDbRun = vi.fn();
const mockDbAll = vi.fn();

vi.mock('../../database/connection', () => ({
  dbGet: (...args) => mockDbGet(...args),
  dbRun: (...args) => mockDbRun(...args),
  dbAll: (...args) => mockDbAll(...args),
  isPostgres: () => false,
  safeJsonParse: (val, fallback) => {
    if (!val) return fallback;
    try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
  },
}));

vi.mock('../../utils/baseId', () => ({
  generateBaseId: () => 'TESTID01',
}));

vi.mock('../../utils/logger', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockAgentLoop = vi.fn();
const mockSaveStepMessage = vi.fn();
const mockResolveAllowedTools = vi.fn();

vi.mock('../AgentLoopService', () => ({
  agentLoop: (...args) => mockAgentLoop(...args),
  saveStepMessage: (...args) => mockSaveStepMessage(...args),
  resolveAllowedTools: (...args) => mockResolveAllowedTools(...args),
}));

const mockResolveProvider = vi.fn();
const mockBuildSystemPrompt = vi.fn();

const mockDetectProvider = vi.fn();

vi.mock('../chat/agent-execution-shared', () => ({
  resolveAgentProvider: (...args) => mockResolveProvider(...args),
  buildAgentSystemPrompt: (...args) => mockBuildSystemPrompt(...args),
  detectProvider: (...args) => mockDetectProvider(...args),
}));

const mockCreateAndDispatchJob = vi.fn();

vi.mock('../AgentJobService', () => ({
  createAndDispatchJob: (...args) => mockCreateAndDispatchJob(...args),
}));

vi.mock('../ChainHandoffService', () => {
  const STATE = {
    BACKLOG: 24275,
    ASSIGNED: 43436,
    IN_PROGRESS: 24276,
    REVIEW: 24277,
    CONTROL: 43437,
    REJECTED: 43438,
    DONE: 24278,
  };
  const AGENT_USERS = {
    ORCHESTRATOR: 18,
    DEV_RALPH: 19,
    DEVELOPER: 20,
    FRONTEND: 21,
    FRONTEND_QA: 22,
    TEST_RUNNER: 23,
    ARCHITECT: 24,
    TABLE_ARCHITECT: 25,
    WIDGET_DEVELOPER: 26,
    DOCUMENT_AGENT: 28,
  };
  return {
    default: {
      updateTicketStatus: vi.fn().mockResolvedValue({}),
      logActivity: vi.fn().mockResolvedValue(undefined),
      getAgentName: (id) => {
        const map = { 19: 'Developer Ralph', 20: 'Developer', 21: 'Frontend', 23: 'Test Runner', 24: 'Architect' };
        return map[id] || `Agent-${id}`;
      },
      resolveAgentId: vi.fn(),
    },
    STATE,
    AGENT_USERS,
  };
});

vi.mock('../agent-worker/constants', () => ({
  TICKETS_TABLE_ID: 1708,
  AI_AGENTS_TABLE_ID: 1784,
  SPACE_ID: 11,
  POLL_INTERVAL_MS: 5000,
  MAX_CONCURRENT: 3,
  EXECUTION_TIMEOUT_MS: 1800000,
  AGENT_USER_IDS: [18, 19, 20, 21, 22, 23, 24, 25, 26, 28],
  AGENT_USER_TO_ROW: {
    18: 31112, 19: 31113, 20: 33483, 21: 31114,
    22: 33485, 23: 31115, 24: 33491, 25: 33487,
    26: 33488, 28: 33489,
  },
  AGENT_SLUGS: ['orchestrator', 'architect', 'developer', 'developer-ralph', 'dev-ralph', 'frontend', 'frontend-qa', 'frontendqa', 'test-runner', 'test_runner', 'table-architect', 'widget-developer', 'document-agent'],
  normalizeAgentId: (val) => {
    if (typeof val === 'number') return val;
    const asInt = parseInt(val, 10);
    if (!isNaN(asInt) && String(asInt) === String(val)) return asInt;
    return val;
  },
}));

// Import after mocks
import { AgentWorkerService } from '../AgentWorkerService.js';
import { executeTicket, ensureTicketConversation, buildTicketUserMessage } from '../agent-worker/execution.js';
import ChainHandoffService, { STATE } from '../ChainHandoffService.js';

// ===== HELPERS =====

function makeTicketRow(id, data) {
  return {
    id,
    data: JSON.stringify({
      what: 'Test task',
      why: 'Testing',
      assigned_to: 19,
      state: STATE.BACKLOG,
      priority: 24274,
      type: 24269,
      ...data,
    }),
    created_at: new Date().toISOString(),
  };
}

// ===== TESTS =====

describe('AgentWorkerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AgentWorkerService._activeJobs.clear();
    AgentWorkerService._started = false;
    if (AgentWorkerService._interval) {
      clearInterval(AgentWorkerService._interval);
      AgentWorkerService._interval = null;
    }
    // Default mock returns
    mockDbRun.mockResolvedValue({ lastInsertRowid: 100 });
    mockDbGet.mockResolvedValue(null);
    mockDbAll.mockResolvedValue([]);
    mockAgentLoop.mockResolvedValue('Agent completed the task.');
    mockResolveProvider.mockResolvedValue({ apiKey: 'test-key', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false });
    mockDetectProvider.mockReturnValue({ isClaudeCode: false, isCopilot: false, isAnthropic: true });
    mockBuildSystemPrompt.mockReturnValue('You are a helpful agent.');
    mockSaveStepMessage.mockResolvedValue(1);
    mockCreateAndDispatchJob.mockResolvedValue({ jobId: 'job-123', id: 1 });
  });

  afterEach(() => {
    if (AgentWorkerService._interval) {
      clearInterval(AgentWorkerService._interval);
      AgentWorkerService._interval = null;
    }
    AgentWorkerService._started = false;
  });

  // ----- findReadyTickets -----

  describe('findReadyTickets()', () => {
    it('should query tickets table for backlog/assigned state', async () => {
      mockDbAll.mockResolvedValue([]);
      await AgentWorkerService.findReadyTickets();

      expect(mockDbAll).toHaveBeenCalledTimes(1);
      const query = mockDbAll.mock.calls[0][0];
      expect(query).toContain('table_id');
      expect(query).toContain(String(STATE.BACKLOG));
      expect(query).toContain(String(STATE.ASSIGNED));
    });

    it('should return ticket rows from the query', async () => {
      const rows = [makeTicketRow(1, {}), makeTicketRow(2, {})];
      mockDbAll.mockResolvedValue(rows);

      const result = await AgentWorkerService.findReadyTickets();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
    });
  });

  // ----- ensureTicketConversation -----

  describe('ensureTicketConversation()', () => {
    it('should return existing conversation if one is bound to ticket', async () => {
      mockDbGet.mockResolvedValue({ id: 42 });

      const convId = await ensureTicketConversation(123, 19, { what: 'Test' });
      expect(convId).toBe(42);
      // Should NOT have inserted a new conversation
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('should create new conversation if none exists', async () => {
      mockDbGet.mockResolvedValue(null); // no existing conversation
      mockDbRun.mockResolvedValue({ lastInsertRowid: 99 });

      const convId = await ensureTicketConversation(123, 19, { what: 'Build feature' });
      expect(convId).toBe(99);
      // Should have created a conversation
      const insertCall = mockDbRun.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO conversations');
      expect(insertCall[0]).toContain('ticket_chat');
    });

    it('should add agent as participant after creating conversation', async () => {
      mockDbGet.mockResolvedValue(null);
      mockDbRun.mockResolvedValue({ lastInsertRowid: 99 });

      await ensureTicketConversation(123, 19, { what: 'Test' });

      // Second dbRun call should be the participant insert
      expect(mockDbRun).toHaveBeenCalledTimes(2);
      const partCall = mockDbRun.mock.calls[1];
      expect(partCall[0]).toContain('conversation_participants');
    });
  });

  // ----- buildTicketUserMessage -----

  describe('buildTicketUserMessage()', () => {
    it('should include task title', () => {
      const msg = buildTicketUserMessage({ what: 'Implement login' });
      expect(msg).toContain('Implement login');
    });

    it('should include context when provided', () => {
      const msg = buildTicketUserMessage({ what: 'Task', why: 'We need auth' });
      expect(msg).toContain('We need auth');
      expect(msg).toContain('Context');
    });

    it('should include acceptance criteria when provided', () => {
      const msg = buildTicketUserMessage({
        what: 'Task',
        acceptance_criteria: '- [ ] Users can log in',
      });
      expect(msg).toContain('Acceptance Criteria');
      expect(msg).toContain('Users can log in');
    });

    it('should include chain info when provided', () => {
      const msg = buildTicketUserMessage({
        what: 'Task',
        _chain: { chain_id: 'chain-abc', step: 2, dispatched_by: 18 },
      });
      expect(msg).toContain('chain-abc');
      expect(msg).toContain('Step: 2');
    });
  });

  // ----- executeTicket -----

  describe('executeTicket()', () => {
    it('should transition ticket to in_progress', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19 });
      // Mock loadAgentConfig
      mockDbGet.mockResolvedValueOnce(null) // findTicketConversation
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Developer Ralph', system_prompt: 'You are Ralph' }) }); // loadAgentConfig

      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });

      await executeTicket(ticket, AgentWorkerService._activeJobs);

      expect(ChainHandoffService.updateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: 1,
          new_state: STATE.IN_PROGRESS,
        })
      );
    });

    it('should create a bound conversation for the ticket', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19 });
      mockDbGet.mockResolvedValue(null); // no existing conversation
      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });

      // Agent config lookup returns a result on the right call
      mockDbGet.mockResolvedValueOnce(null) // findTicketConversation
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Developer Ralph' }) }); // loadAgentConfig (by row ID)

      await executeTicket(ticket, AgentWorkerService._activeJobs);

      // At least one INSERT INTO conversations
      const insertCalls = mockDbRun.mock.calls.filter(c => c[0].includes('INSERT INTO conversations'));
      expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should call executeAgentToolLoop with correct params', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19, what: 'Do the thing' });
      mockDbGet.mockResolvedValueOnce(null) // findTicketConversation
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Developer Ralph', system_prompt: 'Be Ralph' }) }); // loadAgentConfig

      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });

      await executeTicket(ticket, AgentWorkerService._activeJobs);

      expect(mockAgentLoop).toHaveBeenCalledTimes(1);
      const callParams = mockAgentLoop.mock.calls[0][0];
      expect(callParams.conversationId).toBe(50);
      expect(callParams.senderId).toBe(19);
      expect(callParams.userMessage).toContain('Do the thing');
    });

    it('should transition ticket to review on success', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19 });
      mockDbGet.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Developer Ralph' }) });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });

      await executeTicket(ticket, AgentWorkerService._activeJobs);

      // Last updateTicketStatus call should transition to REVIEW
      const reviewCall = ChainHandoffService.updateTicketStatus.mock.calls.find(
        c => c[0].new_state === STATE.REVIEW
      );
      expect(reviewCall).toBeDefined();
    });

    it('should save error to conversation on failure', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19 });
      mockDbGet.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Developer Ralph' }) });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });
      mockAgentLoop.mockRejectedValue(new Error('API key expired'));

      // findTicketConversation for error handling — returns the conversation
      mockDbGet.mockResolvedValueOnce({ id: 50 });

      await executeTicket(ticket, AgentWorkerService._activeJobs);

      // Should have saved an error message
      const errorSave = mockSaveStepMessage.mock.calls.find(
        c => c[1]?.content?.includes('error')
      );
      expect(errorSave).toBeDefined();
    });

    it('should dispatch async job for claude-code agents instead of executeAgentToolLoop', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19, what: 'Build table' });
      mockDbGet.mockResolvedValueOnce(null) // findTicketConversation
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Table Architect', system_prompt: 'You build tables' }) }); // loadAgentConfig

      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });
      // Override provider to claude-code
      mockResolveProvider.mockResolvedValue({ apiKey: null, model: 'claude-sonnet-4', provider: 'claude-code', isLocal: true });
      mockDetectProvider.mockReturnValue({ isClaudeCode: true, isCopilot: false, isAnthropic: false });

      await executeTicket(ticket, AgentWorkerService._activeJobs);

      // Should NOT have called executeAgentToolLoop
      expect(mockAgentLoop).not.toHaveBeenCalled();
      // Should have called createAndDispatchJob
      expect(mockCreateAndDispatchJob).toHaveBeenCalledTimes(1);
      const jobArgs = mockCreateAndDispatchJob.mock.calls[0][0];
      expect(jobArgs.conversationId).toBe(50);
      expect(jobArgs.agent.name).toBe('Developer Ralph'); // from ChainHandoffService.getAgentName(19)
      expect(jobArgs.messageContent).toContain('Build table');
    });

    it('should still call executeAgentToolLoop for non-claude-code agents', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19, what: 'Do the thing' });
      mockDbGet.mockResolvedValueOnce(null) // findTicketConversation
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Developer Ralph', system_prompt: 'Be Ralph' }) }); // loadAgentConfig

      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });
      // Ensure provider is anthropic (non-claude-code)
      mockResolveProvider.mockResolvedValue({ apiKey: 'test-key', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false });
      mockDetectProvider.mockReturnValue({ isClaudeCode: false, isCopilot: false, isAnthropic: true });

      await executeTicket(ticket, AgentWorkerService._activeJobs);

      // Should have called executeAgentToolLoop
      expect(mockAgentLoop).toHaveBeenCalledTimes(1);
      // Should NOT have called createAndDispatchJob
      expect(mockCreateAndDispatchJob).not.toHaveBeenCalled();
    });

    it('should stay in_progress after async claude-code dispatch (no REVIEW transition)', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19 });
      mockDbGet.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Table Architect' }) });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });
      mockResolveProvider.mockResolvedValue({ apiKey: null, model: 'claude-sonnet-4', provider: 'claude-code', isLocal: true });
      mockDetectProvider.mockReturnValue({ isClaudeCode: true, isCopilot: false, isAnthropic: false });

      await executeTicket(ticket, AgentWorkerService._activeJobs);

      // Claude-code path returns early — should NOT transition to REVIEW
      const reviewCall = ChainHandoffService.updateTicketStatus.mock.calls.find(
        c => c[0].new_state === STATE.REVIEW
      );
      expect(reviewCall).toBeUndefined();
    });

    it('should remove ticket from activeJobs after completion', async () => {
      const ticket = makeTicketRow(1, { assigned_to: 19 });
      mockDbGet.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ data: JSON.stringify({ name: 'Developer Ralph' }) });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });

      AgentWorkerService._activeJobs.set(1, { agentId: 19, startedAt: Date.now() });
      await executeTicket(ticket, AgentWorkerService._activeJobs);

      expect(AgentWorkerService._activeJobs.has(1)).toBe(false);
    });
  });

  // ----- poll -----

  describe('poll()', () => {
    it('should skip polling when MAX_CONCURRENT reached', async () => {
      // Fill up active jobs
      for (let i = 0; i < 3; i++) {
        AgentWorkerService._activeJobs.set(i, {
          agentId: 19,
          startedAt: Date.now(),
          promise: Promise.resolve(),
        });
      }

      await AgentWorkerService.poll();
      // Should NOT have queried for tickets
      expect(mockDbAll).not.toHaveBeenCalled();
    });

    it('should not re-execute tickets already in activeJobs', async () => {
      const tickets = [makeTicketRow(1, { assigned_to: 19 })];
      mockDbAll.mockResolvedValue(tickets);
      AgentWorkerService._activeJobs.set(1, {
        agentId: 19,
        startedAt: Date.now(),
        promise: Promise.resolve(),
      });

      await AgentWorkerService.poll();
      // Should have queried but NOT executed ticket 1
      expect(mockDbAll).toHaveBeenCalled();
      // activeJobs should still just have the one entry
      expect(AgentWorkerService._activeJobs.size).toBe(1);
    });
  });

  // ----- getStatus -----

  describe('getStatus()', () => {
    it('should return worker status with config', () => {
      const status = AgentWorkerService.getStatus();
      expect(status.started).toBe(false);
      expect(status.config).toHaveProperty('poll_interval_ms');
      expect(status.config).toHaveProperty('max_concurrent');
      expect(status.active_count).toBe(0);
    });

    it('should include active jobs info', () => {
      AgentWorkerService._activeJobs.set(42, {
        agentId: 19,
        startedAt: Date.now(),
        promise: Promise.resolve(),
      });

      const status = AgentWorkerService.getStatus();
      expect(status.active_count).toBe(1);
      expect(status.active_jobs[0].ticket_id).toBe(42);
      expect(status.active_jobs[0].agent_name).toBe('Developer Ralph');
    });
  });

  // ----- start / stop -----

  describe('lifecycle', () => {
    it('should set _started flag on start()', async () => {
      await AgentWorkerService.start();
      expect(AgentWorkerService._started).toBe(true);
      expect(AgentWorkerService._interval).not.toBeNull();
    });

    it('should ignore duplicate start() calls', async () => {
      await AgentWorkerService.start();
      const interval1 = AgentWorkerService._interval;
      await AgentWorkerService.start(); // duplicate
      expect(AgentWorkerService._interval).toBe(interval1);
    });

    it('should clear interval on stop()', async () => {
      await AgentWorkerService.start();
      await AgentWorkerService.stop();
      expect(AgentWorkerService._started).toBe(false);
      expect(AgentWorkerService._interval).toBeNull();
    });
  });
});
