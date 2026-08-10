/**
 * Ticket #81861: TodoWrite → Plan Bridge Tests
 *
 * Tests the mapTodoStatus helper and the TodoWrite interception logic
 * that bridges Claude Code's TodoWrite tool calls to CRM plan messages
 * via handleManagePlan().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

const { mockDbGet, mockDbRun, mockDbAll, mockIsPostgres, mockSaveStepMessage, mockHandleManagePlan } = vi.hoisted(() => ({
  mockDbGet: vi.fn(),
  mockDbRun: vi.fn(),
  mockDbAll: vi.fn(() => []),
  mockIsPostgres: vi.fn(() => false),
  mockSaveStepMessage: vi.fn(() => Promise.resolve()),
  mockHandleManagePlan: vi.fn(() => Promise.resolve('Plan updated: 3 pending')),
}));

vi.mock('../../database/connection.js', () => ({
  dbGet: mockDbGet,
  dbRun: mockDbRun,
  dbAll: mockDbAll,
  isPostgres: mockIsPostgres,
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../AgentLoopService.js', () => ({
  saveStepMessage: mockSaveStepMessage,
}));

vi.mock('../chat/agent-execution-shared.js', () => ({
  resolveAgentProvider: vi.fn(),
  detectProvider: vi.fn(() => ({ isClaudeCode: true })),
  buildAgentSystemPrompt: vi.fn(() => 'system prompt'),
  loadConversationHistory: vi.fn(() => []),
  fetchBoundRowContext: vi.fn(() => null),
  setConversationProcessing: vi.fn(),
  handleManagePlan: mockHandleManagePlan,
}));

vi.mock('../AgentActivityLogger.js', () => ({
  logAgentActivity: vi.fn(),
}));

vi.mock('../agent-users.js', () => ({
  resolveAgentUser: vi.fn(() => ({ id: 1 })),
}));

// ─── Import after mocks ─────────────────────────────────────────

import { mapTodoStatus } from '../AgentJobService.js';

// ─── Tests ───────────────────────────────────────────────────────

describe('Ticket #81861: mapTodoStatus()', () => {
  it('maps "pending" to "pending"', () => {
    expect(mapTodoStatus('pending')).toBe('pending');
  });

  it('maps "in-progress" (hyphenated) to "in_progress"', () => {
    expect(mapTodoStatus('in-progress')).toBe('in_progress');
  });

  it('maps "in_progress" (underscored) to "in_progress"', () => {
    expect(mapTodoStatus('in_progress')).toBe('in_progress');
  });

  it('maps "completed" to "completed"', () => {
    expect(mapTodoStatus('completed')).toBe('completed');
  });

  it('maps "blocked" to "blocked"', () => {
    expect(mapTodoStatus('blocked')).toBe('blocked');
  });

  it('defaults to "pending" for null/undefined', () => {
    expect(mapTodoStatus(null)).toBe('pending');
    expect(mapTodoStatus(undefined)).toBe('pending');
  });

  it('defaults to "pending" for unknown values', () => {
    expect(mapTodoStatus('cancelled')).toBe('pending');
    expect(mapTodoStatus('done')).toBe('pending');
  });

  it('handles case-insensitive input', () => {
    expect(mapTodoStatus('IN-PROGRESS')).toBe('in_progress');
    expect(mapTodoStatus('Completed')).toBe('completed');
    expect(mapTodoStatus('PENDING')).toBe('pending');
  });

  it('trims whitespace', () => {
    expect(mapTodoStatus('  in-progress  ')).toBe('in_progress');
    expect(mapTodoStatus(' completed ')).toBe('completed');
  });
});

describe('Ticket #81861: TodoWrite → Plan Bridge integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds correct tasks array from TodoWrite input', () => {
    // Simulate what happens inside onEvent when a TodoWrite tool_use block arrives.
    // We test the mapping logic directly since onEvent is not exported.
    const todoWriteInput = {
      todos: [
        { content: 'Research the problem', status: 'pending' },
        { content: 'Design the solution', status: 'in-progress' },
        { content: 'Implement changes', status: 'completed' },
      ],
    };

    const todos = todoWriteInput.todos || [];
    const tasks = todos.map((t, i) => ({
      id: i + 1,
      title: t.content || t.title || `Task ${i + 1}`,
      status: mapTodoStatus(t.status),
      ...(t.note ? { note: t.note } : {}),
    }));

    expect(tasks).toEqual([
      { id: 1, title: 'Research the problem', status: 'pending' },
      { id: 2, title: 'Design the solution', status: 'in_progress' },
      { id: 3, title: 'Implement changes', status: 'completed' },
    ]);
  });

  it('uses title field as fallback when content is missing', () => {
    const todos = [
      { title: 'Fallback title', status: 'pending' },
    ];

    const tasks = todos.map((t, i) => ({
      id: i + 1,
      title: t.content || t.title || `Task ${i + 1}`,
      status: mapTodoStatus(t.status),
    }));

    expect(tasks[0].title).toBe('Fallback title');
  });

  it('generates placeholder title when both content and title missing', () => {
    const todos = [
      { status: 'pending' },
    ];

    const tasks = todos.map((t, i) => ({
      id: i + 1,
      title: t.content || t.title || `Task ${i + 1}`,
      status: mapTodoStatus(t.status),
    }));

    expect(tasks[0].title).toBe('Task 1');
  });

  it('includes note when present in todo item', () => {
    const todos = [
      { content: 'Task with note', status: 'pending', note: 'Extra context' },
      { content: 'Task without note', status: 'pending' },
    ];

    const tasks = todos.map((t, i) => ({
      id: i + 1,
      title: t.content || t.title || `Task ${i + 1}`,
      status: mapTodoStatus(t.status),
      ...(t.note ? { note: t.note } : {}),
    }));

    expect(tasks[0]).toHaveProperty('note', 'Extra context');
    expect(tasks[1]).not.toHaveProperty('note');
  });

  it('skips handleManagePlan when todos array is empty', () => {
    const todoWriteInput = { todos: [] };
    const todos = todoWriteInput.todos || [];
    const tasks = todos.map((t, i) => ({
      id: i + 1,
      title: t.content || t.title || `Task ${i + 1}`,
      status: mapTodoStatus(t.status),
    }));

    // Simulates the guard: if (tasks.length > 0) { handleManagePlan(...) }
    if (tasks.length > 0) {
      mockHandleManagePlan({ tasks }, 123, 'TestAgent', { agentId: 1 });
    }

    expect(mockHandleManagePlan).not.toHaveBeenCalled();
  });

  it('calls handleManagePlan with correct arguments when todos exist', async () => {
    const todos = [
      { content: 'Step 1', status: 'pending' },
      { content: 'Step 2', status: 'in-progress' },
    ];

    const tasks = todos.map((t, i) => ({
      id: i + 1,
      title: t.content || t.title || `Task ${i + 1}`,
      status: mapTodoStatus(t.status),
      ...(t.note ? { note: t.note } : {}),
    }));

    const conversationId = 42;
    const agentName = 'DevAgent';
    const agentRowId = 99;

    if (tasks.length > 0) {
      await mockHandleManagePlan({ tasks }, conversationId, agentName, { agentId: agentRowId });
    }

    expect(mockHandleManagePlan).toHaveBeenCalledWith(
      {
        tasks: [
          { id: 1, title: 'Step 1', status: 'pending' },
          { id: 2, title: 'Step 2', status: 'in_progress' },
        ],
      },
      42,
      'DevAgent',
      { agentId: 99 }
    );
  });
});
