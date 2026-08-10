/**
 * Tickets API Tests — ADR-098: Ticket Status Endpoint
 *
 * Tests for:
 *   PATCH /api/v3/tickets/:id/status — State machine validated status change
 *   GET   /api/v3/tickets/:id         — Ticket with allowed transitions
 *   POST  /api/v3/tickets/dispatch     — Dispatch subtask
 *   GET   /api/v3/tickets/chains/:chainId — Chain progress
 *   GET   /api/v3/tickets/agents/me/tasks — Agent pending tasks
 *   POST  /api/v3/tickets/:id/message  — Send ticket chat message
 *   POST  /api/v3/tickets/:id/invoke-agent — Invoke agent to work on ticket (ADR-077 Task #12)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ===== MOCKS =====

const mockGetTicket = vi.fn();
const mockUpdateTicketStatus = vi.fn();
const mockDispatchSubtask = vi.fn();
const mockDispatchChain = vi.fn();
const mockGetChainStatus = vi.fn();
const mockGetAgentPendingTasks = vi.fn();
const mockResolveAgentId = vi.fn();
const mockLogActivity = vi.fn();

vi.mock('../../../services/ChainHandoffService.js', () => ({
  default: {
    getTicket: (...args) => mockGetTicket(...args),
    updateTicketStatus: (...args) => mockUpdateTicketStatus(...args),
    dispatchSubtask: (...args) => mockDispatchSubtask(...args),
    dispatchChain: (...args) => mockDispatchChain(...args),
    getChainStatus: (...args) => mockGetChainStatus(...args),
    getAgentPendingTasks: (...args) => mockGetAgentPendingTasks(...args),
    resolveAgentId: (...args) => mockResolveAgentId(...args),
    logActivity: (...args) => mockLogActivity(...args),
  },
}));

const mockDbGet = vi.fn();
const mockDbRun = vi.fn();
const mockDbAll = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => mockDbGet(...args),
  dbRun: (...args) => mockDbRun(...args),
  dbAll: (...args) => mockDbAll(...args),
  isPostgres: () => false,
  safeJsonParse: (v, d) => {
    try { return typeof v === 'string' ? JSON.parse(v) : (v || d); }
    catch { return d; }
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockResolveAgentUser = vi.fn();
vi.mock('../../../services/agent-users.js', () => ({
  resolveAgentUser: (...args) => mockResolveAgentUser(...args),
}));

const mockCreateAndDispatchJob = vi.fn();
vi.mock('../../../services/AgentJobService.js', () => ({
  createAndDispatchJob: (...args) => mockCreateAndDispatchJob(...args),
}));

// Import after mocks
import ticketsRoutes, { STATE_MAP, STATE_NAMES, TRANSITIONS, SUPERVISOR_AGENT_IDS, parseStatusDirective } from '../tickets.js';

// ===== TEST APP =====

function createApp(userOverride = {}) {
  const app = express();
  app.use(express.json());
  // Mock auth
  app.use((req, res, next) => {
    req.user = { id: 1, role: 'admin', user_type: 'human', ...userOverride };
    next();
  });
  app.use('/api/v3', ticketsRoutes);
  return app;
}

// ===== TESTS =====

describe('ADR-098: Tickets API', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ===== STATE_MAP exports =====

  describe('State Machine Constants (Phase 1 — 7 states)', () => {
    it('should export STATE_MAP with 7 states', () => {
      expect(STATE_MAP).toEqual({
        backlog: 24275,
        assigned: 43436,
        in_progress: 24276,
        review: 24277,
        control: 43437,
        rejected: 43438,
        done: 24278,
      });
    });

    it('should export STATE_NAMES as reverse map for all 7 states', () => {
      expect(STATE_NAMES[24275]).toBe('backlog');
      expect(STATE_NAMES[43436]).toBe('assigned');
      expect(STATE_NAMES[24276]).toBe('in_progress');
      expect(STATE_NAMES[24277]).toBe('review');
      expect(STATE_NAMES[43437]).toBe('control');
      expect(STATE_NAMES[43438]).toBe('rejected');
      expect(STATE_NAMES[24278]).toBe('done');
    });

    it('should export TRANSITIONS with 7-state rules', () => {
      // backlog → assigned, in_progress (backward compat)
      expect(TRANSITIONS[24275]).toContain(43436);
      expect(TRANSITIONS[24275]).toContain(24276);
      // assigned → in_progress, backlog
      expect(TRANSITIONS[43436]).toEqual([24276, 24275]);
      // in_progress → review, backlog
      expect(TRANSITIONS[24276]).toEqual([24277, 24275]);
      // review → control, in_progress
      expect(TRANSITIONS[24277]).toEqual([43437, 24276]);
      // control → done, rejected (HUMAN ONLY)
      expect(TRANSITIONS[43437]).toEqual([24278, 43438]);
      // rejected → in_progress
      expect(TRANSITIONS[43438]).toEqual([24276]);
      // done → terminal (empty)
      expect(TRANSITIONS[24278]).toEqual([]);
    });
  });

  // ===== PATCH /tickets/:id/status =====

  describe('PATCH /api/v3/tickets/:id/status', () => {

    it('should change ticket from in_progress to review', async () => {
      mockGetTicket.mockResolvedValue({
        id: 100,
        state: 24276, // in_progress
        what: 'Test task',
        _chain: { chain_id: 'chain-abc' },
      });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100,
        old_state: 24276,
        new_state: 24277,
        chain_id: 'chain-abc',
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'review' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ticket_id).toBe(100);
      expect(res.body.data.old_state).toBe('in_progress');
      expect(res.body.data.old_state_id).toBe(24276);
      expect(res.body.data.new_state).toBe('review');
      expect(res.body.data.new_state_id).toBe(24277);
      expect(res.body.data.chain_id).toBe('chain-abc');
      expect(res.body.data.updated_at).toBeDefined();
    });

    it('should accept state name string and resolve to ID', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24276 });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24276, new_state: 24277, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'review' });

      expect(res.status).toBe(200);
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ new_state: 24277 })
      );
    });

    it('should accept state ID number directly', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24276 });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24276, new_state: 24277, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 24277 });

      expect(res.status).toBe(200);
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ new_state: 24277 })
      );
    });

    it('should reject invalid state name with 400 INVALID_STATE', async () => {
      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'foo' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
      expect(res.body.error.message).toContain("Unknown state: 'foo'");
      expect(res.body.error.message).toContain('backlog');
    });

    it('should reject invalid state ID with 400 INVALID_STATE', async () => {
      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 99999 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('should reject missing new_state with 400', async () => {
      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('new_state is required');
    });

    it('should reject invalid transition backlog->done with 400 INVALID_TRANSITION', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24275 }); // backlog

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.message).toContain("Cannot transition from 'backlog' to 'done'");
      expect(res.body.error.message).toContain('Allowed:');
    });

    it('should reject invalid transition backlog->review with 400 INVALID_TRANSITION', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24275 }); // backlog

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'review' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.message).toContain("Cannot transition from 'backlog' to 'review'");
    });

    it('should reject invalid transition in_progress->done with 400 (must go through review→control)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24276 }); // in_progress

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('should allow in_progress->backlog (return to backlog)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24276 }); // in_progress
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24276, new_state: 24275, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'backlog' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('backlog');
    });

    it('should allow review->in_progress (rework)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24277 }); // review
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24277, new_state: 24276, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('in_progress');
    });

    it('should reject transition from done (terminal state)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24278 }); // done

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'in_progress' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.message).toContain('Allowed: none');
    });

    it('should return 404 for non-existent ticket', async () => {
      mockGetTicket.mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/v3/tickets/99999/status')
        .send({ new_state: 'review' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('should pass notes to ChainHandoffService', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24276 });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24276, new_state: 24277, chain_id: null,
      });

      await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'review', notes: 'All tests passing' });

      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'All tests passing' })
      );
    });

    it('should pass calling user ID as agent_id', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24276 });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24276, new_state: 24277, chain_id: null,
      });

      await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'review' });

      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ agent_id: 1 }) // from mock auth
      );
    });

    it('should handle case-insensitive state names', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24276 });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24276, new_state: 24277, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'REVIEW' });

      expect(res.status).toBe(200);
    });
  });

  // ===== GET /tickets/:id =====

  describe('GET /api/v3/tickets/:id', () => {

    it('should return ticket with state_name and allowed_transitions', async () => {
      mockGetTicket.mockResolvedValue({
        id: 100,
        what: 'Test task',
        state: 24276, // in_progress
        assigned_to: 19,
        _chain: { chain_id: 'chain-abc' },
        created_at: '2026-02-18T10:00:00Z',
        updated_at: '2026-02-18T12:00:00Z',
      });

      const res = await request(app).get('/api/v3/tickets/100');

      expect(res.status).toBe(200);
      expect(res.body.data.state_name).toBe('in_progress');
      // Phase 1: in_progress → review, backlog
      expect(res.body.data.allowed_transitions).toEqual([
        { id: 24277, name: 'review' },
        { id: 24275, name: 'backlog' },
      ]);
    });

    it('should return 404 for non-existent ticket', async () => {
      mockGetTicket.mockResolvedValue(null);

      const res = await request(app).get('/api/v3/tickets/99999');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('should return empty allowed_transitions for done (terminal)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24278, what: 'Done task' });

      const res = await request(app).get('/api/v3/tickets/100');

      expect(res.status).toBe(200);
      expect(res.body.data.state_name).toBe('done');
      expect(res.body.data.allowed_transitions).toEqual([]);
    });
  });

  // ===== POST /tickets/dispatch =====

  describe('POST /api/v3/tickets/dispatch', () => {

    it('should dispatch a subtask and return ticket info', async () => {
      mockDispatchSubtask.mockResolvedValue({
        ticket_id: 200,
        chain_id: 'chain-xyz',
        step: 1,
        state: 24275,
        assigned_to: 19,
        what: 'Implement API',
      });
      mockDbGet.mockResolvedValue(null); // No existing conversation
      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 }); // New conversation

      const res = await request(app)
        .post('/api/v3/tickets/dispatch')
        .send({
          what: 'Implement API',
          assigned_to: 19,
          acceptance_criteria: 'Tests pass',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.ticket_id).toBe(200);
      expect(res.body.data.chain_id).toBe('chain-xyz');
      expect(res.body.data.state).toBe('backlog');
      expect(res.body.data.conversation_id).toBe(50);
    });

    it('should resolve agent name to ID', async () => {
      mockResolveAgentId.mockReturnValue(19);
      mockDispatchSubtask.mockResolvedValue({
        ticket_id: 200, chain_id: 'chain-xyz', step: 1,
        state: 24275, assigned_to: 19, what: 'Test',
      });
      mockDbGet.mockResolvedValue(null);
      mockDbRun.mockResolvedValue({ lastInsertRowid: 50 });

      const res = await request(app)
        .post('/api/v3/tickets/dispatch')
        .send({ what: 'Test', assigned_to: 'developer-ralph' });

      expect(res.status).toBe(201);
      expect(mockResolveAgentId).toHaveBeenCalledWith('developer-ralph');
    });

    it('should return 400 when what is missing', async () => {
      const res = await request(app)
        .post('/api/v3/tickets/dispatch')
        .send({ assigned_to: 19 });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('what is required');
    });

    it('should return 400 when assigned_to is missing', async () => {
      const res = await request(app)
        .post('/api/v3/tickets/dispatch')
        .send({ what: 'Test task' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('assigned_to is required');
    });
  });

  // ===== POST /tickets/dispatch-chain =====

  describe('POST /api/v3/tickets/dispatch-chain', () => {

    it('should dispatch a chain of tasks', async () => {
      mockDispatchChain.mockResolvedValue({
        chain_id: 'chain-batch',
        parent_ticket_id: null,
        dispatched_by: 1,
        task_count: 2,
        tasks: [
          { ticket_id: 301, chain_id: 'chain-batch', step: 1, state: 24275, assigned_to: 19, what: 'Task 1' },
          { ticket_id: 302, chain_id: 'chain-batch', step: 2, state: 24275, assigned_to: 20, what: 'Task 2' },
        ],
      });

      const res = await request(app)
        .post('/api/v3/tickets/dispatch-chain')
        .send({
          tasks: [
            { what: 'Task 1', assigned_to: 19 },
            { what: 'Task 2', assigned_to: 20 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.chain_id).toBe('chain-batch');
      expect(res.body.data.task_count).toBe(2);
      expect(res.body.data.tickets).toHaveLength(2);
    });

    it('should return 400 when tasks array is empty', async () => {
      const res = await request(app)
        .post('/api/v3/tickets/dispatch-chain')
        .send({ tasks: [] });

      expect(res.status).toBe(400);
    });
  });

  // ===== GET /tickets/chains/:chainId =====

  describe('GET /api/v3/tickets/chains/:chainId', () => {

    it('should return chain progress', async () => {
      mockGetChainStatus.mockResolvedValue({
        chain_id: 'chain-abc',
        status: 'in_progress',
        progress: {
          total: 3, completed: 1, in_progress: 1, review: 0, backlog: 1,
          percent_complete: 33,
        },
        tasks: [],
        current_step: 2,
        next_step: 3,
      });

      const res = await request(app).get('/api/v3/tickets/chains/chain-abc');

      expect(res.status).toBe(200);
      expect(res.body.data.chain_id).toBe('chain-abc');
      expect(res.body.data.progress_pct).toBe(33);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.completed).toBe(1);
    });

    it('should return 404 for non-existent chain', async () => {
      mockGetChainStatus.mockResolvedValue({
        chain_id: 'chain-unknown',
        status: 'not_found',
        tasks: [],
      });

      const res = await request(app).get('/api/v3/tickets/chains/chain-unknown');

      expect(res.status).toBe(404);
    });

    it('should return completed chain status with 100% progress', async () => {
      mockGetChainStatus.mockResolvedValue({
        chain_id: 'chain-done',
        status: 'completed',
        progress: {
          total: 5, completed: 5, in_progress: 0, review: 0, backlog: 0,
          percent_complete: 100,
        },
        tasks: [
          { ticket_id: 1, step: 1, what: 'Task 1', state: 24278 },
          { ticket_id: 2, step: 2, what: 'Task 2', state: 24278 },
        ],
        current_step: null,
        next_step: null,
      });

      const res = await request(app).get('/api/v3/tickets/chains/chain-done');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.progress_pct).toBe(100);
      expect(res.body.data.in_progress).toBe(0);
      expect(res.body.data.backlog).toBe(0);
      expect(res.body.data.current_step).toBeNull();
      expect(res.body.data.next_step).toBeNull();
      expect(res.body.data.tasks).toHaveLength(2);
    });

    it('should return pending chain status when all tasks in backlog', async () => {
      mockGetChainStatus.mockResolvedValue({
        chain_id: 'chain-pending',
        status: 'pending',
        progress: {
          total: 3, completed: 0, in_progress: 0, review: 0, backlog: 3,
          percent_complete: 0,
        },
        tasks: [],
        current_step: null,
        next_step: 1,
      });

      const res = await request(app).get('/api/v3/tickets/chains/chain-pending');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.progress_pct).toBe(0);
      expect(res.body.data.next_step).toBe(1);
    });

    it('should include review count in response', async () => {
      mockGetChainStatus.mockResolvedValue({
        chain_id: 'chain-review',
        status: 'in_progress',
        progress: {
          total: 4, completed: 1, in_progress: 1, review: 2, backlog: 0,
          percent_complete: 25,
        },
        tasks: [],
        current_step: 3,
        next_step: null,
      });

      const res = await request(app).get('/api/v3/tickets/chains/chain-review');

      expect(res.status).toBe(200);
      expect(res.body.data.review).toBe(2);
      expect(res.body.data.in_progress).toBe(1);
    });

    it('should return 500 when ChainHandoffService throws', async () => {
      mockGetChainStatus.mockRejectedValue(new Error('Database connection failed'));

      const res = await request(app).get('/api/v3/tickets/chains/chain-err');

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });

    it('should pass chainId param to ChainHandoffService.getChainStatus', async () => {
      mockGetChainStatus.mockResolvedValue({
        chain_id: 'chain-param-test-123',
        status: 'not_found',
        tasks: [],
      });

      await request(app).get('/api/v3/tickets/chains/chain-param-test-123');

      expect(mockGetChainStatus).toHaveBeenCalledWith('chain-param-test-123');
    });
  });

  // ===== GET /tickets/agents/me/tasks =====

  describe('GET /api/v3/tickets/agents/me/tasks', () => {

    it('should return pending tasks for calling agent', async () => {
      mockGetAgentPendingTasks.mockResolvedValue([
        { ticket_id: 100, what: 'Task 1', state: 24275, priority: 24274 },
        { ticket_id: 101, what: 'Task 2', state: 24276, priority: 24274 },
      ]);

      const res = await request(app).get('/api/v3/tickets/agents/me/tasks');

      expect(res.status).toBe(200);
      expect(res.body.data.agent_id).toBe(1);
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.tasks).toHaveLength(2);
      expect(res.body.data.tasks[0].state_name).toBe('backlog');
      expect(res.body.data.tasks[1].state_name).toBe('in_progress');
    });
  });

  // ===== POST /tickets/:id/message =====

  describe('POST /api/v3/tickets/:id/message', () => {

    it('should send message in existing ticket conversation', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, what: 'Test', state: 24276 });
      mockDbGet.mockResolvedValue({ id: 42 }); // existing conversation
      mockDbRun.mockResolvedValue({ lastInsertRowid: 500 }); // new message

      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: 'Progress update' });

      expect(res.status).toBe(201);
      expect(res.body.data.message_id).toBe(500);
      expect(res.body.data.conversation_id).toBe(42);
      expect(res.body.data.ticket_id).toBe(100);
    });

    it('should create conversation if none exists', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, what: 'Test', state: 24276 });
      mockDbGet.mockResolvedValue(null); // no existing conversation
      mockDbRun
        .mockResolvedValueOnce({ lastInsertRowid: 60 })  // create conversation
        .mockResolvedValueOnce({ lastInsertRowid: 501 }); // create message

      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: 'Starting work' });

      expect(res.status).toBe(201);
      expect(res.body.data.conversation_id).toBe(60);
    });

    it('should return 404 for non-existent ticket', async () => {
      mockGetTicket.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v3/tickets/99999/message')
        .send({ content: 'Test' });

      expect(res.status).toBe(404);
    });

    it('should return 400 when content is empty', async () => {
      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('content is required');
    });
  });

  // ===== PHASE 1: 7-STATE WORKFLOW =====

  describe('Phase 1: 7-State Workflow Transitions', () => {

    it('should allow backlog → assigned', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24275 }); // backlog
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24275, new_state: 43436, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'assigned' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('assigned');
    });

    it('should allow assigned → in_progress (agent picks up)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 43436 }); // assigned
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43436, new_state: 24276, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('in_progress');
    });

    it('should allow review → control (QA passes)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24277 }); // review
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24277, new_state: 43437, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'control' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('control');
    });

    it('should allow control → done (human approves)', async () => {
      // Human user (default in createApp)
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 24278, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('done');
    });

    it('should allow control → rejected (human rejects)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 43438, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'rejected' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('rejected');
    });

    it('should allow rejected → in_progress (agent reworks)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 43438 }); // rejected
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43438, new_state: 24276, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('in_progress');
    });

    it('should reject review → done (must go through control)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 24277 }); // review

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  // ===== PHASE 1: CONTROL GATE =====

  describe('Phase 1: Control Gate (Human Only)', () => {

    it('should reject agent attempting control → done with 403 CONTROL_GATE', async () => {
      // Create app with agent user
      const agentApp = createApp({ user_type: 'agent' });
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control

      const res = await request(agentApp)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONTROL_GATE');
      expect(res.body.error.message).toContain('Only human users');
    });

    it('should reject agent attempting control → rejected with 403 CONTROL_GATE', async () => {
      const agentApp = createApp({ user_type: 'agent' });
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control

      const res = await request(agentApp)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'rejected' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONTROL_GATE');
    });

    it('should allow human to transition from control → done', async () => {
      // Human user (default)
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 24278, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('done');
    });

    it('should allow human to transition from control → rejected', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 43438, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'rejected' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('rejected');
    });
  });

  // ===== ADR-109: SUPERVISOR BYPASS =====

  describe('ADR-109: Supervisor Bypass in Control Gate', () => {

    it('should export SUPERVISOR_AGENT_IDS containing supervisor user ID (53)', () => {
      expect(SUPERVISOR_AGENT_IDS).toBeDefined();
      expect(SUPERVISOR_AGENT_IDS).toBeInstanceOf(Set);
      expect(SUPERVISOR_AGENT_IDS.has(53)).toBe(true);
    });

    it('should allow supervisor agent (id=53) to transition control → done', async () => {
      // Supervisor agent: user_type='agent', id=53
      const supervisorApp = createApp({ id: 53, user_type: 'agent' });
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 24278, chain_id: null,
      });

      const res = await request(supervisorApp)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('done');
    });

    it('should allow supervisor agent (id=53) to transition control → rejected', async () => {
      const supervisorApp = createApp({ id: 53, user_type: 'agent' });
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 43438, chain_id: null,
      });

      const res = await request(supervisorApp)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'rejected' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('rejected');
    });

    it('should still block regular agents (non-supervisor) from control → done', async () => {
      // Regular agent: user_type='agent', id=19 (developer-ralph)
      const agentApp = createApp({ id: 19, user_type: 'agent' });
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control

      const res = await request(agentApp)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONTROL_GATE');
    });

    it('should still allow human users (regression test)', async () => {
      // Human user (default)
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 24278, chain_id: null,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.data.new_state).toBe('done');
    });

    it('should log supervisor bypass to activity table', async () => {
      const supervisorApp = createApp({ id: 53, user_type: 'agent' });
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 24278, chain_id: null,
      });

      await request(supervisorApp)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      // Verify logActivity was called with supervisor_bypass
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'supervisor_bypass',
          agent_id: 53,
          ticket_id: 100,
        })
      );
    });

    it('should NOT log bypass for human users transitioning from control', async () => {
      // Human user (default, id=1)
      mockGetTicket.mockResolvedValue({ id: 100, state: 43437 }); // control
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 43437, new_state: 24278, chain_id: null,
      });

      await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'done' });

      // logActivity should NOT have been called with supervisor_control_bypass
      const bypassCalls = mockLogActivity.mock.calls.filter(
        call => call[0]?.action === 'supervisor_control_bypass'
      );
      expect(bypassCalls).toHaveLength(0);
    });
  });

  // ===== PHASE 1: CASCADE UPDATES =====

  describe('Phase 1: Cascade Updates', () => {

    it('should include cascade results in status change response', async () => {
      mockGetTicket.mockResolvedValue({
        id: 100, state: 24276, what: 'Test task',
        _chain: { chain_id: 'chain-abc' },
      });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: 24276, new_state: 24277, chain_id: 'chain-abc',
      });
      // Mock for cascade chain status check
      const { default: ChainHandoffService } = await import('../../../services/ChainHandoffService.js');
      ChainHandoffService.getChainStatus = vi.fn().mockResolvedValue({
        progress: { percent_complete: 50 },
      });

      const res = await request(app)
        .patch('/api/v3/tickets/100/status')
        .send({ new_state: 'review' });

      expect(res.status).toBe(200);
      expect(res.body.data.cascade).toBeDefined();
      expect(Array.isArray(res.body.data.cascade)).toBe(true);
    });
  });

  // ===== ADR Status Cascade (Phase 2 — AC10 Level 3) =====

  describe('ADR Status Cascade (Phase 2)', () => {
    it('should trigger ADR status recalc when ticket has adr_ref', async () => {
      // Ticket with adr_ref (numeric row ID of ADR document, as stored by select column)
      mockGetTicket.mockResolvedValue({
        id: 200, state: 24277, what: 'Build feature',
        adr_ref: 74360,
        _chain: { chain_id: 'chain-xyz' },
      });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 200, old_state: 24277, new_state: 43437, chain_id: 'chain-xyz',
      });

      // Mock dbAll for finding tickets with adr_ref
      mockDbAll.mockResolvedValue([
        { id: 200, data: JSON.stringify({ adr_ref: 74360, state: 24278 }) }, // done
        { id: 201, data: JSON.stringify({ adr_ref: 74360, state: 24278 }) }, // done
      ]);

      // Mock dbGet for finding ADR document (now looked up by row ID, not slug)
      mockDbGet.mockImplementation(async (query, params) => {
        // For getTicket (table 1708)
        if (String(query).includes('table_id') && String(params).includes('200')) {
          return { id: 200, data: JSON.stringify({ state: 24277, what: 'Build feature', adr_ref: 74360, _chain: { chain_id: 'chain-xyz' } }) };
        }
        // For ADR document lookup (table 2197, by row ID)
        if (String(query).includes('2197') || String(params).includes('74360')) {
          return { id: 74360, data: JSON.stringify({ slug: 'adr-098', status: 'PROPOSED' }) };
        }
        return null;
      });
      mockDbRun.mockResolvedValue({});

      const res = await request(app)
        .patch('/api/v3/tickets/200/status')
        .send({ new_state: 'control' });

      expect(res.status).toBe(200);
      // Cascade should include level 3 ADR recalc
      const cascade = res.body.data.cascade;
      expect(cascade).toBeDefined();
      const level3 = cascade.find(l => l.level === 3);
      expect(level3).toBeDefined();
      expect(level3.action).toBe('adr_status_recalculated');
      expect(level3.adr_ref).toBe(74360);
    });

    it('should skip ADR cascade when ticket has no adr_ref', async () => {
      mockGetTicket.mockResolvedValue({
        id: 300, state: 24276, what: 'Simple task',
        _chain: {},
      });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 300, old_state: 24276, new_state: 24277,
      });

      const res = await request(app)
        .patch('/api/v3/tickets/300/status')
        .send({ new_state: 'review' });

      expect(res.status).toBe(200);
      const cascade = res.body.data.cascade;
      const level3 = cascade?.find(l => l.level === 3);
      expect(level3).toBeUndefined(); // No ADR cascade without adr_ref
    });
  });

  // ===== POST /tickets/:id/invoke-agent (ADR-077 Task #12) =====

  describe('POST /api/v3/tickets/:id/invoke-agent', () => {

    it('should invoke agent for a valid ticket and return job info', async () => {
      mockGetTicket.mockResolvedValue({
        id: 100,
        what: 'Implement feature X',
        state: 24275, // backlog
        assigned_to: 19, // developer-ralph
      });
      mockResolveAgentUser.mockResolvedValue({
        id: 19,
        name: 'developer-ralph',
        managed_by_agent_row_id: 42,
        _agentConfig: { row_id: 42, name: 'developer-ralph' },
      });
      // Existing conversation found
      mockDbGet.mockResolvedValue({ id: 55 });
      mockCreateAndDispatchJob.mockResolvedValue({ jobId: 'job-abc-123', id: 10 });

      const res = await request(app)
        .post('/api/v3/tickets/100/invoke-agent')
        .send({ message: 'Please start working on this' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.job_id).toBe('job-abc-123');
      expect(res.body.data.conversation_id).toBe(55);
      expect(res.body.data.agent_name).toBe('developer-ralph');
      expect(res.body.data.ticket_id).toBe(100);
    });

    it('should create conversation if none exists', async () => {
      mockGetTicket.mockResolvedValue({
        id: 101,
        what: 'Build API',
        state: 24276, // in_progress
        assigned_to: 20,
      });
      mockResolveAgentUser.mockResolvedValue({
        id: 20,
        name: 'developer',
        managed_by_agent_row_id: 43,
        _agentConfig: { row_id: 43, name: 'developer' },
      });
      mockDbGet.mockResolvedValue(null); // No existing conversation
      mockDbRun.mockResolvedValue({ lastInsertRowid: 77 }); // New conversation
      mockCreateAndDispatchJob.mockResolvedValue({ jobId: 'job-def-456', id: 11 });

      const res = await request(app)
        .post('/api/v3/tickets/101/invoke-agent')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.conversation_id).toBe(77);
      expect(res.body.data.job_id).toBe('job-def-456');
    });

    it('should return 404 for non-existent ticket', async () => {
      mockGetTicket.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v3/tickets/99999/invoke-agent')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('should return 400 if ticket has no assigned_to', async () => {
      mockGetTicket.mockResolvedValue({
        id: 102,
        what: 'Unassigned task',
        state: 24275,
        assigned_to: null,
      });

      const res = await request(app)
        .post('/api/v3/tickets/102/invoke-agent')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('assigned_to');
    });

    it('should return 400 if ticket is in done (terminal) state', async () => {
      mockGetTicket.mockResolvedValue({
        id: 103,
        what: 'Completed task',
        state: 24278, // done
        assigned_to: 19,
      });

      const res = await request(app)
        .post('/api/v3/tickets/103/invoke-agent')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TICKET_TERMINAL');
    });

    it('should return 400 if agent user cannot be resolved', async () => {
      mockGetTicket.mockResolvedValue({
        id: 104,
        what: 'Task for unknown agent',
        state: 24275,
        assigned_to: 999,
      });
      mockResolveAgentUser.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v3/tickets/104/invoke-agent')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AGENT_NOT_FOUND');
    });

    it('should use ticket what as default message if none provided', async () => {
      mockGetTicket.mockResolvedValue({
        id: 105,
        what: 'Implement the login page',
        state: 24275,
        assigned_to: 21,
      });
      mockResolveAgentUser.mockResolvedValue({
        id: 21,
        name: 'frontend',
        managed_by_agent_row_id: 44,
        _agentConfig: { row_id: 44, name: 'frontend' },
      });
      mockDbGet.mockResolvedValue({ id: 60 });
      mockCreateAndDispatchJob.mockResolvedValue({ jobId: 'job-ghi-789', id: 12 });

      await request(app)
        .post('/api/v3/tickets/105/invoke-agent')
        .send({});

      expect(mockCreateAndDispatchJob).toHaveBeenCalledWith(
        expect.objectContaining({
          messageContent: expect.stringContaining('Implement the login page'),
        })
      );
    });

    it('should pass ticketId to createAndDispatchJob', async () => {
      mockGetTicket.mockResolvedValue({
        id: 106,
        what: 'Build widget',
        state: 24276,
        assigned_to: 19,
      });
      mockResolveAgentUser.mockResolvedValue({
        id: 19,
        name: 'developer-ralph',
        managed_by_agent_row_id: 42,
        _agentConfig: { row_id: 42, name: 'developer-ralph' },
      });
      mockDbGet.mockResolvedValue({ id: 70 });
      mockCreateAndDispatchJob.mockResolvedValue({ jobId: 'job-jkl', id: 13 });

      await request(app)
        .post('/api/v3/tickets/106/invoke-agent')
        .send({ message: 'Work on this' });

      expect(mockCreateAndDispatchJob).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 70,
          ticketId: 106,
          triggeredByUserId: 1,
        })
      );
    });

    it('should update ticket state to in_progress if currently backlog', async () => {
      mockGetTicket.mockResolvedValue({
        id: 107,
        what: 'Start this task',
        state: 24275, // backlog
        assigned_to: 19,
      });
      mockResolveAgentUser.mockResolvedValue({
        id: 19,
        name: 'developer-ralph',
        managed_by_agent_row_id: 42,
        _agentConfig: { row_id: 42, name: 'developer-ralph' },
      });
      mockDbGet.mockResolvedValue({ id: 80 });
      mockCreateAndDispatchJob.mockResolvedValue({ jobId: 'job-mno', id: 14 });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 107, old_state: 24275, new_state: 24276,
      });

      const res = await request(app)
        .post('/api/v3/tickets/107/invoke-agent')
        .send({});

      expect(res.status).toBe(200);
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: 107,
          new_state: 24276, // in_progress
        })
      );
    });
  });

  // ===== ADR-077 TASK #7: STATUS AUTO-UPDATE FROM MESSAGE =====

  describe('parseStatusDirective()', () => {

    it('should parse "Status: Done" and return review state', () => {
      const result = parseStatusDirective('I finished the work.\n\nStatus: Done');
      expect(result).toEqual({ targetState: 'review', rawStatus: 'done' });
    });

    it('should parse "Status: Review" and return review state', () => {
      const result = parseStatusDirective('Submitting for review.\n\nStatus: Review');
      expect(result).toEqual({ targetState: 'review', rawStatus: 'review' });
    });

    it('should parse "Status: In Progress" and return in_progress state', () => {
      const result = parseStatusDirective('Starting work.\n\nStatus: In Progress');
      expect(result).toEqual({ targetState: 'in_progress', rawStatus: 'in progress' });
    });

    it('should parse "Status: Backlog" and return backlog state', () => {
      const result = parseStatusDirective('Pausing work.\n\nStatus: Backlog');
      expect(result).toEqual({ targetState: 'backlog', rawStatus: 'backlog' });
    });

    it('should be case-insensitive', () => {
      const result = parseStatusDirective('status: DONE');
      expect(result).toEqual({ targetState: 'review', rawStatus: 'done' });
    });

    it('should return null when no status directive found', () => {
      const result = parseStatusDirective('Just a normal progress update');
      expect(result).toBeNull();
    });

    it('should return null for empty content', () => {
      expect(parseStatusDirective('')).toBeNull();
      expect(parseStatusDirective(null)).toBeNull();
      expect(parseStatusDirective(undefined)).toBeNull();
    });

    it('should handle "Status: done" at end of long message', () => {
      const content = 'Here is my implementation:\n\n1. Added feature X\n2. Wrote tests\n3. All passing\n\nStatus: done';
      const result = parseStatusDirective(content);
      expect(result).toEqual({ targetState: 'review', rawStatus: 'done' });
    });

    it('should handle <promise>COMPLETE</promise> tag', () => {
      const content = 'All acceptance criteria met.\n\n<promise>COMPLETE</promise>';
      const result = parseStatusDirective(content);
      expect(result).toEqual({ targetState: 'review', rawStatus: 'complete' });
    });

    it('should handle <promise>ADR IMPLEMENTATION COMPLETE</promise> tag', () => {
      const content = 'All done.\n\n<promise>ADR IMPLEMENTATION COMPLETE</promise>';
      const result = parseStatusDirective(content);
      expect(result).toEqual({ targetState: 'review', rawStatus: 'complete' });
    });
  });

  describe('POST /api/v3/tickets/:id/message — auto-status-update', () => {

    it('should auto-update ticket status to review when message contains "Status: Done"', async () => {
      mockGetTicket.mockResolvedValue({
        id: 100, what: 'Test task', state: STATE_MAP.in_progress,
        _chain: { chain_id: 'chain-abc' },
      });
      mockDbGet.mockResolvedValue({ id: 42 }); // existing conversation
      mockDbRun.mockResolvedValue({ lastInsertRowid: 500 }); // new message
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: STATE_MAP.in_progress, new_state: STATE_MAP.review, chain_id: 'chain-abc',
      });

      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: 'All tests pass.\n\nStatus: Done' });

      expect(res.status).toBe(201);
      expect(res.body.data.auto_status_update).toBeDefined();
      expect(res.body.data.auto_status_update.new_state).toBe('review');
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: 100,
          new_state: STATE_MAP.review,
        })
      );
    });

    it('should NOT auto-update when message has no status directive', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, what: 'Test', state: STATE_MAP.in_progress });
      mockDbGet.mockResolvedValue({ id: 42 });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 500 });

      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: 'Just a progress update' });

      expect(res.status).toBe(201);
      expect(res.body.data.auto_status_update).toBeUndefined();
      expect(mockUpdateTicketStatus).not.toHaveBeenCalled();
    });

    it('should skip auto-update when transition is invalid (e.g. ticket already done)', async () => {
      mockGetTicket.mockResolvedValue({ id: 100, what: 'Test', state: STATE_MAP.done });
      mockDbGet.mockResolvedValue({ id: 42 });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 500 });

      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: 'Status: Done' });

      expect(res.status).toBe(201);
      expect(res.body.data.auto_status_update).toBeUndefined();
      expect(mockUpdateTicketStatus).not.toHaveBeenCalled();
    });

    it('should skip auto-update when transition is not allowed by state machine', async () => {
      // Ticket in backlog; review is not allowed (must go through assigned/in_progress first)
      mockGetTicket.mockResolvedValue({ id: 100, what: 'Test', state: STATE_MAP.backlog });
      mockDbGet.mockResolvedValue({ id: 42 });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 500 });

      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: 'Status: Done' });

      expect(res.status).toBe(201);
      // backlog to review is not in TRANSITIONS, so auto-update should be skipped
      expect(mockUpdateTicketStatus).not.toHaveBeenCalled();
    });

    it('should auto-update to in_progress when message contains "Status: In Progress"', async () => {
      mockGetTicket.mockResolvedValue({
        id: 100, what: 'Test task', state: STATE_MAP.assigned,
      });
      mockDbGet.mockResolvedValue({ id: 42 });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 500 });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: STATE_MAP.assigned, new_state: STATE_MAP.in_progress, chain_id: null,
      });

      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: 'Starting work now.\n\nStatus: In Progress' });

      expect(res.status).toBe(201);
      expect(res.body.data.auto_status_update).toBeDefined();
      expect(res.body.data.auto_status_update.new_state).toBe('in_progress');
    });

    it('should handle <promise>COMPLETE</promise> tag as Status: Done', async () => {
      mockGetTicket.mockResolvedValue({
        id: 100, what: 'Test task', state: STATE_MAP.in_progress,
      });
      mockDbGet.mockResolvedValue({ id: 42 });
      mockDbRun.mockResolvedValue({ lastInsertRowid: 500 });
      mockUpdateTicketStatus.mockResolvedValue({
        ticket_id: 100, old_state: STATE_MAP.in_progress, new_state: STATE_MAP.review, chain_id: null,
      });

      const res = await request(app)
        .post('/api/v3/tickets/100/message')
        .send({ content: 'All done.\n\n<promise>COMPLETE</promise>' });

      expect(res.status).toBe(201);
      expect(res.body.data.auto_status_update).toBeDefined();
      expect(res.body.data.auto_status_update.new_state).toBe('review');
    });
  });
});
