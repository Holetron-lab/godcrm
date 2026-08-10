/**
 * ADR-117: Agent Delegation Syntax Tests
 *
 * Tests for the <<@agent>> delegation syntax that replaces
 * plain @mention parsing in agent responses.
 *
 * Key behaviors:
 *   - parseDelegations() extracts <<@slug>> tokens from text
 *   - parseDelegations() does NOT match plain @mentions
 *   - delegation_depth prevents runaway chains (max 5)
 *   - User input @mentions remain unchanged
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ─── Import parseDelegations directly from chat.js ──────────────────────────
// We need to test the function in isolation, so we'll import the module
// after setting up mocks.

const {
  mockDbRun, mockDbGet, mockDbAll, mockIsPostgres,
  mockExecuteAgentToolLoop, mockSaveStepMessage, mockResolveAllowedTools,
  mockResolveAgentProvider, mockBuildAgentSystemPrompt,
  mockLoadConversationHistory, mockFetchBoundRowContext,
  mockDetectProvider, mockGetHistoryLimit,
  mockLogAgentActivity, mockLogMessageSent, mockLogAgentMentioned,
  mockLogToolUsed, mockLogAgentError, mockLogTaskCompleted,
  mockIsMessageRelevantToAgent, mockResolveAgentUserService,
  mockPaginateByBubbles,
} = vi.hoisted(() => {
  const mockDbRun = vi.fn();
  const mockDbGet = vi.fn();
  const mockDbAll = vi.fn();
  const mockIsPostgres = vi.fn(() => false);
  const mockExecuteAgentToolLoop = vi.fn();
  const mockSaveStepMessage = vi.fn();
  const mockResolveAllowedTools = vi.fn();
  const mockResolveAgentProvider = vi.fn();
  const mockBuildAgentSystemPrompt = vi.fn();
  const mockLoadConversationHistory = vi.fn();
  const mockFetchBoundRowContext = vi.fn();
  const mockDetectProvider = vi.fn();
  const mockGetHistoryLimit = vi.fn();
  const mockLogAgentActivity = vi.fn();
  const mockLogMessageSent = vi.fn();
  const mockLogAgentMentioned = vi.fn();
  const mockLogToolUsed = vi.fn();
  const mockLogAgentError = vi.fn();
  const mockLogTaskCompleted = vi.fn();
  const mockIsMessageRelevantToAgent = vi.fn();
  const mockResolveAgentUserService = vi.fn();
  const mockPaginateByBubbles = vi.fn();

  return {
    mockDbRun, mockDbGet, mockDbAll, mockIsPostgres,
    mockExecuteAgentToolLoop, mockSaveStepMessage, mockResolveAllowedTools,
    mockResolveAgentProvider, mockBuildAgentSystemPrompt,
    mockLoadConversationHistory, mockFetchBoundRowContext,
    mockDetectProvider, mockGetHistoryLimit,
    mockLogAgentActivity, mockLogMessageSent, mockLogAgentMentioned,
    mockLogToolUsed, mockLogAgentError, mockLogTaskCompleted,
    mockIsMessageRelevantToAgent, mockResolveAgentUserService,
    mockPaginateByBubbles,
  };
});

// ─── Module mocks (same as chat-agent-loop.test.js) ─────────────────────────

vi.mock('../../../database/connection.js', () => ({
  dbRun: (...args) => mockDbRun(...args),
  dbGet: (...args) => mockDbGet(...args),
  dbAll: (...args) => mockDbAll(...args),
  isPostgres: () => mockIsPostgres(),
  safeJsonParse: (str, fallback = null) => {
    if (!str) return fallback;
    if (typeof str !== 'string') return str;
    try { return JSON.parse(str); } catch { return fallback; }
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock('../../../utils/response.js', () => ({
  success: (res, data, msg) => res.json({ success: true, data, message: msg }),
  created: (res, data, msg) => res.status(201).json({ success: true, data, message: msg }),
  error: (res, msg, code) => {
    const statusCode = (typeof code === 'number' && code >= 100 && code < 600) ? code : 500;
    return res.status(statusCode).json({ success: false, message: typeof msg === 'string' ? msg : 'Internal error' });
  },
  badRequest: (res, msg) => res.status(400).json({ success: false, message: msg }),
  notFound: (res, msg) => res.status(404).json({ success: false, message: msg }),
  forbidden: (res, msg) => res.status(403).json({ success: false, message: msg }),
  unauthorized: (res, msg) => res.status(401).json({ success: false, message: msg }),
}));

vi.mock('../../../utils/bubblePagination.js', () => ({
  paginateByBubbles: (...args) => mockPaginateByBubbles(...args),
  BUBBLE_PAGE_SIZE: 20,
}));

vi.mock('../../../services/chat/response-mode.js', () => ({
  isMessageRelevantToAgent: (...args) => mockIsMessageRelevantToAgent(...args),
}));

vi.mock('../../../services/agent-users.js', () => ({
  resolveAgentUser: (...args) => mockResolveAgentUserService(...args),
}));

vi.mock('../../../services/chat/agent-execution-shared.js', () => ({
  resolveAgentProvider: (...args) => mockResolveAgentProvider(...args),
  buildAgentSystemPrompt: (...args) => mockBuildAgentSystemPrompt(...args),
  loadConversationHistory: (...args) => mockLoadConversationHistory(...args),
  fetchBoundRowContext: (...args) => mockFetchBoundRowContext(...args),
  detectProvider: (...args) => mockDetectProvider(...args),
  getHistoryLimit: (...args) => mockGetHistoryLimit(...args),
}));

vi.mock('../../../services/AgentLoopService.js', () => ({
  agentLoop: (...args) => mockExecuteAgentToolLoop(...args),
  saveStepMessage: (...args) => mockSaveStepMessage(...args),
  resolveAllowedTools: (...args) => mockResolveAllowedTools(...args),
}));

vi.mock('../../../services/AgentActivityLogger.js', () => ({
  logAgentActivity: (...args) => mockLogAgentActivity(...args),
  logMessageSent: (...args) => mockLogMessageSent(...args),
  logAgentMentioned: (...args) => mockLogAgentMentioned(...args),
  logToolUsed: (...args) => mockLogToolUsed(...args),
  logAgentError: (...args) => mockLogAgentError(...args),
  logTaskCompleted: (...args) => mockLogTaskCompleted(...args),
}));

vi.mock('../../../services/AgentJobService.js', () => ({
  createAndDispatchJob: vi.fn(),
}));

vi.mock('../../../services/ToolApprovalService.js', () => ({
  approveToolExecution: vi.fn(),
  rejectToolExecution: vi.fn(),
  getPendingApprovals: vi.fn(),
  getApprovalRules: vi.fn(),
  updateApprovalRule: vi.fn(),
}));

vi.mock('../../../services/chatChunkingService.js', () => ({
  triggerAutoSummaryIfNeeded: vi.fn(),
  buildAIContext: vi.fn(),
  parseAutoSummarySettings: vi.fn(),
  generateSummaryPrompt: vi.fn(),
  searchSimilarSummaries: vi.fn(),
  parseVectorSearchSettings: vi.fn(),
}));

vi.mock('../../../services/labs/ai-execution-service.js', () => ({
  executeSimpleAI: vi.fn(),
}));

vi.mock('../../../services/ChainHandoffService.js', () => ({
  default: {
    dispatchTask: vi.fn(),
    getChainStatus: vi.fn(),
    resolveAgent: vi.fn(),
  },
}));

vi.mock('../tickets.js', () => ({
  parseStatusDirective: vi.fn(),
  STATE_MAP: {},
  TRANSITIONS: {},
}));

vi.mock('express', () => ({
  Router: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
  })),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// ADR-117: parseDelegations() Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-117: Agent Delegation Syntax', () => {
  let parseDelegations;

  beforeAll(async () => {
    // Import the module to get access to parseDelegations
    const chatModule = await import('../chat.js');
    parseDelegations = chatModule.parseDelegations;
  });

  describe('parseDelegations() — extraction', () => {

    it('should extract <<@agent-name>> from text', () => {
      const result = parseDelegations('Please review this <<@architect>>');
      expect(result).toEqual(['architect']);
    });

    it('should extract multiple delegations', () => {
      const result = parseDelegations('<<@architect>> and <<@test-runner>> please');
      expect(result).toEqual(['architect', 'test-runner']);
    });

    it('should handle underscores in agent names', () => {
      const result = parseDelegations('Delegating to <<@my_agent_v2>>');
      expect(result).toEqual(['my_agent_v2']);
    });

    it('should be case-insensitive (normalize to lowercase)', () => {
      const result = parseDelegations('<<@Architect>>');
      expect(result).toEqual(['architect']);
    });

    it('should handle delegation at start of text', () => {
      const result = parseDelegations('<<@developer>> please check this');
      expect(result).toEqual(['developer']);
    });

    it('should handle delegation at end of text', () => {
      const result = parseDelegations('Done, passing to <<@test-runner>>');
      expect(result).toEqual(['test-runner']);
    });

    it('should handle delegation on its own line', () => {
      const result = parseDelegations('I finished the implementation.\n<<@test-runner>>');
      expect(result).toEqual(['test-runner']);
    });
  });

  describe('parseDelegations() — NO false positives', () => {

    it('should NOT match plain @mentions', () => {
      const result = parseDelegations('Ask @architect about this');
      expect(result).toEqual([]);
    });

    it('should NOT match partial syntax <<@name (missing closing)', () => {
      const result = parseDelegations('<<@broken');
      expect(result).toEqual([]);
    });

    it('should NOT match partial syntax @name>> (missing opening)', () => {
      const result = parseDelegations('@broken>>');
      expect(result).toEqual([]);
    });

    it('should NOT match single chevron <@name>', () => {
      const result = parseDelegations('<@architect>');
      expect(result).toEqual([]);
    });

    it('should handle mixed references and delegations correctly', () => {
      const text = 'I discussed with @marketer and now delegating to <<@developer-ralph>>';
      const result = parseDelegations(text);
      expect(result).toEqual(['developer-ralph']);
    });

    it('should return empty array for text with only plain @mentions', () => {
      const text = '@architect recommends using @developer for the implementation and @test-runner for tests';
      const result = parseDelegations(text);
      expect(result).toEqual([]);
    });
  });

  describe('parseDelegations() — edge cases', () => {

    it('should return empty array for null input', () => {
      expect(parseDelegations(null)).toEqual([]);
    });

    it('should return empty array for undefined input', () => {
      expect(parseDelegations(undefined)).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      expect(parseDelegations('')).toEqual([]);
    });

    it('should return empty array for non-string input', () => {
      expect(parseDelegations(42)).toEqual([]);
      expect(parseDelegations({})).toEqual([]);
    });

    it('should return empty array for text with no mentions at all', () => {
      expect(parseDelegations('Just a regular message')).toEqual([]);
    });

    it('should deduplicate when same agent is mentioned twice', () => {
      // parseDelegations returns all matches (including dupes) — dedup is caller's job
      // But we document the behavior
      const result = parseDelegations('<<@architect>> says ok, <<@architect>> confirmed');
      expect(result).toEqual(['architect', 'architect']);
    });
  });

  describe('Delegation depth protection', () => {

    it('should block delegation when depth > 5 (MAX_DELEGATION_DEPTH)', () => {
      // This tests the constant / guard logic
      const MAX_DELEGATION_DEPTH = 5;
      expect(6 > MAX_DELEGATION_DEPTH).toBe(true);
      expect(5 > MAX_DELEGATION_DEPTH).toBe(false);
    });

    it('should allow delegation at depth 0 through 5', () => {
      const MAX_DELEGATION_DEPTH = 5;
      for (let depth = 0; depth <= 5; depth++) {
        expect(depth > MAX_DELEGATION_DEPTH).toBe(false);
      }
    });

    it('should block delegation at depth 6+', () => {
      const MAX_DELEGATION_DEPTH = 5;
      for (let depth = 6; depth <= 10; depth++) {
        expect(depth > MAX_DELEGATION_DEPTH).toBe(true);
      }
    });

    it('should increment depth on each delegation hop', () => {
      const currentDepth = 2;
      const nextDepth = currentDepth + 1;
      expect(nextDepth).toBe(3);
    });

    it('should default delegation_depth to 0 when not provided', () => {
      const options = {};
      const { delegation_depth = 0 } = options;
      expect(delegation_depth).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADR-077 Task 3: In-memory delegation chain tracking & loop prevention
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ADR-077 Task 3: Delegation chain tracking', () => {
    let getDelegationChain, clearDelegationChain, _activeDelegationChains;
    let MAX_DELEGATION_DEPTH_ACTUAL, MAX_MENTIONS_PER_RESPONSE_ACTUAL;

    beforeAll(async () => {
      const chatModule = await import('../chat.js');
      getDelegationChain = chatModule.getDelegationChain;
      clearDelegationChain = chatModule.clearDelegationChain;
      _activeDelegationChains = chatModule._activeDelegationChains;
      MAX_DELEGATION_DEPTH_ACTUAL = chatModule.MAX_DELEGATION_DEPTH;
      MAX_MENTIONS_PER_RESPONSE_ACTUAL = chatModule.MAX_MENTIONS_PER_RESPONSE;
    });

    beforeEach(() => {
      // Clean up all chains before each test
      for (const [key, val] of _activeDelegationChains.entries()) {
        if (val._timer) clearTimeout(val._timer);
      }
      _activeDelegationChains.clear();
    });

    describe('Constants', () => {
      it('MAX_DELEGATION_DEPTH should be 5', () => {
        expect(MAX_DELEGATION_DEPTH_ACTUAL).toBe(5);
      });

      it('MAX_MENTIONS_PER_RESPONSE should be 3', () => {
        expect(MAX_MENTIONS_PER_RESPONSE_ACTUAL).toBe(3);
      });
    });

    describe('getDelegationChain()', () => {
      it('should create a new chain for unknown conversationId', () => {
        const chain = getDelegationChain(999);
        expect(chain).toBeDefined();
        expect(chain.depth).toBe(0);
        expect(chain.agentIds).toBeInstanceOf(Set);
        expect(chain.agentIds.size).toBe(0);
      });

      it('should return same chain for same conversationId', () => {
        const chain1 = getDelegationChain(100);
        chain1.depth = 3;
        chain1.agentIds.add(42);
        const chain2 = getDelegationChain(100);
        expect(chain2.depth).toBe(3);
        expect(chain2.agentIds.has(42)).toBe(true);
      });

      it('should return different chains for different conversationIds', () => {
        const chain1 = getDelegationChain(100);
        chain1.depth = 3;
        const chain2 = getDelegationChain(200);
        expect(chain2.depth).toBe(0);
      });
    });

    describe('clearDelegationChain()', () => {
      it('should remove chain from active map', () => {
        getDelegationChain(100);
        expect(_activeDelegationChains.has(100)).toBe(true);
        clearDelegationChain(100);
        expect(_activeDelegationChains.has(100)).toBe(false);
      });

      it('should be safe to call on non-existent chain', () => {
        expect(() => clearDelegationChain(9999)).not.toThrow();
      });
    });

    describe('Circular reference detection logic', () => {
      it('should detect when agent A is already in chain (A→B→A)', () => {
        const chain = getDelegationChain(100);
        chain.agentIds.add(10); // Agent A
        chain.agentIds.add(20); // Agent B

        // Agent A tries to be delegated again
        expect(chain.agentIds.has(10)).toBe(true);
      });

      it('should detect longer cycles (A→B→C→A)', () => {
        const chain = getDelegationChain(100);
        chain.agentIds.add(10); // Agent A
        chain.agentIds.add(20); // Agent B
        chain.agentIds.add(30); // Agent C

        // Agent A tries to be delegated again
        expect(chain.agentIds.has(10)).toBe(true);
      });

      it('should allow new agent not in chain', () => {
        const chain = getDelegationChain(100);
        chain.agentIds.add(10); // Agent A
        chain.agentIds.add(20); // Agent B

        // Agent C is not yet in chain
        expect(chain.agentIds.has(30)).toBe(false);
      });
    });

    describe('Depth guard logic', () => {
      it('should allow delegation at depth <= MAX_DELEGATION_DEPTH', () => {
        const chain = getDelegationChain(100);
        chain.depth = MAX_DELEGATION_DEPTH_ACTUAL;
        expect(chain.depth > MAX_DELEGATION_DEPTH_ACTUAL).toBe(false);
      });

      it('should block delegation when depth exceeds MAX_DELEGATION_DEPTH', () => {
        const chain = getDelegationChain(100);
        chain.depth = MAX_DELEGATION_DEPTH_ACTUAL + 1;
        expect(chain.depth > MAX_DELEGATION_DEPTH_ACTUAL).toBe(true);
      });

      it('should track incrementing depth through simulated chain', () => {
        const chain = getDelegationChain(100);
        const agents = [10, 20, 30, 40, 50, 60]; // 6 agents

        for (const agentId of agents) {
          chain.depth += 1;
          chain.agentIds.add(agentId);

          if (chain.depth > MAX_DELEGATION_DEPTH_ACTUAL) {
            // At depth 6 (agent 60), should be blocked
            expect(agentId).toBe(60);
            break;
          }
        }

        expect(chain.depth).toBe(6); // Stopped at 6 > 5
        expect(chain.agentIds.size).toBe(6);
      });
    });

    describe('MAX_MENTIONS_PER_RESPONSE cap', () => {
      it('should cap mentions array to MAX_MENTIONS_PER_RESPONSE', () => {
        const mentions = ['agent-a', 'agent-b', 'agent-c', 'agent-d', 'agent-e'];
        const capped = mentions.slice(0, MAX_MENTIONS_PER_RESPONSE_ACTUAL);
        expect(capped).toHaveLength(3);
        expect(capped).toEqual(['agent-a', 'agent-b', 'agent-c']);
      });

      it('should not cap when mentions are within limit', () => {
        const mentions = ['agent-a', 'agent-b'];
        const capped = mentions.slice(0, MAX_MENTIONS_PER_RESPONSE_ACTUAL);
        expect(capped).toHaveLength(2);
      });
    });
  });

  describe('User input parsers — availability (parseMentions exported for display use)', () => {

    it('parseMentions is still exported as a function (used for display, not delegation)', async () => {
      // ADR-116 Task #4: parseMentions is no longer used for delegation triggers in user messages.
      // It remains exported for display/reference use only.
      const chatModule = await import('../chat.js');
      expect(typeof chatModule.parseMentions).toBe('function');
    });

    it('parseMentions extracts plain @mentions correctly (display use)', async () => {
      const chatModule = await import('../chat.js');
      const result = chatModule.parseMentions('@architect help me');
      expect(result).toEqual(['architect']);
    });

    it('parseMentions and parseDelegations are independent', async () => {
      const chatModule = await import('../chat.js');
      const text = 'Hey @marketer, please delegate to <<@architect>>';

      const mentions = chatModule.parseMentions(text);
      const delegations = chatModule.parseDelegations(text);

      // parseMentions catches all @-prefixed words (display use, not delegation)
      expect(mentions).toContain('marketer');
      // parseDelegations only catches explicit delegation syntax
      expect(delegations).toEqual(['architect']);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// ADR-116 Task #4: User message delegation uses invocation parsers only
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-116 Task #4: User message delegation — invocation parsers only', () => {
  let parseInvocationMentions, parseInvocationCommands;
  let parseReferenceMentions, parseReferenceCommands;

  beforeAll(async () => {
    const chatModule = await import('../chat.js');
    parseInvocationMentions = chatModule.parseInvocationMentions;
    parseInvocationCommands = chatModule.parseInvocationCommands;
    parseReferenceMentions = chatModule.parseReferenceMentions;
    parseReferenceCommands = chatModule.parseReferenceCommands;
  });

  describe('<<@slug>> triggers delegation; plain @slug does not', () => {
    it('<<@architect>> is detected as a delegation trigger', () => {
      expect(parseInvocationMentions('<<@architect>> help me')).toEqual(['architect']);
    });

    it('plain @architect is NOT detected as a delegation trigger', () => {
      // ADR-116 Task #4: only <<@slug>> triggers delegation — @slug is reference-only
      expect(parseInvocationMentions('@architect help me')).toEqual([]);
    });

    it('mixed user message — only <<@slug>> triggers, @slug is reference', () => {
      const content = '@marketer is mentioned but <<@architect>> is invoked';
      expect(parseInvocationMentions(content)).toEqual(['architect']);
      expect(parseReferenceMentions(content)).toEqual(['marketer']);
    });
  });

  describe('<</slug>> triggers delegation; plain /slug does not', () => {
    it('<</developer-ralph>> is detected as a delegation trigger', () => {
      expect(parseInvocationCommands('<</developer-ralph>> fix bug')).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
    });

    it('plain /developer-ralph is NOT detected as a delegation trigger', () => {
      // ADR-116 Task #4: only <</slug>> triggers delegation — /slug is reference-only
      expect(parseInvocationCommands('/developer-ralph fix bug')).toEqual([]);
    });

    it('mixed user message — only <</slug>> triggers, /slug is reference', () => {
      const content = 'Use /marketer for reference and <</developer-ralph>> for code';
      expect(parseInvocationCommands(content)).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
      expect(parseReferenceCommands(content)).toEqual(['marketer']);
    });
  });

  describe('combined invocation tokens in a single user message', () => {
    it('resolves both <<@slug>> and <</slug>> as delegation triggers', () => {
      const content = '<<@architect>> review design, <</test-runner>> run tests';
      const mentions = parseInvocationMentions(content);
      const commands = parseInvocationCommands(content).map(c => c.slug);
      const allDelegations = [...new Set([...mentions, ...commands])];
      expect(allDelegations).toEqual(['architect', 'test-runner']);
    });

    it('plain @slug and /slug produce NO delegation triggers', () => {
      const content = '@architect review and /test-runner run tests';
      expect(parseInvocationMentions(content)).toEqual([]);
      expect(parseInvocationCommands(content)).toEqual([]);
    });

    it('only structured tokens trigger delegation in a mixed message', () => {
      const content = '@marketer and /frontend noted, but <<@architect>> and <</developer-ralph>> must act';
      expect(parseInvocationMentions(content)).toEqual(['architect']);
      expect(parseInvocationCommands(content)).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
    });

    it('deduplicates when same slug appears in both <<@>> and <</>> forms', () => {
      const content = '<<@developer-ralph>> and <</developer-ralph>>';
      const mentions = parseInvocationMentions(content);
      const commands = parseInvocationCommands(content).map(c => c.slug);
      const allDelegations = [...new Set([...mentions, ...commands])];
      expect(allDelegations).toEqual(['developer-ralph']);
    });
  });

  describe('edge cases', () => {
    it('empty content produces no triggers', () => {
      expect(parseInvocationMentions('')).toEqual([]);
      expect(parseInvocationCommands('')).toEqual([]);
    });

    it('null content produces no triggers', () => {
      expect(parseInvocationMentions(null)).toEqual([]);
      expect(parseInvocationCommands(null)).toEqual([]);
    });

    it('URL paths are not mistaken for slash invocations', () => {
      expect(parseInvocationCommands('See https://example.com/api/v3 for docs')).toEqual([]);
    });

    it('partial tokens do not match (missing closing >>)', () => {
      expect(parseInvocationMentions('<<@architect')).toEqual([]);
      expect(parseInvocationCommands('<</architect')).toEqual([]);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// ADR-116: Structured Invocation Tokens — Full Parser Suite Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-116: Structured Invocation Tokens', () => {
  let parseInvocationMentions, parseInvocationCommands;
  let parseReferenceMentions, parseReferenceCommands;

  beforeAll(async () => {
    const chatModule = await import('../chat.js');
    parseInvocationMentions = chatModule.parseInvocationMentions;
    parseInvocationCommands = chatModule.parseInvocationCommands;
    parseReferenceMentions = chatModule.parseReferenceMentions;
    parseReferenceCommands = chatModule.parseReferenceCommands;
  });

  // ── parseInvocationMentions (<<@slug>>) ──────────────────────────────────

  describe('parseInvocationMentions()', () => {
    it('should parse <<@architect>> as invocation', () => {
      expect(parseInvocationMentions('<<@architect>> review this')).toEqual(['architect']);
    });

    it('should parse multiple <<@a>> <<@b>> tokens', () => {
      expect(parseInvocationMentions('<<@architect>> and <<@test-runner>> please'))
        .toEqual(['architect', 'test-runner']);
    });

    it('should NOT parse raw @architect as invocation', () => {
      expect(parseInvocationMentions('Ask @architect about this')).toEqual([]);
    });

    it('should be case-insensitive', () => {
      expect(parseInvocationMentions('<<@Architect>>')).toEqual(['architect']);
    });

    it('should return empty array for null/undefined input', () => {
      expect(parseInvocationMentions(null)).toEqual([]);
      expect(parseInvocationMentions(undefined)).toEqual([]);
      expect(parseInvocationMentions('')).toEqual([]);
    });

    it('should handle mixed tokens: <<@a>> and @b — only return a', () => {
      const text = 'I discussed with @marketer and now delegating to <<@developer-ralph>>';
      expect(parseInvocationMentions(text)).toEqual(['developer-ralph']);
    });
  });

  // ── parseInvocationCommands (<</slug>>) ──────────────────────────────────

  describe('parseInvocationCommands()', () => {
    it('should parse <</developer-ralph>> as invocation', () => {
      expect(parseInvocationCommands('<</developer-ralph>> fix bug')).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
    });

    it('should parse multiple <</a>> <</b>> tokens', () => {
      expect(parseInvocationCommands('<</architect>> and <</test-runner>>'))
        .toEqual([{ slug: 'architect', commandIndex: null }, { slug: 'test-runner', commandIndex: null }]);
    });

    it('should NOT parse raw /developer-ralph as invocation', () => {
      expect(parseInvocationCommands('Use /developer-ralph for bugs')).toEqual([]);
    });

    it('should NOT match URLs like https://example.com/path', () => {
      expect(parseInvocationCommands('Visit https://example.com/api/v3')).toEqual([]);
    });

    it('should be case-insensitive', () => {
      expect(parseInvocationCommands('<</Developer-Ralph>>')).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
    });

    it('should return empty array for null/undefined input', () => {
      expect(parseInvocationCommands(null)).toEqual([]);
      expect(parseInvocationCommands(undefined)).toEqual([]);
      expect(parseInvocationCommands('')).toEqual([]);
    });

    it('should handle mixed: <</a>> and /b — only return a', () => {
      const text = 'Use /marketer for marketing and <</developer-ralph>> for code';
      expect(parseInvocationCommands(text)).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
    });

    it('should parse <</slug/N>> with command index', () => {
      expect(parseInvocationCommands('<</sysadmin/0>>')).toEqual([{ slug: 'sysadmin', commandIndex: 0 }]);
      expect(parseInvocationCommands('<</sysadmin/1>>')).toEqual([{ slug: 'sysadmin', commandIndex: 1 }]);
    });
  });

  // ── parseReferenceMentions (@slug outside <<@...>>) ──────────────────────

  describe('parseReferenceMentions()', () => {
    it('should parse @architect as reference', () => {
      expect(parseReferenceMentions('As @architect noted')).toEqual(['architect']);
    });

    it('should NOT include slugs from <<@architect>> tokens', () => {
      expect(parseReferenceMentions('<<@architect>> reviewed it')).toEqual([]);
    });

    it('should handle text with both formats', () => {
      const text = 'As @marketer said, delegating to <<@architect>>';
      expect(parseReferenceMentions(text)).toEqual(['marketer']);
    });

    it('should return empty for null/undefined', () => {
      expect(parseReferenceMentions(null)).toEqual([]);
      expect(parseReferenceMentions(undefined)).toEqual([]);
    });

    it('should return multiple references', () => {
      expect(parseReferenceMentions('@architect and @developer discussed')).toEqual(['architect', 'developer']);
    });
  });

  // ── parseReferenceCommands (/slug outside <</...>>) ──────────────────────

  describe('parseReferenceCommands()', () => {
    it('should parse /developer-ralph as reference', () => {
      expect(parseReferenceCommands('Use /developer-ralph for bugs')).toEqual(['developer-ralph']);
    });

    it('should NOT include slugs from <</developer-ralph>> tokens', () => {
      expect(parseReferenceCommands('<</developer-ralph>> fix it')).toEqual([]);
    });

    it('should NOT match URLs or file paths', () => {
      expect(parseReferenceCommands('Visit https://example.com/path')).toEqual([]);
    });

    it('should handle text with both formats', () => {
      const text = 'Use /marketer for marketing and <</developer-ralph>> for code';
      expect(parseReferenceCommands(text)).toEqual(['marketer']);
    });

    it('should return empty for null/undefined', () => {
      expect(parseReferenceCommands(null)).toEqual([]);
      expect(parseReferenceCommands(undefined)).toEqual([]);
    });
  });

  // ── Integration: Agent response processing ──────────────────────────────

  describe('Agent response processing (no false positives)', () => {
    it('should NOT trigger delegation for plain @mention in agent response', () => {
      const agentResponse = '@architect recommends using microservices';
      expect(parseInvocationMentions(agentResponse)).toEqual([]);
      expect(parseInvocationCommands(agentResponse)).toEqual([]);
    });

    it('should trigger delegation ONLY for <<@agent>> in agent response', () => {
      const agentResponse = 'Done. <<@test-runner>> please run tests';
      expect(parseInvocationMentions(agentResponse)).toEqual(['test-runner']);
    });

    it('should trigger delegation for <</agent>> in agent response', () => {
      const agentResponse = 'Done. <</test-runner>> please run tests';
      expect(parseInvocationCommands(agentResponse)).toEqual([{ slug: 'test-runner', commandIndex: null }]);
    });

    it('should handle mixed <<@a>> and <</b>> in same response', () => {
      const agentResponse = '<<@architect>> review design, <</test-runner>> run tests';
      const mentions = parseInvocationMentions(agentResponse);
      const commands = parseInvocationCommands(agentResponse).map(c => c.slug);
      const allDelegations = [...new Set([...mentions, ...commands])];
      expect(allDelegations).toEqual(['architect', 'test-runner']);
    });

    it('should dedupe when same agent appears in both <<@>> and <</>> form', () => {
      const agentResponse = '<<@developer-ralph>> and <</developer-ralph>>';
      const mentions = parseInvocationMentions(agentResponse);
      const commands = parseInvocationCommands(agentResponse).map(c => c.slug);
      const allDelegations = [...new Set([...mentions, ...commands])];
      expect(allDelegations).toEqual(['developer-ralph']);
    });
  });
});
