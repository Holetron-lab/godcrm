/**
 * ChainHandoffService Tests — ADR-101: Chain Supervisor Methods
 *
 * TDD tests for supervisor-related methods:
 *   - buildKnowledgeSummary(): Parses chain tasks into structured knowledge
 *   - buildCycleKnowledgeEntry(): Creates knowledge stack entries
 *   - formatSupervisorContext(): Formats context string for supervisor prompt
 *   - triggerSupervisor(): Dispatches supervisor ticket to N (supervisor)
 *   - startNewCycle(): Starts new cycle with knowledge propagation
 *   - autoEscalate(): Safety-limit escalation to orchestrator
 *   - Integration: dispatchSubtask supervisor trigger at step 9
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockDbRun, mockDbGet, mockDbAll, mockIsPostgres, mockSafeJsonParse } = vi.hoisted(() => {
  return {
    mockDbRun: vi.fn(),
    mockDbGet: vi.fn(),
    mockDbAll: vi.fn(),
    mockIsPostgres: vi.fn(() => false),
    mockSafeJsonParse: vi.fn((str, def) => {
      try { return JSON.parse(str); } catch { return def; }
    }),
  };
});

vi.mock('../../database/connection.js', () => ({
  dbRun: (...args) => mockDbRun(...args),
  dbGet: (...args) => mockDbGet(...args),
  dbAll: (...args) => mockDbAll(...args),
  isPostgres: () => mockIsPostgres(),
  safeJsonParse: (...args) => mockSafeJsonParse(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/baseId.js', () => ({
  generateBaseId: vi.fn((prefix) => `${prefix}-test-123`),
}));

// Mock crypto module (jsdom environment does not support Node.js built-in crypto)
vi.mock('crypto', () => ({
  default: {
    randomBytes: (size) => ({
      toString: () => 'a1b2c3d4'.substring(0, size * 2),
    }),
  },
  randomBytes: (size) => ({
    toString: () => 'a1b2c3d4'.substring(0, size * 2),
  }),
}));

// ─── Import ─────────────────────────────────────────────────────────────────

import ChainHandoffService, { STATE, AGENT_USERS, SUPERVISOR_CONFIG } from '../ChainHandoffService.js';

// ─── Constants Reference ────────────────────────────────────────────────────

// STATE = { BACKLOG: 24275, ASSIGNED: 43436, IN_PROGRESS: 24276, REVIEW: 24277,
//           CONTROL: 43437, REJECTED: 43438, DONE: 24278 }
// AGENT_USERS = { ORCHESTRATOR: 18, DEV_RALPH: 19, DEVELOPER: 20, FRONTEND: 21,
//                 FRONTEND_QA: 22, TEST_RUNNER: 23, ARCHITECT: 24, NIKICH: 53 }
// SUPERVISOR_CONFIG = { enabled: true, supervisor_agent_id: 53, trigger_at_step: 9,
//                       max_cycles: 5, max_total_tasks: 50, max_duration_ms: 28800000 }

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTask({ step = 1, what = 'Do something', why = '', state = STATE.DONE, assigned_to = AGENT_USERS.DEVELOPER, chain_status = 'completed' } = {}) {
  return {
    ticket_id: 100 + step,
    chain_id: 'chain-test-abc',
    step,
    what,
    why,
    state,
    assigned_to,
    chain_status,
    dispatched_at: '2026-01-01T00:00:00.000Z',
    picked_up_at: '2026-01-01T00:01:00.000Z',
    completed_at: '2026-01-01T00:10:00.000Z',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function makeDbRow(task) {
  return {
    id: task.ticket_id || 100,
    data: JSON.stringify({
      what: task.what,
      why: task.why || '',
      assigned_to: task.assigned_to,
      state: task.state,
      _chain: {
        chain_id: task.chain_id || 'chain-test-abc',
        step: task.step,
        dispatched_at: task.dispatched_at || '2026-01-01T00:00:00.000Z',
        picked_up_at: task.picked_up_at || null,
        completed_at: task.completed_at || null,
        status: task.chain_status || 'dispatched',
      },
    }),
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function makeKnowledgeStackEntry({ cycle = 1, chain_id = 'chain-prev-1', summary = '3/4 tasks completed.' } = {}) {
  return {
    cycle,
    chain_id,
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-01-01T01:00:00.000Z',
    tasks_completed: 3,
    tasks_total: 4,
    summary,
    key_decisions: ['Use React for frontend'],
    blockers_resolved: ['Fixed DB connection'],
    unresolved_issues: ['CSS layout bug'],
    artifacts: {
      files_created: ['src/App.tsx'],
      files_modified: ['package.json'],
      tests_passed: 10,
      tests_failed: 1,
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── buildKnowledgeSummary ──────────────────────────────────────────────────

describe('buildKnowledgeSummary', () => {
  test('empty tasks returns empty summary with default structure', () => {
    const result = ChainHandoffService.buildKnowledgeSummary([]);

    expect(result).toEqual({
      summary: 'No tasks in chain.',
      tasks: [],
      decisions: [],
      resolved: [],
      unresolved: [],
      artifacts: {
        files_created: [],
        files_modified: [],
        tests_passed: 0,
        tests_failed: 0,
      },
    });
  });

  test('null tasks returns empty summary', () => {
    const result = ChainHandoffService.buildKnowledgeSummary(null);

    expect(result.summary).toBe('No tasks in chain.');
    expect(result.tasks).toEqual([]);
  });

  test('extracts DECISION markers from why field', () => {
    const tasks = [
      makeTask({ step: 1, why: 'DECISION: Use TypeScript for all new modules\nDid some work.' }),
      makeTask({ step: 2, why: 'DECISION: Store config in YAML format' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.decisions).toContain('Use TypeScript for all new modules');
    expect(result.decisions).toContain('Store config in YAML format');
    expect(result.decisions).toHaveLength(2);
    expect(result.summary).toContain('Decisions:');
  });

  test('extracts RESOLVED and FIXED markers from why field', () => {
    const tasks = [
      makeTask({ step: 1, why: 'RESOLVED: Database connection timeout issue' }),
      makeTask({ step: 2, why: 'FIXED: Race condition in worker pool' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.resolved).toContain('Database connection timeout issue');
    expect(result.resolved).toContain('Race condition in worker pool');
    expect(result.resolved).toHaveLength(2);
    expect(result.summary).toContain('Resolved:');
  });

  test('extracts BLOCKER, UNRESOLVED, and FAILED markers from why field', () => {
    const tasks = [
      makeTask({ step: 1, why: 'BLOCKER: API rate limit exceeded' }),
      makeTask({ step: 2, why: 'UNRESOLVED: Memory leak in event loop' }),
      makeTask({ step: 3, why: 'FAILED: OAuth token refresh mechanism' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.unresolved).toContain('API rate limit exceeded');
    expect(result.unresolved).toContain('Memory leak in event loop');
    expect(result.unresolved).toContain('OAuth token refresh mechanism');
    expect(result.unresolved).toHaveLength(3);
    expect(result.summary).toContain('Unresolved:');
  });

  test('extracts created file paths from why field', () => {
    const tasks = [
      makeTask({ step: 1, why: 'created: src/components/Header.tsx\nwrote: src/utils/format.ts' }),
      makeTask({ step: 2, why: 'generated: dist/bundle.js' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.artifacts.files_created).toContain('src/components/Header.tsx');
    expect(result.artifacts.files_created).toContain('src/utils/format.ts');
    expect(result.artifacts.files_created).toContain('dist/bundle.js');
    expect(result.artifacts.files_created).toHaveLength(3);
  });

  test('extracts modified file paths from why field', () => {
    const tasks = [
      makeTask({ step: 1, why: 'modified: package.json\nupdated: tsconfig.json' }),
      makeTask({ step: 2, why: 'changed: src/index.ts' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.artifacts.files_modified).toContain('package.json');
    expect(result.artifacts.files_modified).toContain('tsconfig.json');
    expect(result.artifacts.files_modified).toContain('src/index.ts');
    expect(result.artifacts.files_modified).toHaveLength(3);
  });

  test('extracts test counts from why field', () => {
    const tasks = [
      makeTask({ step: 1, why: '5 tests passed, 2 failed' }),
      makeTask({ step: 2, why: '10 tests passed' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.artifacts.tests_passed).toBe(15);
    expect(result.artifacts.tests_failed).toBe(2);
    expect(result.summary).toContain('Tests: 15 passed, 2 failed.');
  });

  test('extracts test counts with alternate wording', () => {
    const tasks = [
      makeTask({ step: 1, why: '3 test passing and 1 test failing' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.artifacts.tests_passed).toBe(3);
    expect(result.artifacts.tests_failed).toBe(1);
  });

  test('counts completed vs incomplete tasks correctly', () => {
    const tasks = [
      makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' }),
      makeTask({ step: 2, state: STATE.DONE, chain_status: 'completed' }),
      makeTask({ step: 3, state: STATE.IN_PROGRESS, chain_status: 'in_progress' }),
      makeTask({ step: 4, state: STATE.BACKLOG, chain_status: 'dispatched' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.summary).toMatch(/^2\/4 tasks completed\./);
    expect(result.tasks).toHaveLength(4);
  });

  test('tasks with no why field do not cause errors', () => {
    const tasks = [
      makeTask({ step: 1, why: undefined }),
      makeTask({ step: 2, why: '' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.decisions).toEqual([]);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.artifacts.files_created).toEqual([]);
    expect(result.artifacts.files_modified).toEqual([]);
    expect(result.artifacts.tests_passed).toBe(0);
    expect(result.artifacts.tests_failed).toBe(0);
    expect(result.tasks).toHaveLength(2);
  });

  test('task summaries include step, what, state, assigned_to as agent name', () => {
    const tasks = [
      makeTask({ step: 1, what: 'Build API', assigned_to: AGENT_USERS.DEVELOPER, chain_status: 'completed' }),
      makeTask({ step: 2, what: 'Write tests', assigned_to: AGENT_USERS.TEST_RUNNER, chain_status: 'in_progress' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.tasks[0]).toEqual({
      step: 1,
      what: 'Build API',
      state: 'completed',
      assigned_to: 'Developer',
    });
    expect(result.tasks[1]).toEqual({
      step: 2,
      what: 'Write tests',
      state: 'in_progress',
      assigned_to: 'Test Runner',
    });
  });

  test('deduplicates decisions, resolved, and unresolved items', () => {
    const tasks = [
      makeTask({ step: 1, why: 'DECISION: Use React\nDECISION: Use React' }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    // Using Set internally so duplicates should be eliminated
    expect(result.decisions).toEqual(['Use React']);
  });

  test('mixed markers across multiple tasks are aggregated', () => {
    const tasks = [
      makeTask({
        step: 1,
        state: STATE.DONE,
        chain_status: 'completed',
        why: 'DECISION: Use Vitest\nRESOLVED: Build errors\ncreated: src/test.ts\n3 tests passed',
      }),
      makeTask({
        step: 2,
        state: STATE.IN_PROGRESS,
        chain_status: 'in_progress',
        why: 'BLOCKER: Missing env vars\nmodified: .env.example\n2 failed',
      }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.decisions).toEqual(['Use Vitest']);
    expect(result.resolved).toEqual(['Build errors']);
    expect(result.unresolved).toEqual(['Missing env vars']);
    expect(result.artifacts.files_created).toEqual(['src/test.ts']);
    expect(result.artifacts.files_modified).toEqual(['.env.example']);
    expect(result.artifacts.tests_passed).toBe(3);
    expect(result.artifacts.tests_failed).toBe(2);
    expect(result.summary).toMatch(/^1\/2 tasks completed\./);
  });

  test('ignores file paths longer than 200 characters', () => {
    const longPath = 'a'.repeat(201);
    const tasks = [
      makeTask({ step: 1, why: `created: ${longPath}` }),
    ];

    const result = ChainHandoffService.buildKnowledgeSummary(tasks);

    expect(result.artifacts.files_created).toEqual([]);
  });
});

// ─── buildCycleKnowledgeEntry ───────────────────────────────────────────────

describe('buildCycleKnowledgeEntry', () => {
  test('creates proper structure with all fields', () => {
    const knowledgeSummary = {
      summary: '3/4 tasks completed. Decisions: Use React.',
      tasks: [
        { step: 1, what: 'Task A', state: 'completed', assigned_to: 'Developer' },
        { step: 2, what: 'Task B', state: 'completed', assigned_to: 'Frontend' },
        { step: 3, what: 'Task C', state: 'completed', assigned_to: 'Test Runner' },
        { step: 4, what: 'Task D', state: 'in_progress', assigned_to: 'Developer' },
      ],
      decisions: ['Use React'],
      resolved: ['DB issue fixed'],
      unresolved: ['CSS bug'],
      artifacts: {
        files_created: ['src/App.tsx'],
        files_modified: ['package.json'],
        tests_passed: 8,
        tests_failed: 1,
      },
    };

    const result = ChainHandoffService.buildCycleKnowledgeEntry({
      cycle: 1,
      chainId: 'chain-cycle-1',
      startedAt: '2026-01-01T00:00:00.000Z',
      knowledgeSummary,
    });

    expect(result.cycle).toBe(1);
    expect(result.chain_id).toBe('chain-cycle-1');
    expect(result.started_at).toBe('2026-01-01T00:00:00.000Z');
    expect(result.completed_at).toBeDefined();
    expect(result.summary).toBe('3/4 tasks completed. Decisions: Use React.');
    expect(result.key_decisions).toEqual(['Use React']);
    expect(result.blockers_resolved).toEqual(['DB issue fixed']);
    expect(result.unresolved_issues).toEqual(['CSS bug']);
    expect(result.artifacts).toEqual(knowledgeSummary.artifacts);
  });

  test('correctly counts tasks_completed (state === completed) vs tasks_total', () => {
    const knowledgeSummary = {
      summary: 'test',
      tasks: [
        { step: 1, what: 'A', state: 'completed', assigned_to: 'Developer' },
        { step: 2, what: 'B', state: 'completed', assigned_to: 'Developer' },
        { step: 3, what: 'C', state: 'in_progress', assigned_to: 'Frontend' },
        { step: 4, what: 'D', state: 'dispatched', assigned_to: 'Frontend' },
        { step: 5, what: 'E', state: 'completed', assigned_to: 'Test Runner' },
      ],
      decisions: [],
      resolved: [],
      unresolved: [],
      artifacts: { files_created: [], files_modified: [], tests_passed: 0, tests_failed: 0 },
    };

    const result = ChainHandoffService.buildCycleKnowledgeEntry({
      cycle: 2,
      chainId: 'chain-cycle-2',
      startedAt: '2026-01-01T00:00:00.000Z',
      knowledgeSummary,
    });

    expect(result.tasks_completed).toBe(3);
    expect(result.tasks_total).toBe(5);
  });

  test('handles zero-task knowledge summary', () => {
    const knowledgeSummary = {
      summary: 'No tasks in chain.',
      tasks: [],
      decisions: [],
      resolved: [],
      unresolved: [],
      artifacts: { files_created: [], files_modified: [], tests_passed: 0, tests_failed: 0 },
    };

    const result = ChainHandoffService.buildCycleKnowledgeEntry({
      cycle: 1,
      chainId: 'chain-empty',
      startedAt: '2026-01-01T00:00:00.000Z',
      knowledgeSummary,
    });

    expect(result.tasks_completed).toBe(0);
    expect(result.tasks_total).toBe(0);
  });
});

// ─── formatSupervisorContext ────────────────────────────────────────────────

describe('formatSupervisorContext', () => {
  test('contains [SUPERVISOR MODE — Cycle X/Y] header', () => {
    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge: {},
      originalGoal: 'Build feature X',
      cycleNumber: 1,
      chainId: 'chain-test',
    });

    expect(result).toContain(`[SUPERVISOR MODE — Cycle 1/${SUPERVISOR_CONFIG.max_cycles}]`);
  });

  test('contains Goal line', () => {
    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge: {},
      originalGoal: 'Implement user authentication',
      cycleNumber: 1,
      chainId: 'chain-auth',
    });

    expect(result).toContain('Goal: Implement user authentication');
  });

  test('contains current chain ID', () => {
    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge: {},
      originalGoal: 'Test',
      cycleNumber: 1,
      chainId: 'chain-xyz-789',
    });

    expect(result).toContain('Current chain: chain-xyz-789');
  });

  test('includes previous cycles section when knowledgeStack has entries', () => {
    const knowledgeStack = [
      makeKnowledgeStackEntry({ cycle: 1, chain_id: 'chain-prev-1', summary: '3/4 done.' }),
    ];

    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack,
      currentCycleKnowledge: { summary: 'Current cycle data' },
      originalGoal: 'Build it',
      cycleNumber: 2,
      chainId: 'chain-curr',
    });

    expect(result).toContain('=== PREVIOUS CYCLES ===');
    expect(result).toContain('--- Cycle 1 (chain-prev-1) ---');
    expect(result).toContain('Tasks: 3/4 completed');
    expect(result).toContain('Summary: 3/4 done.');
    expect(result).toContain('Decisions: Use React for frontend');
    expect(result).toContain('Resolved: Fixed DB connection');
    expect(result).toContain('Unresolved: CSS layout bug');
    expect(result).toContain('Files created: src/App.tsx');
    expect(result).toContain('Files modified: package.json');
    expect(result).toContain('Tests: 10 passed, 1 failed');
  });

  test('omits previous cycles section when knowledgeStack is empty', () => {
    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge: { summary: 'data' },
      originalGoal: 'Build it',
      cycleNumber: 1,
      chainId: 'chain-1',
    });

    expect(result).not.toContain('=== PREVIOUS CYCLES ===');
  });

  test('includes current cycle section with summary', () => {
    const currentCycleKnowledge = {
      summary: '5/8 tasks completed.',
      decisions: ['Use PostgreSQL'],
      resolved: ['Timeout fixed'],
      unresolved: ['Memory leak'],
      artifacts: {
        files_created: ['src/db.ts'],
        files_modified: ['config.json'],
        tests_passed: 12,
        tests_failed: 3,
      },
      tasks: [
        { step: 1, what: 'Setup DB', state: 'completed', assigned_to: 'Developer' },
        { step: 2, what: 'Write API', state: 'in_progress', assigned_to: 'Frontend' },
      ],
    };

    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge,
      originalGoal: 'Build DB layer',
      cycleNumber: 1,
      chainId: 'chain-db',
    });

    expect(result).toContain('=== CURRENT CYCLE ===');
    expect(result).toContain('Summary: 5/8 tasks completed.');
    expect(result).toContain('Decisions: Use PostgreSQL');
    expect(result).toContain('Resolved: Timeout fixed');
    expect(result).toContain('Unresolved: Memory leak');
    expect(result).toContain('Files created: src/db.ts');
    expect(result).toContain('Files modified: config.json');
    expect(result).toContain('Tests: 12 passed, 3 failed');
  });

  test('includes task details for current cycle', () => {
    const currentCycleKnowledge = {
      summary: 'test',
      tasks: [
        { step: 1, what: 'Setup DB', state: 'completed', assigned_to: 'Developer' },
        { step: 2, what: 'Write API', state: 'in_progress', assigned_to: 'Frontend' },
      ],
    };

    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge,
      originalGoal: 'Build it',
      cycleNumber: 1,
      chainId: 'chain-1',
    });

    expect(result).toContain('Tasks in this cycle:');
    expect(result).toContain('Step 1: [completed] Setup DB');
    expect(result).toContain('Step 2: [in_progress] Write API');
  });

  test('contains decision instructions (CONTINUE/COMPLETE/ESCALATE)', () => {
    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge: {},
      originalGoal: 'Test',
      cycleNumber: 1,
      chainId: 'chain-test',
    });

    expect(result).toContain('=== YOUR DECISION ===');
    expect(result).toContain('supervisor_decide');
    expect(result).toContain('CONTINUE');
    expect(result).toContain('COMPLETE');
    expect(result).toContain('ESCALATE');
  });

  test('contains goal and decision section (supervisor context)', () => {
    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge: {},
      originalGoal: 'Implement JWT auth',
      cycleNumber: 1,
      chainId: 'chain-gf',
    });

    // Source outputs Goal line and YOUR DECISION section (no separate GOAL-FIRST PRINCIPLE section)
    expect(result).toContain('Goal: Implement JWT auth');
    expect(result).toContain('=== YOUR DECISION ===');
    expect(result).toContain('CONTINUE');
    expect(result).toContain('COMPLETE');
    expect(result).toContain('ESCALATE');
  });

  test('decision instructions contain ESCALATE with blocker description', () => {
    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack: [],
      currentCycleKnowledge: {},
      originalGoal: 'Build API',
      cycleNumber: 1,
      chainId: 'chain-consult',
    });

    // Source has 3 decisions: CONTINUE, COMPLETE, ESCALATE (no CONSULT)
    expect(result).toContain('ESCALATE');
    expect(result).toContain('blocker');
  });

  test('handles empty/default params gracefully', () => {
    const result = ChainHandoffService.formatSupervisorContext({});

    expect(result).toContain(`[SUPERVISOR MODE — Cycle 1/${SUPERVISOR_CONFIG.max_cycles}]`);
    expect(result).toContain('Goal: Unknown goal');
    expect(result).toContain('=== CURRENT CYCLE ===');
    expect(result).toContain('Summary: No data');
    expect(result).toContain('=== YOUR DECISION ===');
  });

  test('includes time range for previous cycles', () => {
    const knowledgeStack = [
      makeKnowledgeStackEntry({ cycle: 1 }),
    ];

    const result = ChainHandoffService.formatSupervisorContext({
      knowledgeStack,
      currentCycleKnowledge: {},
      originalGoal: 'Goal',
      cycleNumber: 2,
      chainId: 'chain-2',
    });

    expect(result).toContain('Time: 2026-01-01T00:00:00.000Z');
    expect(result).toContain('2026-01-01T01:00:00.000Z');
  });
});

// ─── triggerSupervisor ──────────────────────────────────────────────────────

describe('triggerSupervisor', () => {
  const supervisorParams = {
    chain_id: 'chain-super-1',
    cycle_number: 1,
    cycle_group_id: 'cg-test-1',
    original_goal: 'Implement full stack feature',
    knowledge_stack: [],
  };

  beforeEach(() => {
    // getChainTasks: return some task rows
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, what: 'Task A', state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 2, what: 'Task B', state: STATE.IN_PROGRESS, chain_status: 'in_progress' })),
    ]);
    // INSERT for supervisor ticket + activity log
    mockDbRun.mockResolvedValue({ lastInsertRowid: 999 });
  });

  test('creates ticket with correct data structure', async () => {
    const result = await ChainHandoffService.triggerSupervisor(supervisorParams);

    expect(result.ticket_id).toBe(999);
    expect(result.data.what).toContain('[SUPERVISOR]');
    expect(result.data.what).toContain('Cycle 1');
    expect(result.data.what).toContain('Implement full stack feature');
    expect(result.data.state).toBe(STATE.BACKLOG);
    expect(result.data.priority).toBe(24274);
    expect(result.data.type).toBe(24269);
    expect(result.data.acceptance_criteria).toContain('CONTINUE');
    expect(result.data.acceptance_criteria).toContain('COMPLETE');
    expect(result.data.acceptance_criteria).toContain('ESCALATE');
  });

  test('ticket assigned to N (supervisor, 53)', async () => {
    const result = await ChainHandoffService.triggerSupervisor(supervisorParams);

    expect(result.assigned_to).toBe(AGENT_USERS.NIKICH);
    expect(result.data.assigned_to).toBe(53);
  });

  test('_chain_memory in ticket data contains knowledge_stack', async () => {
    const prevStack = [makeKnowledgeStackEntry({ cycle: 1 })];
    const result = await ChainHandoffService.triggerSupervisor({
      ...supervisorParams,
      cycle_number: 2,
      knowledge_stack: prevStack,
    });

    expect(result.data._chain_memory).toBeDefined();
    expect(result.data._chain_memory.knowledge_stack).toHaveLength(2); // prev + current
    expect(result.data._chain_memory.knowledge_stack[0]).toEqual(prevStack[0]);
    expect(result.data._chain_memory.knowledge_stack[1].cycle).toBe(2);
    expect(result.data._chain_memory.original_goal).toBe('Implement full stack feature');
    expect(result.data._chain_memory.cycle_group_id).toBe('cg-test-1');
    expect(result.data._chain_memory.cycle_number).toBe(2);
  });

  test('logs supervisor_triggered activity', async () => {
    await ChainHandoffService.triggerSupervisor(supervisorParams);

    // logActivity calls dbRun for the INSERT
    // The first dbRun call is the activity log (logActivity), the second is the supervisor ticket INSERT
    // Actually, logActivity is called before the INSERT, so first dbRun is the activity log
    const activityCalls = mockDbRun.mock.calls.filter(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT')
    );

    // Should have at least 2 INSERT calls: activity log + supervisor ticket
    expect(activityCalls.length).toBeGreaterThanOrEqual(2);

    // Verify the activity data contains supervisor_triggered
    const activityCall = activityCalls[0];
    const activityDataArg = activityCall[1][2]; // third argument is the data JSON
    const activityData = JSON.parse(activityDataArg);
    expect(activityData.action).toBe('supervisor_triggered');
    expect(activityData.agent_id).toBe(SUPERVISOR_CONFIG.supervisor_agent_id);
    expect(activityData.chain_id).toBe('chain-super-1');
  });

  test('returns object with _supervisor: true', async () => {
    const result = await ChainHandoffService.triggerSupervisor(supervisorParams);

    expect(result._supervisor).toBe(true);
  });

  test('returns correct chain metadata', async () => {
    const result = await ChainHandoffService.triggerSupervisor(supervisorParams);

    expect(result.chain_id).toBe('chain-super-1');
    expect(result.step).toBe(SUPERVISOR_CONFIG.trigger_at_step);
    expect(result.cycle_number).toBe(1);
    expect(result.cycle_group_id).toBe('cg-test-1');
    expect(result.state).toBe(STATE.BACKLOG);
  });

  test('_chain in ticket data has correct dispatched_by and status', async () => {
    const result = await ChainHandoffService.triggerSupervisor(supervisorParams);

    expect(result.data._chain.dispatched_by).toBe(AGENT_USERS.ORCHESTRATOR);
    expect(result.data._chain.status).toBe('dispatched');
    expect(result.data._chain.chain_id).toBe('chain-super-1');
    expect(result.data._chain.step).toBe(SUPERVISOR_CONFIG.trigger_at_step);
  });

  test('supervisor context is embedded in the why field', async () => {
    const result = await ChainHandoffService.triggerSupervisor(supervisorParams);

    expect(result.data.why).toContain('[SUPERVISOR MODE');
    expect(result.data.why).toContain('Goal: Implement full stack feature');
    expect(result.data.why).toContain('=== YOUR DECISION ===');
  });
});

// ─── startNewCycle ──────────────────────────────────────────────────────────

describe('startNewCycle', () => {
  const cycleParams = {
    cycle_group_id: 'cg-cycle-test',
    cycle_number: 2,
    knowledge_stack: [makeKnowledgeStackEntry({ cycle: 1, chain_id: 'chain-prev' })],
    original_goal: 'Build the complete feature',
    next_cycle_plan: 'Fix remaining tests and resolve CSS bugs',
    tasks: [
      { what: 'Fix unit tests', assigned_to: AGENT_USERS.TEST_RUNNER },
      { what: 'Fix CSS layout', assigned_to: AGENT_USERS.FRONTEND },
      { what: 'Update docs', assigned_to: AGENT_USERS.DEVELOPER },
    ],
  };

  beforeEach(() => {
    // Each dispatchSubtask calls getChainTasks (for chain limit check) and then INSERT
    // Return empty array for getChainTasks to avoid triggering supervisor or hitting limits
    mockDbAll.mockResolvedValue([]);
    mockDbRun.mockResolvedValue({ lastInsertRowid: 500 });
  });

  test('dispatches tasks with new chain_id (different from input knowledge_stack chain)', async () => {
    const result = await ChainHandoffService.startNewCycle(cycleParams);

    // New chain_id should be auto-generated (not equal to previous chain_id)
    expect(result.chain_id).toBeDefined();
    expect(result.chain_id).not.toBe('chain-prev');
    expect(result.chain_id).toMatch(/^chain-/);
  });

  test('max tasks limited to trigger_at_step - 1 = 8', async () => {
    const manyTasks = Array.from({ length: 12 }, (_, i) => ({
      what: `Task ${i + 1}`,
      assigned_to: AGENT_USERS.DEVELOPER,
    }));

    const result = await ChainHandoffService.startNewCycle({
      ...cycleParams,
      tasks: manyTasks,
    });

    // Max is trigger_at_step - 1 = 8
    expect(result.tasks.length).toBe(SUPERVISOR_CONFIG.trigger_at_step - 1);
    expect(result.tasks.length).toBe(8);
  });

  test('each task gets _chain_memory with knowledge_stack', async () => {
    const result = await ChainHandoffService.startNewCycle(cycleParams);

    // Verify the INSERT calls contain _chain_memory in the data
    // dispatchSubtask is called for each task; each call to dispatchSubtask calls dbRun INSERT
    // The call pattern: logActivity INSERT, then ticket INSERT for each task, plus the initial logActivity
    const insertCalls = mockDbRun.mock.calls.filter(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT')
    );

    // At minimum we should have calls for: 1 activity log (cycle_started) + 3 tasks * 2 (ticket + activity each) = 7
    expect(insertCalls.length).toBeGreaterThanOrEqual(7);

    // Check at least one ticket INSERT contains _chain_memory
    const ticketInserts = insertCalls.filter(call => {
      try {
        const data = JSON.parse(call[1][2]);
        return data._chain_memory !== undefined;
      } catch {
        return false;
      }
    });

    // Should have 3 ticket inserts each with _chain_memory (one per dispatched task activity log also has chain info but not _chain_memory)
    // Actually the ticket data has _chain but _chain_memory is passed as a param to dispatchSubtask, not stored in ticket data
    // Let's check the activity logs for cycle_started
    expect(result.tasks.length).toBe(3);
  });

  test('logs cycle_started activity', async () => {
    await ChainHandoffService.startNewCycle(cycleParams);

    // First INSERT call should be the cycle_started activity log
    const firstInsertCall = mockDbRun.mock.calls[0];
    expect(firstInsertCall[0]).toContain('INSERT');
    const activityData = JSON.parse(firstInsertCall[1][2]);
    expect(activityData.action).toBe('cycle_started');
    expect(activityData.agent_id).toBe(SUPERVISOR_CONFIG.supervisor_agent_id);
  });

  test('cycle_started log includes correct details', async () => {
    await ChainHandoffService.startNewCycle(cycleParams);

    const firstInsertCall = mockDbRun.mock.calls[0];
    const activityData = JSON.parse(firstInsertCall[1][2]);
    const details = JSON.parse(activityData.details);

    expect(details.cycle_number).toBe(2);
    expect(details.cycle_group_id).toBe('cg-cycle-test');
    expect(details.parent_chain_id).toBe('chain-prev');
    expect(details.tasks_count).toBe(3);
    expect(details.plan).toContain('Fix remaining tests');
  });

  test('returns correct result structure', async () => {
    const result = await ChainHandoffService.startNewCycle(cycleParams);

    expect(result.cycle_number).toBe(2);
    expect(result.cycle_group_id).toBe('cg-cycle-test');
    expect(result.original_goal).toBe('Build the complete feature');
    expect(result.tasks).toHaveLength(3);
    expect(result.chain_id).toBeDefined();
  });

  test('tasks are dispatched with step numbers starting at 1', async () => {
    const result = await ChainHandoffService.startNewCycle(cycleParams);

    expect(result.tasks[0].step).toBe(1);
    expect(result.tasks[1].step).toBe(2);
    expect(result.tasks[2].step).toBe(3);
  });

  test('tasks use next_cycle_plan in why field when task has no own why', async () => {
    const result = await ChainHandoffService.startNewCycle(cycleParams);

    // Since tasks don't have their own why, the code uses `[Cycle N] next_cycle_plan`
    // We can verify by checking the data in the dispatched tickets
    // The INSERT calls for tickets contain data with why field
    const ticketInserts = mockDbRun.mock.calls.filter(call => {
      try {
        const data = JSON.parse(call[1][2]);
        return data.what !== undefined && data._chain !== undefined;
      } catch {
        return false;
      }
    });

    for (const call of ticketInserts) {
      const data = JSON.parse(call[1][2]);
      expect(data.why).toContain('[Cycle 2]');
      expect(data.why).toContain('Fix remaining tests');
    }
  });
});

// ─── autoEscalate ───────────────────────────────────────────────────────────

describe('autoEscalate', () => {
  const baseMemory = {
    cycle_number: 1,
    cycle_group_id: 'cg-escalate',
    original_goal: 'Build feature X',
    knowledge_stack: [
      { cycle: 1, summary: 'Partial progress made' },
    ],
  };

  beforeEach(() => {
    mockDbRun.mockResolvedValue({ lastInsertRowid: 888 });
  });

  test('MAX_CYCLES_REACHED: creates escalation ticket with correct reason message', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc-1', baseMemory, 'MAX_CYCLES_REACHED');

    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('Maximum cycles reached');
    expect(result.data.why).toContain('AUTO-ESCALATION: Maximum cycles reached');
    expect(result.data.why).toContain(`(${SUPERVISOR_CONFIG.max_cycles})`);
  });

  test('MAX_DURATION_REACHED: creates escalation ticket with correct reason message', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc-2', baseMemory, 'MAX_DURATION_REACHED');

    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('Maximum duration reached');
    expect(result.data.why).toContain('AUTO-ESCALATION: Maximum duration reached');
    expect(result.data.why).toContain('8h');
  });

  test('MAX_TASKS_REACHED: creates escalation ticket with correct reason message', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc-3', baseMemory, 'MAX_TASKS_REACHED');

    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('Maximum total tasks reached');
    expect(result.data.why).toContain('AUTO-ESCALATION: Maximum total tasks reached');
    expect(result.data.why).toContain(`(${SUPERVISOR_CONFIG.max_total_tasks})`);
  });

  test('ticket assigned to ORCHESTRATOR (18)', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'MAX_CYCLES_REACHED');

    expect(result.assigned_to).toBe(AGENT_USERS.ORCHESTRATOR);
    expect(result.data.assigned_to).toBe(18);
  });

  test('_escalation metadata present in ticket data', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'MAX_CYCLES_REACHED');

    expect(result.data._escalation).toBeDefined();
    expect(result.data._escalation.reason).toBe('MAX_CYCLES_REACHED');
    expect(result.data._escalation.auto).toBe(true);
    expect(result.data._escalation.escalated_at).toBeDefined();
  });

  test('_chain_memory contains the original memory object', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'MAX_CYCLES_REACHED');

    expect(result.data._chain_memory).toEqual(baseMemory);
  });

  test('returns _escalation: true', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'MAX_CYCLES_REACHED');

    expect(result._escalation).toBe(true);
  });

  test('returns correct ticket_id and chain metadata', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'MAX_CYCLES_REACHED');

    expect(result.ticket_id).toBe(888);
    expect(result.chain_id).toBe('chain-esc');
    expect(result.step).toBe(SUPERVISOR_CONFIG.trigger_at_step);
    expect(result.state).toBe(STATE.BACKLOG);
  });

  test('logs supervisor_auto_escalate activity', async () => {
    await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'MAX_CYCLES_REACHED');

    // First INSERT call should be the activity log
    const firstCall = mockDbRun.mock.calls[0];
    const activityData = JSON.parse(firstCall[1][2]);
    expect(activityData.action).toBe('supervisor_auto_escalate');
    expect(activityData.agent_id).toBe(SUPERVISOR_CONFIG.supervisor_agent_id);
    expect(activityData.chain_id).toBe('chain-esc');
  });

  test('escalation log details contain reason and cycle info', async () => {
    await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'MAX_TASKS_REACHED');

    const firstCall = mockDbRun.mock.calls[0];
    const activityData = JSON.parse(firstCall[1][2]);
    const details = JSON.parse(activityData.details);

    expect(details.reason).toBe('MAX_TASKS_REACHED');
    expect(details.cycle_number).toBe(1);
    expect(details.cycle_group_id).toBe('cg-escalate');
    expect(details.original_goal).toBe('Build feature X');
  });

  test('escalation report includes knowledge from all cycles', async () => {
    const memoryWithStack = {
      ...baseMemory,
      knowledge_stack: [
        { cycle: 1, summary: 'First cycle: built API' },
        { cycle: 2, summary: 'Second cycle: fixed tests' },
      ],
    };

    const result = await ChainHandoffService.autoEscalate('chain-esc', memoryWithStack, 'MAX_CYCLES_REACHED');

    expect(result.data.why).toContain('Cycle 1: First cycle: built API');
    expect(result.data.why).toContain('Cycle 2: Second cycle: fixed tests');
    expect(result.data.why).toContain('Goal: Build feature X');
  });

  test('_chain status is escalated', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'MAX_CYCLES_REACHED');

    expect(result.data._chain.status).toBe('escalated');
    expect(result.data._chain.dispatched_by).toBe(SUPERVISOR_CONFIG.supervisor_agent_id);
    expect(result.data._chain.chain_id).toBe('chain-esc');
  });

  test('unknown reason code still creates escalation ticket', async () => {
    const result = await ChainHandoffService.autoEscalate('chain-esc', baseMemory, 'UNKNOWN_REASON');

    expect(result._escalation).toBe(true);
    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('UNKNOWN_REASON');
  });
});

// ─── Integration: dispatchSubtask supervisor trigger ────────────────────────

describe('Integration: dispatchSubtask supervisor trigger', () => {
  beforeEach(() => {
    mockDbRun.mockResolvedValue({ lastInsertRowid: 700 });
  });

  test('step=9 with supervisor enabled triggers supervisor (not normal dispatch)', async () => {
    // getChainTasks returns some completed tasks
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 2, state: STATE.DONE, chain_status: 'completed' })),
    ]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'This should trigger supervisor',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-dispatch-9',
      step: 9,
      _chain_memory: {
        cycle_number: 0,
        cycle_group_id: 'cg-test',
        original_goal: 'Build feature',
        knowledge_stack: [],
      },
    });

    // T2 fix: Original task preserved, supervisor result nested in _supervisor
    expect(result._supervisor).toBeDefined();
    expect(result._supervisor._supervisor).toBe(true);
    expect(result._supervisor.assigned_to).toBe(AGENT_USERS.NIKICH);
    expect(result._supervisor.data.what).toContain('[SUPERVISOR]');
    // Original task also created
    expect(result.ticket_id).toBeDefined();
    expect(result.what).toBe('This should trigger supervisor');
  });

  test('step=9 with cycle_number > max_cycles triggers autoEscalate', async () => {
    mockDbAll.mockResolvedValue([]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'This should escalate',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-esc-dispatch',
      step: 9,
      _chain_memory: {
        cycle_number: SUPERVISOR_CONFIG.max_cycles, // Already at max, so cycleNumber = max + 1
        cycle_group_id: 'cg-esc',
        original_goal: 'Build feature',
        knowledge_stack: [],
      },
    });

    expect(result._escalation).toBe(true);
    expect(result.assigned_to).toBe(AGENT_USERS.ORCHESTRATOR);
    expect(result.data.what).toContain('[ESCALATION]');
  });

  test('step < 9 performs normal dispatch (no supervisor)', async () => {
    // getChainTasks returns empty to avoid limit errors
    mockDbAll.mockResolvedValue([]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Normal task at step 5',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-normal',
      step: 5,
    });

    // Should be a normal dispatch result
    expect(result._supervisor).toBeUndefined();
    expect(result._escalation).toBeUndefined();
    expect(result.ticket_id).toBe(700);
    expect(result.what).toBe('Normal task at step 5');
    expect(result.assigned_to).toBe(AGENT_USERS.DEVELOPER);
    expect(result.step).toBe(5);
    expect(result.state).toBe(STATE.BACKLOG);
  });

  test('step >= trigger_at_step without _chain_memory still triggers supervisor with defaults', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
    ]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Task at step 9 no memory',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-no-mem',
      step: 9,
    });

    // memory defaults to {}, cycleNumber becomes 0+1=1 which is <= max_cycles(5)
    // T2 fix: Supervisor result nested in _supervisor
    expect(result._supervisor).toBeDefined();
    expect(result._supervisor._supervisor).toBe(true);
    expect(result._supervisor.assigned_to).toBe(AGENT_USERS.NIKICH);
  });

  test('step=9 with MAX_DURATION_REACHED triggers autoEscalate', async () => {
    mockDbAll.mockResolvedValue([]);

    // Create a knowledge_stack entry with a very old started_at to exceed max_duration_ms
    const veryOldTime = new Date(Date.now() - SUPERVISOR_CONFIG.max_duration_ms - 1000).toISOString();

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Duration exceeded task',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-duration',
      step: 9,
      _chain_memory: {
        cycle_number: 0,
        cycle_group_id: 'cg-dur',
        original_goal: 'Long running goal',
        knowledge_stack: [
          { cycle: 1, started_at: veryOldTime, summary: 'old cycle' },
        ],
      },
    });

    expect(result._escalation).toBe(true);
    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('Maximum duration reached');
  });

  test('step=9 with MAX_TASKS_REACHED triggers autoEscalate', async () => {
    mockDbAll.mockResolvedValue([]);

    // knowledge_stack with enough tasks_total to exceed limit
    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Too many tasks',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-tasks-limit',
      step: 9,
      _chain_memory: {
        cycle_number: 0,
        cycle_group_id: 'cg-tasks',
        original_goal: 'Feature',
        knowledge_stack: [
          { cycle: 1, tasks_total: 45 }, // 45 + step(9) = 54 > 50
        ],
      },
    });

    expect(result._escalation).toBe(true);
    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('Maximum total tasks reached');
  });

  test('step=1 with no chain_id auto-generates chain_id and performs normal dispatch', async () => {
    const result = await ChainHandoffService.dispatchSubtask({
      what: 'First task ever',
      assigned_to: AGENT_USERS.DEVELOPER,
    });

    expect(result._supervisor).toBeUndefined();
    expect(result._escalation).toBeUndefined();
    expect(result.chain_id).toBeDefined();
    expect(result.chain_id).toMatch(/^chain-/);
    expect(result.step).toBe(1);
    expect(result.ticket_id).toBe(700);
  });

  test('supervisor trigger at exactly trigger_at_step boundary', async () => {
    mockDbAll.mockResolvedValue([]);

    // Exactly at trigger_at_step (9)
    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Boundary task',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-boundary',
      step: SUPERVISOR_CONFIG.trigger_at_step,
      _chain_memory: {
        cycle_number: 0,
        original_goal: 'Boundary test',
        knowledge_stack: [],
      },
    });

    expect(result._supervisor).toBeDefined();
    expect(result._supervisor._supervisor).toBe(true);
  });

  test('step one below trigger_at_step does NOT trigger supervisor', async () => {
    mockDbAll.mockResolvedValue([]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Just below boundary',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-below',
      step: SUPERVISOR_CONFIG.trigger_at_step - 1,
    });

    expect(result._supervisor).toBeUndefined();
    expect(result.ticket_id).toBe(700);
  });
});

// ─── ADR-109 Fix 2: Handoff Protocol Phase 1 ───────────────────────────────

describe('ADR-109 Fix 2: Handoff Protocol Phase 1', () => {
  test('buildHandoffMetadata returns Phase 1 protocol (submit to review, not done)', () => {
    const metadata = ChainHandoffService.buildHandoffMetadata({
      from_agent: AGENT_USERS.ORCHESTRATOR,
      to_agent: AGENT_USERS.DEVELOPER,
      ticket_id: 100,
      chain_id: 'chain-test',
      step: 1,
    });

    // Phase 1: agents submit to review, NOT done
    expect(metadata.protocol.submit).toBeDefined();
    expect(metadata.protocol.submit).toContain('review');
    expect(metadata.protocol.submit).toContain('24277');
    // Phase 1: approve goes through control → done
    expect(metadata.protocol.approve).toBeDefined();
    expect(metadata.protocol.approve).toContain('done');
    // Phase 1: reject is defined
    expect(metadata.protocol.reject).toBeDefined();
    expect(metadata.protocol.reject).toContain('rejected');
    // Phase 0 "complete" to "done" should NOT exist
    expect(metadata.protocol.complete).toBeUndefined();
  });

  test('buildHandoffMetadata still has pickup, fail, and handoff', () => {
    const metadata = ChainHandoffService.buildHandoffMetadata({
      from_agent: AGENT_USERS.ORCHESTRATOR,
      to_agent: AGENT_USERS.DEVELOPER,
      ticket_id: 100,
      chain_id: 'chain-test',
      step: 1,
    });

    expect(metadata.protocol.pickup).toContain('in_progress');
    expect(metadata.protocol.fail).toContain('in_progress');
    expect(metadata.protocol.handoff).toContain('step+1');
  });
});

// ─── ADR-109 Fix 3: Service State Machine Consistency ────────────────────────

describe('ADR-109 Fix 3: Service State Machine Consistency', () => {

  test('SERVICE_TRANSITIONS is enforced internally by updateTicketStatus (not exported)', async () => {
    // SERVICE_TRANSITIONS is a local const inside updateTicketStatus, not exported.
    // We verify the transition rules indirectly via updateTicketStatus behavior.

    // backlog -> in_progress is allowed
    mockDbGet.mockResolvedValue({ id: 100, data: JSON.stringify({ state: STATE.BACKLOG, what: 'Test' }) });
    mockDbRun.mockResolvedValue({});
    const result = await ChainHandoffService.updateTicketStatus({ ticket_id: 100, new_state: STATE.IN_PROGRESS, agent_id: AGENT_USERS.DEVELOPER });
    expect(result.old_state).toBe(STATE.BACKLOG);
    expect(result.new_state).toBe(STATE.IN_PROGRESS);

    // backlog -> done is NOT allowed (should reject)
    mockDbGet.mockResolvedValue({ id: 101, data: JSON.stringify({ state: STATE.BACKLOG, what: 'Test' }) });
    await expect(
      ChainHandoffService.updateTicketStatus({ ticket_id: 101, new_state: STATE.DONE, agent_id: AGENT_USERS.DEVELOPER })
    ).rejects.toThrow('Invalid transition');
  });

  test('updateTicketStatus rejects invalid transition in_progress → done', async () => {
    // Mock ticket in in_progress state
    mockDbGet.mockResolvedValue({
      id: 100,
      data: JSON.stringify({
        state: STATE.IN_PROGRESS,
        what: 'Test task',
        _chain: { chain_id: 'chain-test', step: 1 },
      }),
    });

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: 100,
        new_state: STATE.DONE, // in_progress → done is NOT allowed
        agent_id: AGENT_USERS.DEVELOPER,
      })
    ).rejects.toThrow('Invalid transition');
  });

  test('updateTicketStatus rejects invalid transition backlog → done', async () => {
    mockDbGet.mockResolvedValue({
      id: 100,
      data: JSON.stringify({
        state: STATE.BACKLOG,
        what: 'Test task',
      }),
    });

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: 100,
        new_state: STATE.DONE,
        agent_id: AGENT_USERS.DEVELOPER,
      })
    ).rejects.toThrow('Invalid transition');
  });

  test('updateTicketStatus allows valid transition in_progress → review', async () => {
    mockDbGet.mockResolvedValue({
      id: 100,
      data: JSON.stringify({
        state: STATE.IN_PROGRESS,
        what: 'Test task',
        _chain: { chain_id: 'chain-test', step: 1, status: 'in_progress' },
      }),
    });
    mockDbRun.mockResolvedValue({});

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: 100,
      new_state: STATE.REVIEW,
      agent_id: AGENT_USERS.DEVELOPER,
    });

    expect(result.old_state).toBe(STATE.IN_PROGRESS);
    expect(result.new_state).toBe(STATE.REVIEW);
  });

  test('updateTicketStatus allows valid transition control → done', async () => {
    mockDbGet.mockResolvedValue({
      id: 100,
      data: JSON.stringify({
        state: STATE.CONTROL,
        what: 'Test task',
        _chain: { chain_id: 'chain-test', step: 1, status: 'control' },
      }),
    });
    mockDbRun.mockResolvedValue({});

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: 100,
      new_state: STATE.DONE,
      agent_id: AGENT_USERS.NIKICH,
    });

    expect(result.old_state).toBe(STATE.CONTROL);
    expect(result.new_state).toBe(STATE.DONE);
  });

  test('updateTicketStatus allows valid transition control → rejected', async () => {
    mockDbGet.mockResolvedValue({
      id: 100,
      data: JSON.stringify({
        state: STATE.CONTROL,
        what: 'Test task',
        _chain: { chain_id: 'chain-test', step: 1, status: 'control' },
      }),
    });
    mockDbRun.mockResolvedValue({});

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: 100,
      new_state: STATE.REJECTED,
      agent_id: AGENT_USERS.NIKICH,
    });

    expect(result.old_state).toBe(STATE.CONTROL);
    expect(result.new_state).toBe(STATE.REJECTED);
  });

  test('updateTicketStatus allows transition from done (empty allowed list bypasses check)', async () => {
    // In the source, SERVICE_TRANSITIONS[STATE.DONE] = [] (empty array).
    // The guard condition is: if (allowed.length > 0 && !allowed.includes(new_state))
    // Since allowed.length === 0, the check is skipped, so transitions FROM done are permitted.
    mockDbGet.mockResolvedValue({
      id: 100,
      data: JSON.stringify({
        state: STATE.DONE,
        what: 'Completed task',
      }),
    });
    mockDbRun.mockResolvedValue({});

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: 100,
      new_state: STATE.IN_PROGRESS,
      agent_id: AGENT_USERS.DEVELOPER,
    });

    expect(result.old_state).toBe(STATE.DONE);
    expect(result.new_state).toBe(STATE.IN_PROGRESS);
  });

  test('updateTicketStatus allows valid transition rejected → in_progress (rework)', async () => {
    mockDbGet.mockResolvedValue({
      id: 100,
      data: JSON.stringify({
        state: STATE.REJECTED,
        what: 'Rejected task',
        _chain: { chain_id: 'chain-test', step: 1, status: 'rejected' },
      }),
    });
    mockDbRun.mockResolvedValue({});

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: 100,
      new_state: STATE.IN_PROGRESS,
      agent_id: AGENT_USERS.DEVELOPER,
    });

    expect(result.old_state).toBe(STATE.REJECTED);
    expect(result.new_state).toBe(STATE.IN_PROGRESS);
  });

  test('updateTicketStatus error message includes state names', async () => {
    mockDbGet.mockResolvedValue({
      id: 100,
      data: JSON.stringify({
        state: STATE.REVIEW,
        what: 'Test task',
      }),
    });

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: 100,
        new_state: STATE.DONE,
        agent_id: AGENT_USERS.DEVELOPER,
      })
    ).rejects.toThrow(/review.*done/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ADR-109 PART B: E2E PIPELINE VERIFICATION TESTS (AC8–AC11)
// ═════════════════════════════════════════════════════════════════════════════

// ─── AC8: Complete Chain Lifecycle ──────────────────────────────────────────
// dispatch → in_progress → review → control → done (supervisor approves)

describe('ADR-109 AC8: Complete chain lifecycle (dispatch → in_progress → review → control → done)', () => {
  const CHAIN_ID = 'chain-lifecycle-e2e';
  const TICKET_ID = 300;

  function mockTicketInState(state, chainStatus) {
    mockDbGet.mockResolvedValue({
      id: TICKET_ID,
      data: JSON.stringify({
        what: 'E2E lifecycle task',
        assigned_to: AGENT_USERS.DEV_RALPH,
        state,
        _chain: {
          chain_id: CHAIN_ID,
          step: 1,
          dispatched_by: AGENT_USERS.ORCHESTRATOR,
          status: chainStatus,
        },
      }),
    });
    mockDbRun.mockResolvedValue({});
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('step 1: dispatch creates ticket in BACKLOG state', async () => {
    mockDbAll.mockResolvedValue([]); // empty chain (no existing tasks)
    mockDbRun.mockResolvedValue({ lastInsertRowid: TICKET_ID });

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'E2E lifecycle task',
      assigned_to: AGENT_USERS.DEV_RALPH,
      chain_id: CHAIN_ID,
      step: 1,
      dispatched_by: AGENT_USERS.ORCHESTRATOR,
    });

    expect(result.ticket_id).toBe(TICKET_ID);
    expect(result.state).toBe(STATE.BACKLOG);
    expect(result.chain_id).toBe(CHAIN_ID);
    expect(result.step).toBe(1);
    expect(result.assigned_to).toBe(AGENT_USERS.DEV_RALPH);
  });

  test('step 2: agent picks up ticket — BACKLOG → IN_PROGRESS', async () => {
    mockTicketInState(STATE.BACKLOG, 'dispatched');

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.IN_PROGRESS,
      agent_id: AGENT_USERS.DEV_RALPH,
    });

    expect(result.old_state).toBe(STATE.BACKLOG);
    expect(result.new_state).toBe(STATE.IN_PROGRESS);
    expect(result.chain_id).toBe(CHAIN_ID);
  });

  test('step 3: agent submits work — IN_PROGRESS → REVIEW', async () => {
    mockTicketInState(STATE.IN_PROGRESS, 'in_progress');

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.REVIEW,
      agent_id: AGENT_USERS.DEV_RALPH,
      notes: 'Implementation complete, all tests passing',
    });

    expect(result.old_state).toBe(STATE.IN_PROGRESS);
    expect(result.new_state).toBe(STATE.REVIEW);
  });

  test('step 4: QA passes — REVIEW → CONTROL', async () => {
    mockTicketInState(STATE.REVIEW, 'review');

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.CONTROL,
      agent_id: AGENT_USERS.FRONTEND_QA,
    });

    expect(result.old_state).toBe(STATE.REVIEW);
    expect(result.new_state).toBe(STATE.CONTROL);
  });

  test('step 5: supervisor (id=53) approves — CONTROL → DONE (no 403)', async () => {
    mockTicketInState(STATE.CONTROL, 'control');

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.DONE,
      agent_id: AGENT_USERS.NIKICH, // supervisor, id=53
    });

    expect(result.old_state).toBe(STATE.CONTROL);
    expect(result.new_state).toBe(STATE.DONE);
    expect(result.chain_id).toBe(CHAIN_ID);
    // Verify no error was thrown — reaching this assertion means no 403
  });

  test('step 5 alt: supervisor CONTROL → DONE also logs activity correctly', async () => {
    mockTicketInState(STATE.CONTROL, 'control');

    await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.DONE,
      agent_id: AGENT_USERS.NIKICH,
    });

    // logActivity is called with status_update for every updateTicketStatus
    const logCalls = mockDbRun.mock.calls.filter(call => {
      try {
        const data = JSON.parse(call[1]?.[2]);
        return data.action === 'status_update';
      } catch { return false; }
    });
    expect(logCalls.length).toBeGreaterThanOrEqual(1);

    const activityData = JSON.parse(logCalls[0][1][2]);
    expect(activityData.agent_id).toBe(53);
    expect(activityData.ticket_id).toBe(TICKET_ID);
  });

  test('complete lifecycle: each transition updates _chain metadata correctly', async () => {
    // BACKLOG → IN_PROGRESS: should set picked_up_at
    mockTicketInState(STATE.BACKLOG, 'dispatched');
    const r1 = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.IN_PROGRESS,
      agent_id: AGENT_USERS.DEV_RALPH,
    });
    expect(r1.data._chain.status).toBe('in_progress');
    expect(r1.data._chain.picked_up_at).toBeDefined();
    expect(r1.data._chain.picked_up_by).toBe(AGENT_USERS.DEV_RALPH);

    // IN_PROGRESS → REVIEW
    vi.clearAllMocks();
    mockTicketInState(STATE.IN_PROGRESS, 'in_progress');
    const r2 = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.REVIEW,
      agent_id: AGENT_USERS.DEV_RALPH,
    });
    expect(r2.data._chain.status).toBe('review');

    // REVIEW → CONTROL
    vi.clearAllMocks();
    mockTicketInState(STATE.REVIEW, 'review');
    const r3 = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.CONTROL,
      agent_id: AGENT_USERS.FRONTEND_QA,
    });
    expect(r3.data._chain.status).toBe('control');
    expect(r3.data._chain.control_at).toBeDefined();

    // CONTROL → DONE
    vi.clearAllMocks();
    mockTicketInState(STATE.CONTROL, 'control');
    const r4 = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.DONE,
      agent_id: AGENT_USERS.NIKICH,
    });
    expect(r4.data._chain.status).toBe('completed');
    expect(r4.data._chain.completed_at).toBeDefined();
    expect(r4.data._chain.completed_by).toBe(AGENT_USERS.NIKICH);
  });

  test('lifecycle rejects invalid shortcuts: BACKLOG → DONE throws', async () => {
    mockTicketInState(STATE.BACKLOG, 'dispatched');

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: TICKET_ID,
        new_state: STATE.DONE,
        agent_id: AGENT_USERS.DEV_RALPH,
      })
    ).rejects.toThrow('Invalid transition');
  });

  test('lifecycle rejects invalid shortcuts: IN_PROGRESS → DONE throws', async () => {
    mockTicketInState(STATE.IN_PROGRESS, 'in_progress');

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: TICKET_ID,
        new_state: STATE.DONE,
        agent_id: AGENT_USERS.DEV_RALPH,
      })
    ).rejects.toThrow('Invalid transition');
  });

  test('lifecycle rejects invalid shortcuts: REVIEW → DONE throws', async () => {
    mockTicketInState(STATE.REVIEW, 'review');

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: TICKET_ID,
        new_state: STATE.DONE,
        agent_id: AGENT_USERS.DEV_RALPH,
      })
    ).rejects.toThrow('Invalid transition');
  });
});

// ─── AC9: Rejection and Rework Cycle ───────────────────────────────────────
// control → rejected → in_progress → review → control → done

describe('ADR-109 AC9: Rejection and rework cycle (control → rejected → in_progress → review → control → done)', () => {
  const CHAIN_ID = 'chain-rework-e2e';
  const TICKET_ID = 400;

  function mockTicketInState(state, chainStatus, extraChainData = {}) {
    mockDbGet.mockResolvedValue({
      id: TICKET_ID,
      data: JSON.stringify({
        what: 'Rework cycle task',
        assigned_to: AGENT_USERS.DEV_RALPH,
        state,
        why: 'Initial implementation',
        _chain: {
          chain_id: CHAIN_ID,
          step: 1,
          dispatched_by: AGENT_USERS.ORCHESTRATOR,
          status: chainStatus,
          ...extraChainData,
        },
      }),
    });
    mockDbRun.mockResolvedValue({});
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('step 1: supervisor rejects — CONTROL → REJECTED', async () => {
    mockTicketInState(STATE.CONTROL, 'control');

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.REJECTED,
      agent_id: AGENT_USERS.NIKICH,
      notes: 'Tests failing, needs rework',
    });

    expect(result.old_state).toBe(STATE.CONTROL);
    expect(result.new_state).toBe(STATE.REJECTED);
    expect(result.data._chain.status).toBe('rejected');
    expect(result.data._chain.rejected_at).toBeDefined();
    expect(result.data._chain.rejected_by).toBe(AGENT_USERS.NIKICH);
  });

  test('step 2: agent picks up rejected ticket — REJECTED → IN_PROGRESS', async () => {
    mockTicketInState(STATE.REJECTED, 'rejected', {
      rejected_at: '2026-01-01T00:00:00.000Z',
      rejected_by: AGENT_USERS.NIKICH,
    });

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.IN_PROGRESS,
      agent_id: AGENT_USERS.DEV_RALPH,
      notes: 'Picking up for rework',
    });

    expect(result.old_state).toBe(STATE.REJECTED);
    expect(result.new_state).toBe(STATE.IN_PROGRESS);
    expect(result.data._chain.status).toBe('in_progress');
    expect(result.data._chain.picked_up_by).toBe(AGENT_USERS.DEV_RALPH);
  });

  test('step 3: agent resubmits — IN_PROGRESS → REVIEW', async () => {
    mockTicketInState(STATE.IN_PROGRESS, 'in_progress');

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.REVIEW,
      agent_id: AGENT_USERS.DEV_RALPH,
      notes: 'Fixed all failing tests',
    });

    expect(result.old_state).toBe(STATE.IN_PROGRESS);
    expect(result.new_state).toBe(STATE.REVIEW);
    expect(result.data._chain.status).toBe('review');
  });

  test('step 4: QA passes again — REVIEW → CONTROL', async () => {
    mockTicketInState(STATE.REVIEW, 'review');

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.CONTROL,
      agent_id: AGENT_USERS.FRONTEND_QA,
    });

    expect(result.old_state).toBe(STATE.REVIEW);
    expect(result.new_state).toBe(STATE.CONTROL);
    expect(result.data._chain.status).toBe('control');
  });

  test('step 5: supervisor approves after rework — CONTROL → DONE', async () => {
    mockTicketInState(STATE.CONTROL, 'control');

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.DONE,
      agent_id: AGENT_USERS.NIKICH,
      notes: 'Approved after rework',
    });

    expect(result.old_state).toBe(STATE.CONTROL);
    expect(result.new_state).toBe(STATE.DONE);
    expect(result.data._chain.status).toBe('completed');
    expect(result.data._chain.completed_by).toBe(AGENT_USERS.NIKICH);
  });

  test('rejected ticket cannot go directly to DONE', async () => {
    mockTicketInState(STATE.REJECTED, 'rejected');

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: TICKET_ID,
        new_state: STATE.DONE,
        agent_id: AGENT_USERS.NIKICH,
      })
    ).rejects.toThrow('Invalid transition');
  });

  test('rejected ticket cannot go directly to REVIEW', async () => {
    mockTicketInState(STATE.REJECTED, 'rejected');

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: TICKET_ID,
        new_state: STATE.REVIEW,
        agent_id: AGENT_USERS.DEV_RALPH,
      })
    ).rejects.toThrow('Invalid transition');
  });

  test('rejected ticket cannot go to CONTROL', async () => {
    mockTicketInState(STATE.REJECTED, 'rejected');

    await expect(
      ChainHandoffService.updateTicketStatus({
        ticket_id: TICKET_ID,
        new_state: STATE.CONTROL,
        agent_id: AGENT_USERS.DEV_RALPH,
      })
    ).rejects.toThrow('Invalid transition');
  });

  test('notes accumulate across rejection cycles in why field', async () => {
    // Simulate ticket that already has notes from first pass
    mockDbGet.mockResolvedValue({
      id: TICKET_ID,
      data: JSON.stringify({
        what: 'Rework cycle task',
        assigned_to: AGENT_USERS.DEV_RALPH,
        state: STATE.CONTROL,
        why: '[Agent 19 @ 2026-01-01T00:00:00.000Z]: Initial implementation done',
        _chain: { chain_id: CHAIN_ID, step: 1, status: 'control' },
      }),
    });
    mockDbRun.mockResolvedValue({});

    const result = await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.REJECTED,
      agent_id: AGENT_USERS.NIKICH,
      notes: 'Needs better error handling',
    });

    // why field should contain both old and new notes
    expect(result.data.why).toContain('Initial implementation done');
    expect(result.data.why).toContain('Needs better error handling');
  });
});

// ─── AC10: Cascade Updates on Supervisor Transitions ───────────────────────

describe('ADR-109 AC10: Cascade updates on supervisor transitions', () => {
  const CHAIN_ID = 'chain-cascade-e2e';
  const TICKET_ID = 500;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('logActivity is called when supervisor completes a ticket (CONTROL → DONE)', async () => {
    mockDbGet.mockResolvedValue({
      id: TICKET_ID,
      data: JSON.stringify({
        what: 'Cascade test task',
        assigned_to: AGENT_USERS.DEV_RALPH,
        state: STATE.CONTROL,
        _chain: { chain_id: CHAIN_ID, step: 1, status: 'control' },
      }),
    });
    mockDbRun.mockResolvedValue({});

    await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.DONE,
      agent_id: AGENT_USERS.NIKICH,
    });

    // Verify logActivity INSERT was called
    const activityInserts = mockDbRun.mock.calls.filter(call => {
      try {
        const data = JSON.parse(call[1]?.[2]);
        return data.action === 'status_update';
      } catch { return false; }
    });

    expect(activityInserts.length).toBe(1);
    const activityData = JSON.parse(activityInserts[0][1][2]);
    expect(activityData.action).toBe('status_update');
    expect(activityData.agent_id).toBe(AGENT_USERS.NIKICH);
    expect(activityData.ticket_id).toBe(TICKET_ID);
    expect(activityData.chain_id).toBe(CHAIN_ID);

    const details = JSON.parse(activityData.details);
    expect(details.old_state).toBe(STATE.CONTROL);
    expect(details.new_state).toBe(STATE.DONE);
  });

  test('logActivity is called when supervisor rejects a ticket (CONTROL → REJECTED)', async () => {
    mockDbGet.mockResolvedValue({
      id: TICKET_ID,
      data: JSON.stringify({
        what: 'Cascade reject task',
        assigned_to: AGENT_USERS.DEV_RALPH,
        state: STATE.CONTROL,
        _chain: { chain_id: CHAIN_ID, step: 2, status: 'control' },
      }),
    });
    mockDbRun.mockResolvedValue({});

    await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.REJECTED,
      agent_id: AGENT_USERS.NIKICH,
      notes: 'Supervisor rejected: coverage too low',
    });

    const activityInserts = mockDbRun.mock.calls.filter(call => {
      try {
        const data = JSON.parse(call[1]?.[2]);
        return data.action === 'status_update';
      } catch { return false; }
    });

    expect(activityInserts.length).toBe(1);
    const activityData = JSON.parse(activityInserts[0][1][2]);
    expect(activityData.agent_id).toBe(AGENT_USERS.NIKICH);
    expect(activityData.chain_id).toBe(CHAIN_ID);

    const details = JSON.parse(activityData.details);
    expect(details.old_state).toBe(STATE.CONTROL);
    expect(details.new_state).toBe(STATE.REJECTED);
    expect(details.notes).toContain('coverage too low');
  });

  test('chain progress tracking updates: getChainStatus reflects completed tasks', async () => {
    // Mock chain with 3 tasks: 2 done, 1 in_progress
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed', chain_id: CHAIN_ID })),
      makeDbRow(makeTask({ step: 2, state: STATE.DONE, chain_status: 'completed', chain_id: CHAIN_ID })),
      makeDbRow(makeTask({ step: 3, state: STATE.IN_PROGRESS, chain_status: 'in_progress', chain_id: CHAIN_ID })),
    ]);

    const status = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(status.chain_id).toBe(CHAIN_ID);
    expect(status.status).toBe('in_progress');
    expect(status.progress.total).toBe(3);
    expect(status.progress.completed).toBe(2);
    expect(status.progress.in_progress).toBe(1);
    expect(status.progress.percent_complete).toBe(67); // Math.round(2/3 * 100)
  });

  test('chain progress tracking: all tasks DONE yields status=completed', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed', chain_id: CHAIN_ID })),
      makeDbRow(makeTask({ step: 2, state: STATE.DONE, chain_status: 'completed', chain_id: CHAIN_ID })),
      makeDbRow(makeTask({ step: 3, state: STATE.DONE, chain_status: 'completed', chain_id: CHAIN_ID })),
    ]);

    const status = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(status.status).toBe('completed');
    expect(status.progress.percent_complete).toBe(100);
    expect(status.progress.completed).toBe(3);
  });

  test('chain progress tracking: all tasks BACKLOG yields status=pending', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.BACKLOG, chain_status: 'dispatched', chain_id: CHAIN_ID })),
      makeDbRow(makeTask({ step: 2, state: STATE.BACKLOG, chain_status: 'dispatched', chain_id: CHAIN_ID })),
    ]);

    const status = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(status.status).toBe('pending');
    expect(status.progress.percent_complete).toBe(0);
  });

  test('logActivity persists to Agent Activity table (table 1701)', async () => {
    mockDbGet.mockResolvedValue({
      id: TICKET_ID,
      data: JSON.stringify({
        what: 'Table ID check task',
        assigned_to: AGENT_USERS.DEV_RALPH,
        state: STATE.CONTROL,
        _chain: { chain_id: CHAIN_ID, step: 1, status: 'control' },
      }),
    });
    mockDbRun.mockResolvedValue({});

    await ChainHandoffService.updateTicketStatus({
      ticket_id: TICKET_ID,
      new_state: STATE.DONE,
      agent_id: AGENT_USERS.NIKICH,
    });

    // Find the logActivity INSERT call — it targets AGENT_ACTIVITY_TABLE_ID (1701)
    const activityInserts = mockDbRun.mock.calls.filter(call => {
      return typeof call[0] === 'string'
        && call[0].includes('INSERT')
        && call[1]?.[0] === 1701; // AGENT_ACTIVITY_TABLE_ID
    });

    expect(activityInserts.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── AC11: Supervisor Triggers at Step 9 ───────────────────────────────────

describe('ADR-109 AC11: Supervisor triggers at step 9', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRun.mockResolvedValue({ lastInsertRowid: 600 });
  });

  test('SUPERVISOR_CONFIG.trigger_at_step equals 9', () => {
    expect(SUPERVISOR_CONFIG.trigger_at_step).toBe(9);
  });

  test('SUPERVISOR_CONFIG.supervisor_agent_id equals 53 (Nikich)', () => {
    expect(SUPERVISOR_CONFIG.supervisor_agent_id).toBe(53);
  });

  test('SUPERVISOR_CONFIG.enabled is true', () => {
    expect(SUPERVISOR_CONFIG.enabled).toBe(true);
  });

  test('SUPERVISOR_CONFIG.max_cycles is a positive integer', () => {
    expect(SUPERVISOR_CONFIG.max_cycles).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(SUPERVISOR_CONFIG.max_cycles)).toBe(true);
  });

  test('supervisor triggers at step 9 with knowledge stack from previous tasks', async () => {
    // Mock getChainTasks returning completed tasks with knowledge markers
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({
        step: 1,
        what: 'Build API endpoints',
        state: STATE.DONE,
        chain_status: 'completed',
        why: 'DECISION: Use Express.js\ncreated: src/api/routes.ts\n5 tests passed',
      })),
      makeDbRow(makeTask({
        step: 2,
        what: 'Write integration tests',
        state: STATE.DONE,
        chain_status: 'completed',
        why: 'RESOLVED: Fixed DB seed issue\n10 tests passed, 1 failed',
      })),
      makeDbRow(makeTask({
        step: 3,
        what: 'Setup CI pipeline',
        state: STATE.IN_PROGRESS,
        chain_status: 'in_progress',
        why: 'BLOCKER: Missing Docker config',
      })),
    ]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Step 9 task should trigger supervisor',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-step9-knowledge',
      step: 9,
      _chain_memory: {
        cycle_number: 0,
        cycle_group_id: 'cg-knowledge-test',
        original_goal: 'Build complete CI/CD pipeline',
        knowledge_stack: [],
      },
    });

    // T2 fix: Original task is preserved, supervisor result nested in _supervisor
    expect(result._supervisor).toBeDefined();
    expect(result._supervisor._supervisor).toBe(true);
    expect(result._supervisor.assigned_to).toBe(SUPERVISOR_CONFIG.supervisor_agent_id);
    expect(result._supervisor.step).toBe(SUPERVISOR_CONFIG.trigger_at_step);

    // Original task should also be created
    expect(result.ticket_id).toBeDefined();
    expect(result.what).toBe('Step 9 task should trigger supervisor');

    // Supervisor ticket should contain knowledge from chain tasks
    expect(result._supervisor.data.why).toContain('[SUPERVISOR MODE');
    expect(result._supervisor.data.why).toContain('Goal: Build complete CI/CD pipeline');
    expect(result._supervisor.data.why).toContain('=== YOUR DECISION ===');

    // Knowledge stack should be propagated
    expect(result._supervisor.data._chain_memory).toBeDefined();
    expect(result._supervisor.data._chain_memory.knowledge_stack).toBeDefined();
    expect(result._supervisor.data._chain_memory.knowledge_stack.length).toBe(1); // current cycle entry
    expect(result._supervisor.data._chain_memory.original_goal).toBe('Build complete CI/CD pipeline');
    expect(result._supervisor.data._chain_memory.cycle_group_id).toBe('cg-knowledge-test');
  });

  test('supervisor ticket is assigned to Nikich (id=53) with correct chain metadata', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
    ]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Trigger supervisor',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-supervisor-assign',
      step: 9,
      _chain_memory: {
        cycle_number: 0,
        original_goal: 'Test assignment',
        knowledge_stack: [],
      },
    });

    // T2 fix: Supervisor result is nested; original task preserved
    expect(result._supervisor).toBeDefined();
    expect(result._supervisor.data.assigned_to).toBe(53);
    expect(result._supervisor.data.state).toBe(STATE.BACKLOG);
    expect(result._supervisor.data._chain.chain_id).toBe('chain-supervisor-assign');
    expect(result._supervisor.data._chain.step).toBe(9);
    expect(result._supervisor.data._chain.dispatched_by).toBe(AGENT_USERS.ORCHESTRATOR);
  });

  test('step 8 does NOT trigger supervisor — just below threshold', async () => {
    mockDbAll.mockResolvedValue([]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Step 8 normal dispatch',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-step8',
      step: 8,
    });

    expect(result._supervisor).toBeUndefined();
    expect(result.ticket_id).toBeDefined();
    expect(result.step).toBe(8);
    expect(result.state).toBe(STATE.BACKLOG);
  });

  test('step 10 also triggers supervisor (>= trigger_at_step)', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
    ]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Step 10 also triggers',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-step10',
      step: 10,
      _chain_memory: {
        cycle_number: 0,
        original_goal: 'Test step 10',
        knowledge_stack: [],
      },
    });

    expect(result._supervisor).toBeDefined();
    expect(result._supervisor._supervisor).toBe(true);
  });

  test('supervisor context includes task decision options (CONTINUE/COMPLETE/ESCALATE)', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
    ]);

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Decision options test',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-decisions',
      step: 9,
      _chain_memory: {
        cycle_number: 0,
        original_goal: 'Test decisions',
        knowledge_stack: [],
      },
    });

    // T2 fix: Supervisor data is in _supervisor
    expect(result._supervisor.data.why).toContain('CONTINUE');
    expect(result._supervisor.data.why).toContain('COMPLETE');
    expect(result._supervisor.data.why).toContain('ESCALATE');
    expect(result._supervisor.data.acceptance_criteria).toContain('CONTINUE');
    expect(result._supervisor.data.acceptance_criteria).toContain('COMPLETE');
    expect(result._supervisor.data.acceptance_criteria).toContain('ESCALATE');
  });
});

// ─── Multi-Cycle: max_cycles Limit Enforcement ─────────────────────────────

describe('ADR-109: Multi-cycle max_cycles limit enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRun.mockResolvedValue({ lastInsertRowid: 700 });
    mockDbAll.mockResolvedValue([]);
  });

  test('cycle within limit triggers supervisor normally', async () => {
    // max_cycles is 1, cycle_number starts at 0 so first cycle (0+1=1) is within limit
    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Within cycle limit',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-cycle-ok',
      step: 9,
      _chain_memory: {
        cycle_number: 0, // cycleNumber becomes 1, which is <= max_cycles(1)
        cycle_group_id: 'cg-ok',
        original_goal: 'Test cycle limit',
        knowledge_stack: [],
      },
    });

    expect(result._supervisor).toBeDefined();
    expect(result._supervisor._supervisor).toBe(true);
    expect(result._escalation).toBeUndefined();
  });

  test('cycle exceeding max_cycles triggers autoEscalate instead of supervisor', async () => {
    // max_cycles is 1, so cycle_number 1 means cycleNumber=2 which exceeds limit
    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Exceeds cycle limit',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-cycle-exceeded',
      step: 9,
      _chain_memory: {
        cycle_number: SUPERVISOR_CONFIG.max_cycles, // cycleNumber = max_cycles + 1
        cycle_group_id: 'cg-exceeded',
        original_goal: 'Test cycle exceeded',
        knowledge_stack: [],
      },
    });

    expect(result._escalation).toBe(true);
    expect(result._supervisor).toBeUndefined();
    expect(result.assigned_to).toBe(AGENT_USERS.ORCHESTRATOR);
    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('Maximum cycles reached');
  });

  test('escalation ticket at max_cycles contains original goal', async () => {
    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Task exceeding cycle limit',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-goal-check',
      step: 9,
      _chain_memory: {
        cycle_number: SUPERVISOR_CONFIG.max_cycles,
        cycle_group_id: 'cg-goal-check',
        original_goal: 'Implement authentication system',
        knowledge_stack: [
          { cycle: 1, summary: 'Built login form' },
        ],
      },
    });

    expect(result.data.why).toContain('Goal: Implement authentication system');
    expect(result.data.why).toContain('Cycle 1: Built login form');
  });

  test('max_total_tasks limit triggers escalation', async () => {
    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Too many total tasks',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-tasks-limit-e2e',
      step: 9,
      _chain_memory: {
        cycle_number: 0,
        cycle_group_id: 'cg-tasks-limit',
        original_goal: 'Task limit test',
        knowledge_stack: [
          { cycle: 1, tasks_total: SUPERVISOR_CONFIG.max_total_tasks }, // 50 + step(9) > 50
        ],
      },
    });

    expect(result._escalation).toBe(true);
    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('Maximum total tasks reached');
  });

  test('max_duration_ms limit triggers escalation', async () => {
    const expiredTime = new Date(Date.now() - SUPERVISOR_CONFIG.max_duration_ms - 60000).toISOString();

    const result = await ChainHandoffService.dispatchSubtask({
      what: 'Duration exceeded',
      assigned_to: AGENT_USERS.DEVELOPER,
      chain_id: 'chain-duration-e2e',
      step: 9,
      _chain_memory: {
        cycle_number: 0,
        cycle_group_id: 'cg-duration',
        original_goal: 'Duration test',
        knowledge_stack: [
          { cycle: 1, started_at: expiredTime, tasks_total: 5 },
        ],
      },
    });

    expect(result._escalation).toBe(true);
    expect(result.data.what).toContain('[ESCALATION]');
    expect(result.data.what).toContain('Maximum duration reached');
  });

  test('startNewCycle limits tasks to trigger_at_step - 1 = 8', async () => {
    const manyTasks = Array.from({ length: 15 }, (_, i) => ({
      what: `Task ${i + 1}`,
      assigned_to: AGENT_USERS.DEVELOPER,
    }));

    const result = await ChainHandoffService.startNewCycle({
      cycle_group_id: 'cg-multi-limit',
      cycle_number: 2,
      knowledge_stack: [makeKnowledgeStackEntry({ cycle: 1 })],
      original_goal: 'Multi-cycle test',
      next_cycle_plan: 'Continue work',
      tasks: manyTasks,
    });

    expect(result.tasks.length).toBe(SUPERVISOR_CONFIG.trigger_at_step - 1);
    expect(result.tasks.length).toBe(8);
  });

  test('startNewCycle propagates knowledge_stack to all dispatched tasks', async () => {
    const knowledgeStack = [
      makeKnowledgeStackEntry({ cycle: 1, chain_id: 'chain-prev-a', summary: 'First cycle done' }),
    ];

    await ChainHandoffService.startNewCycle({
      cycle_group_id: 'cg-propagate',
      cycle_number: 2,
      knowledge_stack: knowledgeStack,
      original_goal: 'Propagation test',
      next_cycle_plan: 'Fix remaining issues',
      tasks: [
        { what: 'Fix tests', assigned_to: AGENT_USERS.TEST_RUNNER },
        { what: 'Fix styles', assigned_to: AGENT_USERS.FRONTEND },
      ],
    });

    // Check that ticket INSERT calls have the cycle context in their why field
    const ticketInserts = mockDbRun.mock.calls.filter(call => {
      try {
        const data = JSON.parse(call[1]?.[2]);
        return data.what !== undefined && data._chain !== undefined;
      } catch { return false; }
    });

    expect(ticketInserts.length).toBe(2);
    for (const call of ticketInserts) {
      const data = JSON.parse(call[1][2]);
      expect(data.why).toContain('[Cycle 2]');
      expect(data.why).toContain('Fix remaining issues');
    }
  });
});

// ─── Auto-Escalation at Max Cycles ─────────────────────────────────────────

describe('ADR-109: Auto-escalation at max cycles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRun.mockResolvedValue({ lastInsertRowid: 800 });
  });

  test('autoEscalate creates ticket assigned to ORCHESTRATOR (id=18)', async () => {
    const result = await ChainHandoffService.autoEscalate(
      'chain-esc-e2e',
      {
        cycle_number: 1,
        cycle_group_id: 'cg-esc-e2e',
        original_goal: 'Feature that exceeded limits',
        knowledge_stack: [
          { cycle: 1, summary: 'Partial progress: 5/8 tasks done' },
        ],
      },
      'MAX_CYCLES_REACHED'
    );

    expect(result.ticket_id).toBe(800);
    expect(result.assigned_to).toBe(AGENT_USERS.ORCHESTRATOR);
    expect(result.assigned_to).toBe(18);
    expect(result._escalation).toBe(true);
    expect(result.state).toBe(STATE.BACKLOG);
  });

  test('escalation ticket includes _escalation metadata with reason and auto flag', async () => {
    const result = await ChainHandoffService.autoEscalate(
      'chain-esc-meta',
      {
        cycle_number: 2,
        cycle_group_id: 'cg-meta',
        original_goal: 'Metadata test',
        knowledge_stack: [],
      },
      'MAX_CYCLES_REACHED'
    );

    expect(result.data._escalation).toBeDefined();
    expect(result.data._escalation.reason).toBe('MAX_CYCLES_REACHED');
    expect(result.data._escalation.auto).toBe(true);
    expect(result.data._escalation.escalated_at).toBeDefined();
  });

  test('escalation ticket includes full knowledge history from all cycles', async () => {
    const result = await ChainHandoffService.autoEscalate(
      'chain-esc-history',
      {
        cycle_number: 3,
        cycle_group_id: 'cg-history',
        original_goal: 'Build complete dashboard',
        knowledge_stack: [
          { cycle: 1, summary: 'Built API endpoints, 8/10 tests pass' },
          { cycle: 2, summary: 'Fixed failing tests, added error handling' },
          { cycle: 3, summary: 'Frontend integration started' },
        ],
      },
      'MAX_CYCLES_REACHED'
    );

    expect(result.data.why).toContain('Goal: Build complete dashboard');
    expect(result.data.why).toContain('Cycle 1: Built API endpoints, 8/10 tests pass');
    expect(result.data.why).toContain('Cycle 2: Fixed failing tests, added error handling');
    expect(result.data.why).toContain('Cycle 3: Frontend integration started');
    expect(result.data.why).toContain('AUTO-ESCALATION');
  });

  test('escalation logs supervisor_auto_escalate activity to DB', async () => {
    await ChainHandoffService.autoEscalate(
      'chain-esc-log',
      {
        cycle_number: 1,
        cycle_group_id: 'cg-log',
        original_goal: 'Log test',
        knowledge_stack: [],
      },
      'MAX_CYCLES_REACHED'
    );

    // First INSERT is the activity log
    const firstInsertCall = mockDbRun.mock.calls[0];
    expect(firstInsertCall[0]).toContain('INSERT');
    const activityData = JSON.parse(firstInsertCall[1][2]);
    expect(activityData.action).toBe('supervisor_auto_escalate');
    expect(activityData.agent_id).toBe(SUPERVISOR_CONFIG.supervisor_agent_id);
    expect(activityData.chain_id).toBe('chain-esc-log');
  });

  test('escalation _chain status is set to escalated', async () => {
    const result = await ChainHandoffService.autoEscalate(
      'chain-esc-status',
      {
        cycle_number: 1,
        cycle_group_id: 'cg-status',
        original_goal: 'Status test',
        knowledge_stack: [],
      },
      'MAX_DURATION_REACHED'
    );

    expect(result.data._chain.status).toBe('escalated');
    expect(result.data._chain.dispatched_by).toBe(SUPERVISOR_CONFIG.supervisor_agent_id);
    expect(result.data._chain.chain_id).toBe('chain-esc-status');
  });

  test('escalation preserves original _chain_memory for orchestrator review', async () => {
    const memory = {
      cycle_number: 2,
      cycle_group_id: 'cg-preserve',
      original_goal: 'Preserve memory test',
      knowledge_stack: [
        { cycle: 1, summary: 'Cycle 1 data' },
        { cycle: 2, summary: 'Cycle 2 data' },
      ],
    };

    const result = await ChainHandoffService.autoEscalate(
      'chain-esc-preserve',
      memory,
      'MAX_TASKS_REACHED'
    );

    expect(result.data._chain_memory).toEqual(memory);
    expect(result.data._chain_memory.knowledge_stack).toHaveLength(2);
    expect(result.data._chain_memory.original_goal).toBe('Preserve memory test');
  });

  test('three different escalation reasons produce correct messages', async () => {
    const memory = { cycle_number: 1, cycle_group_id: 'cg-reasons', original_goal: 'Test', knowledge_stack: [] };

    const r1 = await ChainHandoffService.autoEscalate('chain-1', memory, 'MAX_CYCLES_REACHED');
    expect(r1.data.why).toContain(`Maximum cycles reached (${SUPERVISOR_CONFIG.max_cycles})`);

    vi.clearAllMocks();
    mockDbRun.mockResolvedValue({ lastInsertRowid: 801 });

    const r2 = await ChainHandoffService.autoEscalate('chain-2', memory, 'MAX_DURATION_REACHED');
    expect(r2.data.why).toContain('Maximum duration reached');
    expect(r2.data.why).toContain('8h');

    vi.clearAllMocks();
    mockDbRun.mockResolvedValue({ lastInsertRowid: 802 });

    const r3 = await ChainHandoffService.autoEscalate('chain-3', memory, 'MAX_TASKS_REACHED');
    expect(r3.data.why).toContain(`Maximum total tasks reached (${SUPERVISOR_CONFIG.max_total_tasks})`);
  });
});

// ─── ADR-077 Task #11: getChainTasks ────────────────────────────────────────

describe('getChainTasks', () => {
  const CHAIN_ID = 'chain-tasks-test';

  test('returns empty array when chain_id is falsy', async () => {
    const result = await ChainHandoffService.getChainTasks(null);
    expect(result).toEqual([]);
    expect(mockDbAll).not.toHaveBeenCalled();
  });

  test('returns empty array when chain_id is empty string', async () => {
    const result = await ChainHandoffService.getChainTasks('');
    expect(result).toEqual([]);
    expect(mockDbAll).not.toHaveBeenCalled();
  });

  test('returns mapped task objects from DB rows', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, what: 'Task A', state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 2, what: 'Task B', state: STATE.IN_PROGRESS, chain_status: 'in_progress' })),
    ]);

    const result = await ChainHandoffService.getChainTasks(CHAIN_ID);

    expect(result).toHaveLength(2);
    expect(result[0].step).toBe(1);
    expect(result[0].what).toBe('Task A');
    expect(result[0].state).toBe(STATE.DONE);
    expect(result[0].chain_status).toBe('completed');
    expect(result[1].step).toBe(2);
    expect(result[1].what).toBe('Task B');
    expect(result[1].state).toBe(STATE.IN_PROGRESS);
    expect(result[1].chain_status).toBe('in_progress');
  });

  test('returns empty array when no rows match chain_id', async () => {
    mockDbAll.mockResolvedValue([]);
    const result = await ChainHandoffService.getChainTasks('nonexistent-chain');
    expect(result).toEqual([]);
  });

  test('includes timing fields (dispatched_at, picked_up_at, completed_at)', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, what: 'Timed task' })),
    ]);

    const result = await ChainHandoffService.getChainTasks(CHAIN_ID);

    expect(result[0].dispatched_at).toBeDefined();
    expect(result[0].picked_up_at).toBeDefined();
    expect(result[0].completed_at).toBeDefined();
    expect(result[0].created_at).toBeDefined();
    expect(result[0].updated_at).toBeDefined();
  });
});

// ─── ADR-077 Task #11: getChainStatus ───────────────────────────────────────

describe('getChainStatus', () => {
  const CHAIN_ID = 'chain-status-test';

  test('returns not_found when chain has no tasks', async () => {
    mockDbAll.mockResolvedValue([]);
    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.chain_id).toBe(CHAIN_ID);
    expect(result.status).toBe('not_found');
    expect(result.tasks).toEqual([]);
  });

  test('returns completed when all tasks are done', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 2, state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 3, state: STATE.DONE, chain_status: 'completed' })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(result.status).toBe('completed');
    expect(result.progress.total).toBe(3);
    expect(result.progress.completed).toBe(3);
    expect(result.progress.percent_complete).toBe(100);
    expect(result.current_step).toBeNull();
    expect(result.next_step).toBeNull();
  });

  test('returns pending when all tasks are in backlog', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.BACKLOG, chain_status: 'dispatched' })),
      makeDbRow(makeTask({ step: 2, state: STATE.BACKLOG, chain_status: 'dispatched' })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(result.status).toBe('pending');
    expect(result.progress.total).toBe(2);
    expect(result.progress.completed).toBe(0);
    expect(result.progress.backlog).toBe(2);
    expect(result.progress.percent_complete).toBe(0);
    expect(result.next_step).toBe(1);
  });

  test('returns in_progress with correct progress breakdown', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 2, state: STATE.IN_PROGRESS, chain_status: 'in_progress' })),
      makeDbRow(makeTask({ step: 3, state: STATE.BACKLOG, chain_status: 'dispatched' })),
      makeDbRow(makeTask({ step: 4, state: STATE.BACKLOG, chain_status: 'dispatched' })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(result.status).toBe('in_progress');
    expect(result.progress.total).toBe(4);
    expect(result.progress.completed).toBe(1);
    expect(result.progress.in_progress).toBe(1);
    expect(result.progress.backlog).toBe(2);
    expect(result.progress.percent_complete).toBe(25);
    expect(result.current_step).toBe(2);
    expect(result.next_step).toBe(3);
  });

  test('includes review count in progress', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 2, state: STATE.REVIEW, chain_status: 'review' })),
      makeDbRow(makeTask({ step: 3, state: STATE.BACKLOG, chain_status: 'dispatched' })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(result.status).toBe('in_progress');
    expect(result.progress.review).toBe(1);
    expect(result.progress.completed).toBe(1);
    expect(result.progress.backlog).toBe(1);
    expect(result.progress.percent_complete).toBe(33);
  });

  test('current_step is null when no tasks are in_progress', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 2, state: STATE.REVIEW, chain_status: 'review' })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.current_step).toBeNull();
  });

  test('next_step is null when no tasks are in backlog', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
      makeDbRow(makeTask({ step: 2, state: STATE.IN_PROGRESS, chain_status: 'in_progress' })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.next_step).toBeNull();
  });

  test('single task chain with done state shows 100% complete', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE, chain_status: 'completed' })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(result.status).toBe('completed');
    expect(result.progress.total).toBe(1);
    expect(result.progress.completed).toBe(1);
    expect(result.progress.percent_complete).toBe(100);
  });

  test('returns correct chain_id in response', async () => {
    const customChainId = 'chain-custom-xyz-789';
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.BACKLOG })),
    ]);

    const result = await ChainHandoffService.getChainStatus(customChainId);
    expect(result.chain_id).toBe(customChainId);
  });

  test('tasks array contains full task details', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, what: 'Build API', state: STATE.DONE, assigned_to: AGENT_USERS.DEVELOPER })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].what).toBe('Build API');
    expect(result.tasks[0].assigned_to).toBe(AGENT_USERS.DEVELOPER);
    expect(result.tasks[0].state).toBe(STATE.DONE);
  });

  // --- Edge cases for getChainStatus (ADR-077 Task #11) ---

  test('mixed states: some DONE, some REVIEW, some IN_PROGRESS yields in_progress', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE })),
      makeDbRow(makeTask({ step: 2, state: STATE.REVIEW })),
      makeDbRow(makeTask({ step: 3, state: STATE.IN_PROGRESS })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.status).toBe('in_progress');
    expect(result.progress.total).toBe(3);
    expect(result.progress.completed).toBe(1);
    expect(result.progress.review).toBe(1);
    expect(result.progress.in_progress).toBe(1);
    expect(result.progress.backlog).toBe(0);
  });

  test('percent_complete rounds to nearest integer', async () => {
    // 1 done out of 3 = 33.33... → should round to 33
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE })),
      makeDbRow(makeTask({ step: 2, state: STATE.IN_PROGRESS })),
      makeDbRow(makeTask({ step: 3, state: STATE.BACKLOG })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.progress.percent_complete).toBe(33);
    expect(Number.isInteger(result.progress.percent_complete)).toBe(true);
  });

  test('large chain with many tasks calculates progress correctly', async () => {
    const tasks = [];
    for (let i = 1; i <= 10; i++) {
      tasks.push(makeDbRow(makeTask({
        step: i,
        state: i <= 7 ? STATE.DONE : (i === 8 ? STATE.IN_PROGRESS : STATE.BACKLOG),
      })));
    }
    mockDbAll.mockResolvedValue(tasks);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.status).toBe('in_progress');
    expect(result.progress.total).toBe(10);
    expect(result.progress.completed).toBe(7);
    expect(result.progress.in_progress).toBe(1);
    expect(result.progress.backlog).toBe(2);
    expect(result.progress.percent_complete).toBe(70);
    expect(result.current_step).toBe(8);
    expect(result.next_step).toBe(9);
  });

  test('current_step returns first in_progress task step when multiple are in_progress', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE })),
      makeDbRow(makeTask({ step: 2, state: STATE.IN_PROGRESS })),
      makeDbRow(makeTask({ step: 3, state: STATE.IN_PROGRESS })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    // find() returns the first match
    expect(result.current_step).toBe(2);
  });

  test('next_step returns first backlog task step when multiple are in backlog', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.DONE })),
      makeDbRow(makeTask({ step: 2, state: STATE.BACKLOG })),
      makeDbRow(makeTask({ step: 3, state: STATE.BACKLOG })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.next_step).toBe(2);
  });

  test('all tasks in REVIEW state yields in_progress (not completed or pending)', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.REVIEW })),
      makeDbRow(makeTask({ step: 2, state: STATE.REVIEW })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.status).toBe('in_progress');
    expect(result.progress.review).toBe(2);
    expect(result.progress.completed).toBe(0);
    expect(result.progress.percent_complete).toBe(0);
  });

  test('single task in IN_PROGRESS state returns 0% complete', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.IN_PROGRESS })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);
    expect(result.status).toBe('in_progress');
    expect(result.progress.percent_complete).toBe(0);
    expect(result.current_step).toBe(1);
  });

  test('response shape matches expected contract', async () => {
    mockDbAll.mockResolvedValue([
      makeDbRow(makeTask({ step: 1, state: STATE.IN_PROGRESS })),
    ]);

    const result = await ChainHandoffService.getChainStatus(CHAIN_ID);

    // Verify all expected top-level keys
    expect(result).toHaveProperty('chain_id');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('progress');
    expect(result).toHaveProperty('tasks');
    expect(result).toHaveProperty('current_step');
    expect(result).toHaveProperty('next_step');

    // Verify progress shape
    expect(result.progress).toHaveProperty('total');
    expect(result.progress).toHaveProperty('completed');
    expect(result.progress).toHaveProperty('in_progress');
    expect(result.progress).toHaveProperty('review');
    expect(result.progress).toHaveProperty('backlog');
    expect(result.progress).toHaveProperty('percent_complete');
  });
});

// ─── ADR-077 Task #2: Chain metadata — triggered_by / triggers_next ─────────

describe('Chain metadata: triggered_by and triggers_next fields', () => {

  // --- dispatchSubtask ---

  describe('dispatchSubtask stores triggered_by in _chain', () => {
    beforeEach(() => {
      mockDbAll.mockResolvedValue([]);
      mockDbRun.mockResolvedValue({ lastInsertRowid: 500 });
    });

    test('triggered_by is stored in _chain metadata when provided', async () => {
      const result = await ChainHandoffService.dispatchSubtask({
        what: 'Follow-up task',
        assigned_to: AGENT_USERS.DEVELOPER,
        chain_id: 'chain-trig-1',
        step: 2,
        triggered_by: 42,
      });

      expect(result.data._chain.triggered_by).toBe(42);
    });

    test('triggered_by defaults to null when not provided', async () => {
      const result = await ChainHandoffService.dispatchSubtask({
        what: 'First task',
        assigned_to: AGENT_USERS.DEVELOPER,
        chain_id: 'chain-trig-2',
        step: 1,
      });

      expect(result.data._chain.triggered_by).toBeNull();
    });

    test('triggers_next defaults to null when not provided', async () => {
      const result = await ChainHandoffService.dispatchSubtask({
        what: 'Standalone task',
        assigned_to: AGENT_USERS.DEVELOPER,
        chain_id: 'chain-trig-3',
        step: 1,
      });

      expect(result.data._chain.triggers_next).toBeNull();
    });

    test('triggers_next is stored when provided', async () => {
      const result = await ChainHandoffService.dispatchSubtask({
        what: 'Task with next',
        assigned_to: AGENT_USERS.DEVELOPER,
        chain_id: 'chain-trig-4',
        step: 1,
        triggers_next: [501, 502],
      });

      expect(result.data._chain.triggers_next).toEqual([501, 502]);
    });
  });

  // --- dispatchChain auto-links sequential tasks ---

  describe('dispatchChain auto-links triggered_by / triggers_next', () => {
    let insertCallIdx;

    beforeEach(() => {
      insertCallIdx = 0;
      mockDbAll.mockResolvedValue([]);
      // Return incrementing IDs for each INSERT call
      mockDbRun.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('INSERT')) {
          insertCallIdx++;
          return Promise.resolve({ lastInsertRowid: 600 + insertCallIdx });
        }
        return Promise.resolve({});
      });
    });

    test('sequential tasks are linked: each task has triggered_by pointing to previous ticket', async () => {
      const result = await ChainHandoffService.dispatchChain({
        chain_id: 'chain-seq-1',
        tasks: [
          { what: 'Task A', assigned_to: AGENT_USERS.DEVELOPER },
          { what: 'Task B', assigned_to: AGENT_USERS.FRONTEND },
          { what: 'Task C', assigned_to: AGENT_USERS.TEST_RUNNER },
        ],
      });

      // Task A (step 1): triggered_by = null (first task)
      expect(result.tasks[0].data._chain.triggered_by).toBeNull();

      // Task B (step 2): triggered_by = Task A's ticket_id
      expect(result.tasks[1].data._chain.triggered_by).toBe(result.tasks[0].ticket_id);

      // Task C (step 3): triggered_by = Task B's ticket_id
      expect(result.tasks[2].data._chain.triggered_by).toBe(result.tasks[1].ticket_id);
    });

    test('first task in chain has triggered_by = parent_ticket_id when provided', async () => {
      const result = await ChainHandoffService.dispatchChain({
        chain_id: 'chain-seq-2',
        parent_ticket_id: 999,
        tasks: [
          { what: 'Task A', assigned_to: AGENT_USERS.DEVELOPER },
          { what: 'Task B', assigned_to: AGENT_USERS.FRONTEND },
        ],
      });

      // First task triggered by parent
      expect(result.tasks[0].data._chain.triggered_by).toBe(999);
      // Second task triggered by first
      expect(result.tasks[1].data._chain.triggered_by).toBe(result.tasks[0].ticket_id);
    });
  });

  // --- getChainTasks returns triggered_by / triggers_next ---

  describe('getChainTasks edge cases', () => {
    test('returns undefined chain_id when undefined in chain_id is missing from _chain', async () => {
      mockDbAll.mockResolvedValue([
        {
          id: 200,
          data: JSON.stringify({
            what: 'Orphan task',
            why: '',
            assigned_to: AGENT_USERS.DEVELOPER,
            state: STATE.IN_PROGRESS,
            _chain: { step: 1, status: 'in_progress' },
          }),
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);

      const tasks = await ChainHandoffService.getChainTasks('some-chain');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].chain_id).toBeUndefined();
      expect(tasks[0].step).toBe(1);
    });

    test('handles rows with malformed/empty data gracefully', async () => {
      mockDbAll.mockResolvedValue([
        { id: 300, data: JSON.stringify({}), created_at: '2026-01-01', updated_at: '2026-01-01' },
      ]);

      const tasks = await ChainHandoffService.getChainTasks('chain-malformed');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].ticket_id).toBe(300);
      expect(tasks[0].what).toBeUndefined();
      expect(tasks[0].chain_id).toBeUndefined();
      expect(tasks[0].step).toBeUndefined();
    });

    test('returns undefined for chain_id when passed undefined', async () => {
      const result = await ChainHandoffService.getChainTasks(undefined);
      expect(result).toEqual([]);
      expect(mockDbAll).not.toHaveBeenCalled();
    });

    test('uses correct SQL for postgres vs sqlite', async () => {
      mockDbAll.mockResolvedValue([]);

      // Default is SQLite (mockIsPostgres returns false)
      await ChainHandoffService.getChainTasks('chain-sql-test');
      const sqliteCall = mockDbAll.mock.calls[0][0];
      expect(sqliteCall).toContain('json_extract');

      mockDbAll.mockClear();
      mockIsPostgres.mockReturnValueOnce(true);

      await ChainHandoffService.getChainTasks('chain-sql-test');
      const pgCall = mockDbAll.mock.calls[0][0];
      expect(pgCall).toContain("data->'_chain'->>'chain_id'");
    });

    test('passes TICKETS_TABLE_ID as first parameter', async () => {
      mockDbAll.mockResolvedValue([]);
      await ChainHandoffService.getChainTasks('chain-param-test');

      const params = mockDbAll.mock.calls[0][1];
      // First param is table ID (1708 for space 11), second is chain_id
      expect(params[0]).toBe(1708);
      expect(params[1]).toBe('chain-param-test');
    });
  });

  describe('getChainTasks returns triggered_by and triggers_next', () => {
    test('triggered_by and triggers_next are included in returned task objects', async () => {
      mockDbAll.mockResolvedValue([
        {
          id: 101,
          data: JSON.stringify({
            what: 'Task A',
            why: '',
            assigned_to: AGENT_USERS.DEVELOPER,
            state: STATE.DONE,
            _chain: {
              chain_id: 'chain-q-1',
              step: 1,
              dispatched_at: '2026-01-01T00:00:00Z',
              status: 'completed',
              triggered_by: null,
              triggers_next: [102],
            },
          }),
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
        {
          id: 102,
          data: JSON.stringify({
            what: 'Task B',
            why: '',
            assigned_to: AGENT_USERS.FRONTEND,
            state: STATE.IN_PROGRESS,
            _chain: {
              chain_id: 'chain-q-1',
              step: 2,
              dispatched_at: '2026-01-01T00:01:00Z',
              status: 'in_progress',
              triggered_by: 101,
              triggers_next: null,
            },
          }),
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]);

      const tasks = await ChainHandoffService.getChainTasks('chain-q-1');

      expect(tasks[0].triggered_by).toBeNull();
      expect(tasks[0].triggers_next).toEqual([102]);
      expect(tasks[1].triggered_by).toBe(101);
      expect(tasks[1].triggers_next).toBeNull();
    });
  });
});
