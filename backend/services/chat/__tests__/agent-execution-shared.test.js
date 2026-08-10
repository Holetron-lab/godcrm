/**
 * ADR-093: Tests for Shared Agent Execution Services
 * @see backend/services/chat/agent-execution-shared.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database functions before imports
vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn(),
  dbAll: vi.fn(),
  dbRun: vi.fn(),
  isPostgres: vi.fn(() => false),
  safeJsonParse: vi.fn((str, def) => {
    if (typeof str === 'object') return str;
    try { return JSON.parse(str); } catch { return def; }
  }),
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock pipeline-config for ADR-077 ticket context tests
vi.mock('../../pipeline-config.js', () => ({
  getPipelineConfig: vi.fn((spaceId) => {
    if (spaceId === 11 || spaceId === undefined) {
      return {
        TICKETS_TABLE_ID: 1708,
        STATE: {
          BACKLOG: 24275,
          ASSIGNED: 43436,
          IN_PROGRESS: 24276,
          REVIEW: 24277,
          CONTROL: 43437,
          REJECTED: 43438,
          DONE: 24278,
        },
        AGENT_USERS: {
          ORCHESTRATOR: 18,
          DEV_RALPH: 19,
          DEVELOPER: 20,
          FRONTEND: 21,
          ARCHITECT: 24,
        },
      };
    }
    if (spaceId === 36) {
      return {
        TICKETS_TABLE_ID: 3207,
        STATE: {
          BACKLOG: 57081,
          IN_PROGRESS: 57083,
          REVIEW: 57084,
          DONE: 57086,
        },
        AGENT_USERS: {},
      };
    }
    throw new Error(`No pipeline config for space ${spaceId}`);
  }),
  getRegisteredSpaceIds: vi.fn(() => [11, 36]),
}));

import {
  resolveAgentProvider,
  buildAgentSystemPrompt,
  loadConversationHistory,
  loadNewMessagesSince,
  fetchBoundRowContext,
  fetchAgentSkills,
  detectProvider,
  getHistoryLimit,
  DEFAULT_MAX_HISTORY,
  fetchLatestPlan,
  formatPlanAsContext,
  handleManagePlan,
  isTicketsTable,
  buildTicketContext,
  buildHandoffProtocol,
  buildDelegationInstructions,
} from '../agent-execution-shared.js';
import { dbGet, dbAll, dbRun } from '../../../database/connection.js';

describe('ADR-093: Shared Agent Execution Services', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── resolveAgentProvider ───────────────────────────────────

  describe('resolveAgentProvider()', () => {

    it('should resolve operator and API key from operator_id', async () => {
      dbGet.mockResolvedValueOnce({
        data: JSON.stringify({ api_key: 'sk-test-123', provider: 'openai', name: 'OpenAI' }),
      });

      const result = await resolveAgentProvider({ operator_id: 42, model: 'gpt-4' });

      expect(result.apiKey).toBe('sk-test-123');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
      expect(result.isLocal).toBe(false);
    });

    it('should fallback to AI API Keys table when operator has no api_key', async () => {
      // Operator row without api_key
      dbGet.mockResolvedValueOnce({
        data: JSON.stringify({ provider: 'anthropic', name: 'Anthropic' }),
      });
      // API Keys table fallback
      dbGet.mockResolvedValueOnce({
        data: JSON.stringify({ api_key: 'sk-ant-fallback', status: 'active' }),
      });

      const result = await resolveAgentProvider({ operator_id: 42, model: 'claude-sonnet-4' });

      expect(result.apiKey).toBe('sk-ant-fallback');
      expect(result.provider).toBe('anthropic');
    });

    it('should detect local providers and skip API key fallback', async () => {
      dbGet.mockResolvedValueOnce({
        data: JSON.stringify({ provider: 'claude-code', name: 'Claude Code CLI' }),
      });

      const result = await resolveAgentProvider({ operator_id: 42 });

      expect(result.isLocal).toBe(true);
      expect(result.provider).toBe('claude-code');
      // Should NOT fall back to env var or space search
    });

    it('should fallback to env var when no API key found', async () => {
      // No operator_id
      process.env.OPENAI_API_KEY = 'sk-env-fallback';

      const result = await resolveAgentProvider({ model: 'gpt-4' });

      expect(result.apiKey).toBe('sk-env-fallback');
      expect(result.provider).toBe('openai');

      delete process.env.OPENAI_API_KEY;
    });

    it('should resolve model from Models table when model is numeric', async () => {
      dbGet.mockResolvedValueOnce({
        data: JSON.stringify({ api_key: 'sk-test', provider: 'openai' }),
      });
      // Model lookup
      dbGet.mockResolvedValueOnce(null); // no API Keys fallback needed
      // Skipped because apiKey already found, but modelRowId triggers Models lookup

      const result = await resolveAgentProvider({ operator_id: 42, model: 'gpt-4-turbo' });

      expect(result.model).toBe('gpt-4-turbo');
    });

    it('should use default model when none specified', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const result = await resolveAgentProvider({});
      expect(result.model).toBe('gpt-4o');
      delete process.env.OPENAI_API_KEY;
    });
  });

  // ─── detectProvider ─────────────────────────────────────────

  describe('detectProvider()', () => {

    it('should detect claude-code provider', () => {
      const result = detectProvider('claude-code', 'claude-sonnet-4');
      expect(result.isClaudeCode).toBe(true);
      expect(result.isCopilot).toBe(false);
      expect(result.isAnthropic).toBe(false);
    });

    it('should detect copilot provider', () => {
      const result = detectProvider('copilot', 'copilot-model');
      expect(result.isCopilot).toBe(true);
      expect(result.isClaudeCode).toBe(false);
      expect(result.isAnthropic).toBe(false);
    });

    it('should detect anthropic by provider name', () => {
      const result = detectProvider('anthropic', 'claude-sonnet-4');
      expect(result.isAnthropic).toBe(true);
    });

    it('should detect anthropic by model name containing claude', () => {
      const result = detectProvider('openai', 'claude-sonnet-4-20250514');
      expect(result.isAnthropic).toBe(true);
    });

    it('should default to openai when no special provider', () => {
      const result = detectProvider('openai', 'gpt-4-turbo');
      expect(result.isClaudeCode).toBe(false);
      expect(result.isCopilot).toBe(false);
      expect(result.isAnthropic).toBe(false);
    });
  });

  // ─── buildAgentSystemPrompt ─────────────────────────────────

  describe('buildAgentSystemPrompt()', () => {

    it('should build prompt from crm_instructions + main_instructions', async () => {
      const result = await buildAgentSystemPrompt({
        crm_instructions: 'CRM knowledge here',
        main_instructions: 'Agent persona here',
      });

      expect(result).toContain('CRM knowledge here');
      expect(result).toContain('Agent persona here');
      expect(result).toContain('---');
    });

    it('should fallback to system_prompt when crm/main not set', async () => {
      const result = await buildAgentSystemPrompt({
        system_prompt: 'Legacy prompt',
      });

      expect(result).toContain('Legacy prompt');
    });

    it('should fallback to instructions field', async () => {
      const result = await buildAgentSystemPrompt({
        instructions: 'Instruction prompt',
      });

      expect(result).toContain('Instruction prompt');
    });

    it('should fallback to default when nothing set', async () => {
      const result = await buildAgentSystemPrompt({});
      expect(result).toContain('helpful assistant');
    });

    describe('api-key mode', () => {
      it('should NOT inject space_id', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, conversationId: 42 },
          'api-key'
        );

        expect(result).not.toContain('space_id');
        expect(result).toContain('conversation_id is 42');
      });

      it('should NOT include bound row context', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          {
            spaceId: 11,
            conversationId: 42,
            boundRow: { table_id: 100, row_id: 200, table_name: 'Tasks', data: { title: 'Test' } },
          },
          'api-key'
        );

        expect(result).not.toContain('Linked row');
        expect(result).not.toContain('Tasks');
      });
    });

    describe('account mode', () => {
      it('should inject space_id', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, conversationId: 42 },
          'account'
        );

        expect(result).toContain('space_id: 11');
        expect(result).toContain('conversation_id is 42');
      });

      it('should include bound row context in ask mode (full data)', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          {
            spaceId: 11,
            conversationId: 42,
            boundRow: { table_id: 100, row_id: 200, table_name: 'Tasks', data: { title: 'Test Task' } },
            agentMode: 'ask',
          },
          'account'
        );

        expect(result).toContain('Linked Row');
        expect(result).toContain('"Test Task"');
        expect(result).toContain('table_id: 100');
      });

      it('should include bound row context in agent mode (reference only)', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          {
            spaceId: 11,
            conversationId: 42,
            boundRow: { table_id: 100, row_id: 200, table_name: 'Tasks', data: { title: 'Test Task' } },
            agentMode: 'agent',
          },
          'account'
        );

        expect(result).toContain('Linked row');
        expect(result).toContain('table_id: 100');
        expect(result).not.toContain('"Test Task"');
      });

      it('should include tool introspection hints', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, conversationId: 42 },
          'account'
        );

        expect(result).toContain('view_conversation_steps');
      });
    });

    it('both modes should include crm_instructions', async () => {
      const agentConfig = {
        crm_instructions: 'CRM knowledge',
        main_instructions: 'Agent role',
      };

      const apiKeyResult = await buildAgentSystemPrompt(agentConfig, {}, 'api-key');
      const accountResult = await buildAgentSystemPrompt(agentConfig, { spaceId: 11 }, 'account');

      expect(apiKeyResult).toContain('CRM knowledge');
      expect(accountResult).toContain('CRM knowledge');
      expect(apiKeyResult).toContain('Agent role');
      expect(accountResult).toContain('Agent role');
    });

    // ─── T-147809: Group Chat Awareness ──────────────────────
    describe('Group Chat Awareness (T-147809)', () => {
      it('injects awareness block listing human owner + agent participants', async () => {
        dbAll.mockResolvedValueOnce([
          { user_id: 1, role: 'owner', user_type: 'human', name: 'GERATRON', managed_by_agent_row_id: null, agent_row_data: null },
          { user_id: 18, role: 'member', user_type: 'agent', name: 'orchestrator', managed_by_agent_row_id: 100,
            agent_row_data: JSON.stringify({ slug: 'orchestrator', name: 'Orchestrator' }) },
          { user_id: 19, role: 'member', user_type: 'agent', name: 'developer-ralph', managed_by_agent_row_id: 101,
            agent_row_data: JSON.stringify({ slug: 'developer-ralph', name: 'Developer Ralph' }) },
        ]);

        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, conversationId: 3149 },
          'account'
        );

        expect(result).toContain('## Group Chat Awareness');
        expect(result).toContain('conversation_id: 3149');
        expect(result).toContain('GERATRON');
        expect(result).toContain('@orchestrator (Orchestrator)');
        expect(result).toContain('@developer-ralph (Developer Ralph)');
        expect(result).toContain('not yours');
        expect(result).toContain('stay silent rather than duplicate');
      });

      it('places the awareness block BEFORE the [CONTEXT] block', async () => {
        dbAll.mockResolvedValueOnce([
          { user_id: 1, role: 'owner', user_type: 'human', name: 'Owner', managed_by_agent_row_id: null, agent_row_data: null },
          { user_id: 2, role: 'member', user_type: 'agent', name: 'a', managed_by_agent_row_id: 50,
            agent_row_data: JSON.stringify({ slug: 'a', name: 'Agent A' }) },
        ]);

        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, conversationId: 42 },
          'account'
        );

        const awarenessIdx = result.indexOf('## Group Chat Awareness');
        const contextIdx = result.indexOf('[CONTEXT]');
        expect(awarenessIdx).toBeGreaterThan(-1);
        expect(contextIdx).toBeGreaterThan(-1);
        expect(awarenessIdx).toBeLessThan(contextIdx);
      });

      it('omits the awareness block when conversation has no participants', async () => {
        dbAll.mockResolvedValueOnce([]);

        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, conversationId: 42 },
          'account'
        );

        expect(result).not.toContain('## Group Chat Awareness');
      });

      it('omits the awareness block when no conversationId is provided', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11 },
          'account'
        );

        expect(result).not.toContain('## Group Chat Awareness');
        // The awareness query should NOT have been issued at all
        expect(dbAll).not.toHaveBeenCalled();
      });

      it('falls back gracefully on DB error (does not break prompt assembly)', async () => {
        dbAll.mockRejectedValueOnce(new Error('connection refused'));

        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, conversationId: 42 },
          'account'
        );

        expect(result).toContain('Test');
        expect(result).toContain('[CONTEXT]');
        expect(result).not.toContain('## Group Chat Awareness');
      });

      it('also injects awareness in api-key mode when conversationId is set', async () => {
        dbAll.mockResolvedValueOnce([
          { user_id: 1, role: 'owner', user_type: 'human', name: 'Owner', managed_by_agent_row_id: null, agent_row_data: null },
        ]);

        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { conversationId: 42 },
          'api-key'
        );

        expect(result).toContain('## Group Chat Awareness');
        expect(result.indexOf('## Group Chat Awareness')).toBeLessThan(result.indexOf('[CONTEXT]'));
      });

      it('renders human-only conversation with no "Other participants"', async () => {
        dbAll.mockResolvedValueOnce([
          { user_id: 1, role: 'owner', user_type: 'human', name: 'Solo', managed_by_agent_row_id: null, agent_row_data: null },
        ]);

        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, conversationId: 42 },
          'account'
        );

        expect(result).toContain('Human owner:** Solo');
        expect(result).toContain('only the owner is in this conversation');
      });
    });
  });

  // ─── getHistoryLimit ────────────────────────────────────────

  describe('getHistoryLimit()', () => {

    it('should return DEFAULT_MAX_HISTORY when no config', () => {
      expect(getHistoryLimit({})).toBe(DEFAULT_MAX_HISTORY);
      expect(DEFAULT_MAX_HISTORY).toBe(50);
    });

    it('should read from agentConfig.max_history first', () => {
      expect(getHistoryLimit({ max_history: 100 })).toBe(100);
    });

    it('should read from context_settings.max_history', () => {
      expect(getHistoryLimit({
        context_settings: JSON.stringify({ max_history: 75 }),
      })).toBe(75);
    });

    it('should handle object context_settings', () => {
      expect(getHistoryLimit({
        context_settings: { max_history: 30 },
      })).toBe(30);
    });

    it('should handle invalid values gracefully', () => {
      expect(getHistoryLimit({ max_history: 'not-a-number' })).toBe(DEFAULT_MAX_HISTORY);
      expect(getHistoryLimit({ max_history: -5 })).toBe(DEFAULT_MAX_HISTORY);
      expect(getHistoryLimit({ max_history: 0 })).toBe(DEFAULT_MAX_HISTORY);
    });
  });

  // ─── loadConversationHistory ────────────────────────────────

  describe('loadConversationHistory()', () => {

    it('should load messages from DB and format for AI API', async () => {
      // DB returns in DESC order (newest first), function reverses to chronological
      dbAll.mockResolvedValueOnce([
        { id: 3, content: 'Thanks', role: 'user', sender_id: 1, sender_name: 'Alice', content_type: 'text' },
        { id: 2, content: 'Hi there', role: 'assistant', sender_id: 2, content_type: 'text' },
        { id: 1, content: 'Hello', role: 'user', sender_id: 1, sender_name: 'Alice', content_type: 'text' },
      ]);

      const result = await loadConversationHistory(42, { context_settings: { max_history: 50 } });

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ role: 'user', content: '[Alice]: Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there' });
      expect(result[2]).toEqual({ role: 'user', content: '[Alice]: Thanks' });
    });

    it('should respect configurable max_history', async () => {
      dbAll.mockResolvedValueOnce([]);

      await loadConversationHistory(42, { max_history: 100 });

      // ADR-110: LIMIT is now the last parameter (after content_type params)
      const callArgs = dbAll.mock.calls[0][1];
      const lastParam = callArgs[callArgs.length - 1];
      expect(lastParam).toBe(100);
    });

    it('should use DEFAULT_MAX_HISTORY when not configured', async () => {
      dbAll.mockResolvedValueOnce([]);

      await loadConversationHistory(42, {});

      // ADR-110: LIMIT is now the last parameter (after content_type params)
      const callArgs = dbAll.mock.calls[0][1];
      const lastParam = callArgs[callArgs.length - 1];
      expect(lastParam).toBe(50);
    });

    it('should use agentUserId to determine assistant role', async () => {
      dbAll.mockResolvedValueOnce([
        { id: 1, content: 'Agent response', role: 'user', sender_id: 99, sender_name: 'Bot', content_type: 'text' },
      ]);

      const result = await loadConversationHistory(42, {}, 99);

      expect(result[0].role).toBe('assistant');
    });

    it('should return messages in chronological order (reversed from DB DESC)', async () => {
      dbAll.mockResolvedValueOnce([
        { id: 3, content: 'Third', role: 'user', sender_id: 1, content_type: 'text' },
        { id: 2, content: 'Second', role: 'user', sender_id: 1, content_type: 'text' },
        { id: 1, content: 'First', role: 'user', sender_id: 1, content_type: 'text' },
      ]);

      const result = await loadConversationHistory(42);

      // DB returns DESC order, function reverses to ASC
      expect(result[0].content).toBe('First');
      expect(result[2].content).toBe('Third');
    });
  });

  // ─── loadNewMessagesSince (T-148527 WP-A) ──────────────────

  describe('loadNewMessagesSince() — T-148527 WP-A', () => {

    beforeEach(() => {
      dbAll.mockReset();
    });

    it('returns rows when conversation has user messages newer than cursor', async () => {
      dbAll.mockResolvedValueOnce([
        { id: 10, sender_id: 1, content: 'follow-up question', created_at: '2026-05-11T05:00:01Z', sender_name: 'GERATRON' },
        { id: 11, sender_id: 1, content: 'and also this', created_at: '2026-05-11T05:00:02Z', sender_name: 'GERATRON' },
      ]);

      const result = await loadNewMessagesSince(42, '2026-05-11T05:00:00Z', 99);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('follow-up question');
      expect(result[1].sender_name).toBe('GERATRON');
      // sqlite branch passes agentUserId twice (positional)
      const callArgs = dbAll.mock.calls[0][1];
      expect(callArgs).toContain(42);
      expect(callArgs).toContain('2026-05-11T05:00:00Z');
      expect(callArgs).toContain(99);
    });

    it('returns [] when cursor is missing', async () => {
      const result = await loadNewMessagesSince(42, null, 99);
      expect(result).toEqual([]);
      expect(dbAll).not.toHaveBeenCalled();
    });

    it('returns [] when conversationId is missing', async () => {
      const result = await loadNewMessagesSince(null, '2026-05-11T05:00:00Z', 99);
      expect(result).toEqual([]);
      expect(dbAll).not.toHaveBeenCalled();
    });

    it('returns [] gracefully on DB error (non-blocking)', async () => {
      dbAll.mockRejectedValueOnce(new Error('connection refused'));
      const result = await loadNewMessagesSince(42, '2026-05-11T05:00:00Z', 99);
      expect(result).toEqual([]);
    });

    it('returns [] when no fresh messages match the cursor', async () => {
      dbAll.mockResolvedValueOnce([]);
      const result = await loadNewMessagesSince(42, '2026-05-11T05:00:00Z', null);
      expect(result).toEqual([]);
    });

    it('works without agentUserId (returns all user-role messages)', async () => {
      dbAll.mockResolvedValueOnce([
        { id: 5, sender_id: 1, content: 'hello', created_at: '2026-05-11T05:00:01Z', sender_name: 'Alice' },
      ]);
      const result = await loadNewMessagesSince(42, '2026-05-11T05:00:00Z');
      expect(result).toHaveLength(1);
    });
  });

  // ─── fetchBoundRowContext ───────────────────────────────────

  describe('fetchBoundRowContext()', () => {

    beforeEach(() => {
      dbGet.mockReset();
    });

    it('should return null when no bound row on conversation', async () => {
      dbGet.mockResolvedValueOnce({ bound_table_id: null, bound_row_id: null });

      const result = await fetchBoundRowContext(42);
      expect(result).toBeNull();
    });

    it('should return bound row context when present', async () => {
      dbGet
        .mockResolvedValueOnce({ bound_table_id: 100, bound_row_id: 200 })
        .mockResolvedValueOnce({
          id: 200,
          data: JSON.stringify({ title: 'Test Task', status: 'open' }),
          table_name: 'Tasks',
        });

      const result = await fetchBoundRowContext(42);

      expect(result).toEqual({
        table_id: 100,
        row_id: 200,
        table_name: 'Tasks',
        data: { title: 'Test Task', status: 'open' },
      });
    });

    it('should return null when bound row not found in table', async () => {
      dbGet
        .mockResolvedValueOnce({ bound_table_id: 100, bound_row_id: 999 })
        .mockResolvedValueOnce(null); // row not found

      const result = await fetchBoundRowContext(42);
      expect(result).toBeNull();
    });
  });

  // ─── Integration: Dual Prompt Model ─────────────────────────

  describe('Dual Prompt Model (D6/D9)', () => {

    const agentConfig = {
      crm_instructions: '## CRM Knowledge\nYou know how to use the CRM API.',
      main_instructions: '## Agent Persona\nYou are a developer assistant.',
    };

    it('/ai/run (API-key mode): both instructions, no context injection', async () => {
      const prompt = await buildAgentSystemPrompt(agentConfig, {
        conversationId: 42,
      }, 'api-key');

      expect(prompt).toContain('CRM Knowledge');
      expect(prompt).toContain('Agent Persona');
      expect(prompt).toContain('conversation_id is 42');
      expect(prompt).not.toContain('space_id');
      expect(prompt).not.toContain('view_conversation_steps');
    });

    it('/ai/chat (Account mode): both instructions + full context', async () => {
      const prompt = await buildAgentSystemPrompt(agentConfig, {
        spaceId: 11,
        conversationId: 42,
        boundRow: { table_id: 100, row_id: 200, table_name: 'Tasks', data: { title: 'Deploy app' } },
        agentMode: 'ask',
      }, 'account');

      expect(prompt).toContain('CRM Knowledge');
      expect(prompt).toContain('Agent Persona');
      expect(prompt).toContain('space_id: 11');
      expect(prompt).toContain('conversation_id is 42');
      expect(prompt).toContain('view_conversation_steps');
      expect(prompt).toContain('Linked Row');
      expect(prompt).toContain('"Deploy app"');
    });
  });

  // ─── S05: Runtime Skill Injection ───────────────────────────

  describe('S05: Runtime Skill Injection', () => {

    // ── buildAgentSystemPrompt() with skills ──────────────────

    describe('buildAgentSystemPrompt() with context.skills', () => {

      it('should inject skill content into prompt when context.skills provided', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Agent persona' },
          {
            spaceId: 11,
            skills: [
              { name: 'react', display_name: 'React Best Practices', skill_content: '## React\nUse hooks.' },
              { name: 'tdd', display_name: 'TDD Workflow', skill_content: '## TDD\nRed-Green-Refactor.' },
            ],
          },
          'account'
        );

        expect(result).toContain('React Best Practices');
        expect(result).toContain('Use hooks.');
        expect(result).toContain('TDD Workflow');
        expect(result).toContain('Red-Green-Refactor.');
      });

      it('should place skills section between base prompt and context', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'BASE_PROMPT' },
          {
            spaceId: 11,
            conversationId: 99,
            skills: [{ name: 'react', display_name: 'React', skill_content: 'SKILL_CONTENT' }],
          },
          'account'
        );

        const basePos = result.indexOf('BASE_PROMPT');
        const skillPos = result.indexOf('SKILL_CONTENT');
        const contextPos = result.indexOf('[CONTEXT]');

        expect(basePos).toBeLessThan(skillPos);
        expect(skillPos).toBeLessThan(contextPos);
      });

      it('should skip skills with empty or missing skill_content', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          {
            skills: [
              { name: 'empty-skill', display_name: 'Empty', skill_content: '' },
              { name: 'null-skill', display_name: 'Null' },
              { name: 'good-skill', display_name: 'Good Skill', skill_content: 'GOOD_CONTENT' },
            ],
          },
          'account'
        );

        expect(result).toContain('GOOD_CONTENT');
        expect(result).not.toContain('empty-skill');
        expect(result).not.toContain('null-skill');
      });

      it('should not add skills section when context.skills is empty or absent', async () => {
        const withEmpty = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, skills: [] },
          'account'
        );
        const withAbsent = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11 },
          'account'
        );

        expect(withEmpty).not.toContain('## Injected Skills');
        expect(withAbsent).not.toContain('## Injected Skills');
      });

      it('should inject skills in both api-key and account modes', async () => {
        const skills = [{ name: 'docker', display_name: 'Docker', skill_content: 'DOCKER_CONTENT' }];

        const apiKeyResult = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { conversationId: 1, skills },
          'api-key'
        );
        const accountResult = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          { spaceId: 11, skills },
          'account'
        );

        expect(apiKeyResult).toContain('DOCKER_CONTENT');
        expect(accountResult).toContain('DOCKER_CONTENT');
      });
    });

    // ── fetchAgentSkills() ────────────────────────────────────

    describe('fetchAgentSkills()', () => {

      beforeEach(() => {
        dbGet.mockReset();
        dbAll.mockReset();
      });

      it('should return empty array when skills_registry table does not exist', async () => {
        dbGet.mockResolvedValueOnce(null); // no skills_registry table found

        const result = await fetchAgentSkills(31113, 11);

        expect(result).toEqual([]);
      });

      it('should return published skills linked to agent via agent_ids', async () => {
        // skills_registry table lookup
        dbGet.mockResolvedValueOnce({ id: 500 });

        // skill_installations table lookup (optional, return null = not found)
        dbGet.mockResolvedValueOnce(null);

        // skills query result
        dbAll.mockResolvedValueOnce([
          {
            data: JSON.stringify({
              name: 'react',
              display_name: 'React Best Practices',
              skill_content: '## React\nUse functional components.',
              status: 'published',
              agent_ids: [31113],
            }),
          },
        ]);

        const result = await fetchAgentSkills(31113, 11);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('react');
        expect(result[0].display_name).toBe('React Best Practices');
        expect(result[0].skill_content).toContain('Use functional components.');
      });

      it('should also return space-level skills from skill_installations', async () => {
        // skills_registry table lookup
        dbGet.mockResolvedValueOnce({ id: 500 });

        // skill_installations table lookup
        dbGet.mockResolvedValueOnce({ id: 501 });

        // agent-level skills (none)
        dbAll.mockResolvedValueOnce([]);

        // space-level installed skills
        dbAll.mockResolvedValueOnce([
          {
            data: JSON.stringify({
              name: 'typescript',
              display_name: 'TypeScript Patterns',
              skill_content: '## TypeScript\nUse strict mode.',
              status: 'published',
            }),
          },
        ]);

        const result = await fetchAgentSkills(31113, 11);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('typescript');
      });

      it('should deduplicate skills appearing in both agent and space levels', async () => {
        dbGet.mockResolvedValueOnce({ id: 500 }); // skills_registry
        dbGet.mockResolvedValueOnce({ id: 501 }); // skill_installations

        // Agent-level skill: react
        dbAll.mockResolvedValueOnce([
          {
            data: JSON.stringify({
              name: 'react',
              display_name: 'React',
              skill_content: 'React content',
              status: 'published',
            }),
          },
        ]);

        // Space-level skill: react (duplicate) + new one
        dbAll.mockResolvedValueOnce([
          {
            data: JSON.stringify({
              name: 'react',
              display_name: 'React',
              skill_content: 'React content',
              status: 'published',
            }),
          },
          {
            data: JSON.stringify({
              name: 'docker',
              display_name: 'Docker',
              skill_content: 'Docker content',
              status: 'published',
            }),
          },
        ]);

        const result = await fetchAgentSkills(31113, 11);

        expect(result).toHaveLength(2);
        const names = result.map(s => s.name);
        expect(names).toContain('react');
        expect(names).toContain('docker');
      });

      it('should skip skills with no skill_content', async () => {
        dbGet.mockResolvedValueOnce({ id: 500 }); // skills_registry
        dbGet.mockResolvedValueOnce(null); // no skill_installations

        dbAll.mockResolvedValueOnce([
          {
            data: JSON.stringify({
              name: 'empty-skill',
              display_name: 'Empty',
              skill_content: '',
              status: 'published',
            }),
          },
          {
            data: JSON.stringify({
              name: 'good-skill',
              display_name: 'Good',
              skill_content: '## Content here',
              status: 'published',
            }),
          },
        ]);

        const result = await fetchAgentSkills(31113, 11);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('good-skill');
      });

      it('should return empty array when agentId is null or undefined', async () => {
        const result1 = await fetchAgentSkills(null, 11);
        const result2 = await fetchAgentSkills(undefined, 11);

        expect(result1).toEqual([]);
        expect(result2).toEqual([]);
      });
    });
  });

  // ─── ADR-113: Planning Context ────────────────────────────────

  describe('ADR-113: Planning Context', () => {

    // ── formatPlanAsContext() ──────────────────────────────────

    describe('formatPlanAsContext()', () => {

      it('should format plan data as compact checklist', () => {
        const planData = {
          tasks: [
            { id: 1, title: 'Create database migration', status: 'completed', note: 'added users table' },
            { id: 2, title: 'Write API endpoint', status: 'in_progress' },
            { id: 3, title: 'Add input validation', status: 'pending' },
            { id: 4, title: 'Update API docs', status: 'blocked', note: 'waiting for schema' },
          ],
        };

        const result = formatPlanAsContext(planData);

        expect(result).toContain('## Current Plan (1/4 complete)');
        expect(result).toContain('- [x] 1. Create database migration (added users table)');
        expect(result).toContain('- [→] 2. Write API endpoint');
        expect(result).toContain('- [ ] 3. Add input validation');
        expect(result).toContain('- [!] 4. Update API docs (waiting for schema)');
      });

      it('should return empty string when no tasks', () => {
        expect(formatPlanAsContext(null)).toBe('');
        expect(formatPlanAsContext({})).toBe('');
        expect(formatPlanAsContext({ tasks: [] })).toBe('');
      });

      it('should count completed tasks correctly', () => {
        const planData = {
          tasks: [
            { id: 1, title: 'Task 1', status: 'completed' },
            { id: 2, title: 'Task 2', status: 'completed' },
            { id: 3, title: 'Task 3', status: 'pending' },
          ],
        };

        const result = formatPlanAsContext(planData);
        expect(result).toContain('(2/3 complete)');
      });

      it('should handle unknown status as pending', () => {
        const planData = {
          tasks: [
            { id: 1, title: 'Task 1', status: 'unknown_status' },
          ],
        };

        const result = formatPlanAsContext(planData);
        expect(result).toContain('- [ ] 1. Task 1');
      });
    });

    // ── fetchLatestPlan() ─────────────────────────────────────

    describe('fetchLatestPlan()', () => {

      beforeEach(() => {
        dbGet.mockReset();
      });

      it('should return parsed plan data when plan message exists', async () => {
        const planContent = JSON.stringify({
          tasks: [
            { id: 1, title: 'Step 1', status: 'completed' },
            { id: 2, title: 'Step 2', status: 'in_progress' },
          ],
        });

        dbGet.mockResolvedValueOnce({ content: planContent, updated_at: '2026-03-05' });

        const result = await fetchLatestPlan(42);

        expect(result).not.toBeNull();
        expect(result.tasks).toHaveLength(2);
        expect(result.tasks[0].title).toBe('Step 1');
      });

      it('should return null when no plan message exists', async () => {
        dbGet.mockResolvedValueOnce(null);

        const result = await fetchLatestPlan(42);
        expect(result).toBeNull();
      });

      it('should return null when plan content is invalid JSON', async () => {
        dbGet.mockResolvedValueOnce({ content: 'not-json', updated_at: '2026-03-05' });

        const result = await fetchLatestPlan(42);
        expect(result).toBeNull();
      });

      it('should return null gracefully on DB error', async () => {
        dbGet.mockRejectedValueOnce(new Error('DB connection failed'));

        const result = await fetchLatestPlan(42);
        expect(result).toBeNull();
      });
    });

    // ── buildAgentSystemPrompt() with planning ───────────────

    describe('buildAgentSystemPrompt() with planning', () => {

      beforeEach(() => {
        dbGet.mockReset();
      });

      it('should inject planning instructions when planning.enabled is true', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true } },
          {},
          'account'
        );

        expect(result).toContain('## Planning');
        expect(result).toContain('manage_plan');
        expect(result).toContain('3 or more steps');
        expect(result).toContain('fewer than 3 steps');
      });

      it('should default the planning tool to manage_plan (native agent-loop)', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true } },
          {},
          'account'
        );

        // Native loop registers manage_plan (loop.js). Default MUST stay manage_plan
        // so non-claude-code agents are told to call a tool they actually have.
        expect(result).toContain('`manage_plan` tool');
        expect(result).not.toContain('TodoWrite');
      });

      it('should use TodoWrite when context.isClaudeCode is true (claude-code host)', async () => {
        // Ticket #81861 / ADR-113 follow-up: claude-code CLI agents have TodoWrite,
        // not manage_plan (which is bridged back to plan messages in AgentJobService).
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true } },
          { isClaudeCode: true },
          'account'
        );

        expect(result).toContain('## Planning');
        expect(result).toContain('`TodoWrite` tool');
        expect(result).not.toContain('manage_plan');
      });

      it('should keep manage_plan when context.isClaudeCode is falsy (native loop default)', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true } },
          { isClaudeCode: false },
          'account'
        );

        expect(result).toContain('`manage_plan` tool');
        expect(result).not.toContain('TodoWrite');
      });

      it('should use custom auto_plan_threshold when provided', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true, auto_plan_threshold: 5 } },
          {},
          'account'
        );

        expect(result).toContain('5 or more steps');
        expect(result).toContain('fewer than 5 steps');
        expect(result).not.toContain('3 or more steps');
      });

      it('should fall back to default threshold of 3 for invalid auto_plan_threshold', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true, auto_plan_threshold: -1 } },
          {},
          'account'
        );

        expect(result).toContain('3 or more steps');
      });

      it('should NOT inject planning instructions when planning.enabled is false', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: false } },
          {},
          'account'
        );

        expect(result).not.toContain('## Planning');
        expect(result).not.toContain('manage_plan');
      });

      it('should NOT inject planning instructions when planning config is absent', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test' },
          {},
          'account'
        );

        expect(result).not.toContain('## Planning');
      });

      it('should inject plan context when plan exists and inject_in_context is not false', async () => {
        const planContent = JSON.stringify({
          tasks: [
            { id: 1, title: 'Step 1', status: 'completed', note: 'done' },
            { id: 2, title: 'Step 2', status: 'in_progress' },
          ],
        });

        dbGet.mockResolvedValueOnce({ content: planContent, updated_at: '2026-03-05' });

        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true, inject_in_context: true } },
          { conversationId: 42 },
          'account'
        );

        expect(result).toContain('## Current Plan (1/2 complete)');
        expect(result).toContain('[x] 1. Step 1 (done)');
        expect(result).toContain('[→] 2. Step 2');
      });

      it('should NOT inject plan context when inject_in_context is false', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true, inject_in_context: false } },
          { conversationId: 42 },
          'account'
        );

        expect(result).not.toContain('## Current Plan');
        // dbGet should not have been called for plan
        expect(dbGet).not.toHaveBeenCalled();
      });

      it('should NOT inject plan context when no conversationId', async () => {
        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true } },
          {},
          'account'
        );

        expect(result).not.toContain('## Current Plan');
      });

      it('should handle missing plan gracefully (no plan message in conversation)', async () => {
        dbGet.mockResolvedValueOnce(null);

        const result = await buildAgentSystemPrompt(
          { main_instructions: 'Test', planning: { enabled: true } },
          { conversationId: 42 },
          'account'
        );

        expect(result).toContain('## Planning');
        expect(result).not.toContain('## Current Plan');
      });
    });
  });

  // ─── ADR-113: handleManagePlan (shared handler) ──────────────

  describe('ADR-113: handleManagePlan()', () => {

    beforeEach(() => {
      vi.clearAllMocks();
    });

    // ── Validation ──────────────────────────────────────────────

    describe('validation', () => {

      it('should reject when tasks is not an array', async () => {
        const result = await handleManagePlan({ tasks: 'not-array' }, 42, 'TestAgent');
        expect(result).toEqual({ error: 'tasks must be a non-empty array' });
      });

      it('should reject when tasks is an empty array', async () => {
        const result = await handleManagePlan({ tasks: [] }, 42, 'TestAgent');
        expect(result).toEqual({ error: 'tasks must be a non-empty array' });
      });

      it('should reject when tasks is missing', async () => {
        const result = await handleManagePlan({}, 42, 'TestAgent');
        expect(result).toEqual({ error: 'tasks must be a non-empty array' });
      });

      it('should reject when tasks exceeds 20 items', async () => {
        const tasks = Array.from({ length: 21 }, (_, i) => ({
          id: i + 1, title: `Task ${i + 1}`, status: 'pending',
        }));
        const result = await handleManagePlan({ tasks }, 42, 'TestAgent');
        expect(result).toEqual({ error: 'Maximum 20 tasks allowed in a plan' });
      });

      it('should reject when task id is not a number', async () => {
        const result = await handleManagePlan({
          tasks: [{ id: 'abc', title: 'Test', status: 'pending' }],
        }, 42, 'TestAgent');
        expect(result.error).toContain('Task id must be a number');
      });

      it('should reject when task title is missing', async () => {
        const result = await handleManagePlan({
          tasks: [{ id: 1, title: '', status: 'pending' }],
        }, 42, 'TestAgent');
        expect(result.error).toContain('Task title must be a non-empty string');
      });

      it('should reject when task status is invalid', async () => {
        const result = await handleManagePlan({
          tasks: [{ id: 1, title: 'Test', status: 'invalid_status' }],
        }, 42, 'TestAgent');
        expect(result.error).toContain('Invalid status "invalid_status"');
        expect(result.error).toContain('pending');
        expect(result.error).toContain('in_progress');
        expect(result.error).toContain('completed');
        expect(result.error).toContain('blocked');
      });
    });

    // ── DB persistence (with conversationId) ────────────────────

    describe('persistence with conversationId', () => {

      it('should create a new plan message when none exists', async () => {
        dbGet.mockResolvedValueOnce(null); // no existing plan
        dbRun.mockResolvedValueOnce({ lastInsertRowid: 100 }); // INSERT
        dbRun.mockResolvedValueOnce({}); // conversation updated_at

        const result = await handleManagePlan({
          tasks: [
            { id: 1, title: 'Step 1', status: 'completed' },
            { id: 2, title: 'Step 2', status: 'in_progress' },
            { id: 3, title: 'Step 3', status: 'pending' },
          ],
        }, 42, 'TestAgent');

        // Verify plan was inserted
        expect(dbRun).toHaveBeenCalled();
        const insertCall = dbRun.mock.calls[0];
        expect(insertCall[0]).toContain('INSERT INTO messages');
        expect(insertCall[0]).toContain('content_type');

        // Verify content includes sanitized tasks
        const contentArg = insertCall[1].find(arg =>
          typeof arg === 'string' && arg.includes('"tasks"')
        );
        expect(contentArg).toBeDefined();
        const parsed = JSON.parse(contentArg);
        expect(parsed.tasks).toHaveLength(3);
        expect(parsed.tasks[0].title).toBe('Step 1');

        // Verify result string includes progress
        expect(result).toContain('1/3 completed');
        expect(result).toContain('1 in progress');
        expect(result).toContain('1 pending');
      });

      it('should update existing plan message in-place', async () => {
        dbGet.mockResolvedValueOnce({ id: 77 }); // existing plan
        dbRun.mockResolvedValueOnce({}); // UPDATE

        const result = await handleManagePlan({
          tasks: [
            { id: 1, title: 'Step 1', status: 'completed' },
            { id: 2, title: 'Step 2', status: 'completed' },
          ],
        }, 42, 'TestAgent');

        // Verify existing plan was updated in-place
        expect(dbRun).toHaveBeenCalledTimes(1);
        const updateCall = dbRun.mock.calls[0];
        expect(updateCall[0]).toContain('UPDATE messages');
        expect(updateCall[1]).toContain(77); // existing plan id

        // Verify result string
        expect(result).toContain('2/2 completed');
      });

      it('should trim task titles and include optional note', async () => {
        dbGet.mockResolvedValueOnce(null); // no existing plan
        dbRun.mockResolvedValueOnce({ lastInsertRowid: 100 });
        dbRun.mockResolvedValueOnce({});

        await handleManagePlan({
          tasks: [
            { id: 1, title: '  Spaced Title  ', status: 'blocked', note: 'waiting for review' },
          ],
        }, 42, 'TestAgent');

        const insertCall = dbRun.mock.calls[0];
        const contentArg = insertCall[1].find(arg =>
          typeof arg === 'string' && arg.includes('"tasks"')
        );
        const parsed = JSON.parse(contentArg);
        expect(parsed.tasks[0].title).toBe('Spaced Title');
        expect(parsed.tasks[0].note).toBe('waiting for review');
      });

      it('should include agent name in metadata', async () => {
        dbGet.mockResolvedValueOnce(null);
        dbRun.mockResolvedValueOnce({ lastInsertRowid: 100 });
        dbRun.mockResolvedValueOnce({});

        await handleManagePlan({
          tasks: [{ id: 1, title: 'Test', status: 'pending' }],
        }, 42, 'MyAgent');

        const insertCall = dbRun.mock.calls[0];
        const metadataArg = insertCall[1].find(arg =>
          typeof arg === 'string' && arg.includes('"agent"')
        );
        const parsed = JSON.parse(metadataArg);
        expect(parsed.agent).toBe('MyAgent');
        expect(parsed.tool).toBe('manage_plan');
        expect(parsed.version).toBe(1);
      });
    });

    // ── Validation-only mode (no conversationId) ────────────────

    describe('validation-only mode (no conversationId)', () => {

      it('should validate and return result without DB persistence', async () => {
        const result = await handleManagePlan({
          tasks: [
            { id: 1, title: 'Step 1', status: 'completed' },
            { id: 2, title: 'Step 2', status: 'pending' },
          ],
        }, null, 'TestAgent');

        // Should NOT call DB
        expect(dbGet).not.toHaveBeenCalled();
        expect(dbRun).not.toHaveBeenCalled();

        // Should still return valid progress
        expect(result).toContain('1/2 completed');
        expect(result).toContain('1 pending');
      });
    });

    // ── Progress summary format ─────────────────────────────────

    describe('progress summary', () => {

      it('should include all status counts in summary', async () => {
        dbGet.mockResolvedValueOnce(null);
        dbRun.mockResolvedValueOnce({ lastInsertRowid: 100 });
        dbRun.mockResolvedValueOnce({});

        const result = await handleManagePlan({
          tasks: [
            { id: 1, title: 'T1', status: 'completed' },
            { id: 2, title: 'T2', status: 'completed' },
            { id: 3, title: 'T3', status: 'in_progress' },
            { id: 4, title: 'T4', status: 'pending' },
            { id: 5, title: 'T5', status: 'blocked' },
          ],
        }, 42, 'TestAgent');

        expect(result).toContain('Plan updated:');
        expect(result).toContain('2/5 completed');
        expect(result).toContain('1 in progress');
        expect(result).toContain('1 pending');
        expect(result).toContain('1 blocked');
      });

      it('should handle all tasks completed', async () => {
        dbGet.mockResolvedValueOnce(null);
        dbRun.mockResolvedValueOnce({ lastInsertRowid: 100 });
        dbRun.mockResolvedValueOnce({});

        const result = await handleManagePlan({
          tasks: [
            { id: 1, title: 'T1', status: 'completed' },
            { id: 2, title: 'T2', status: 'completed' },
          ],
        }, 42, 'TestAgent');

        expect(result).toContain('2/2 completed');
      });
    });

    // ── Error handling ──────────────────────────────────────────

    describe('error handling', () => {

      it('should handle null args gracefully', async () => {
        const result = await handleManagePlan(null, 42, 'TestAgent');
        expect(result).toEqual({ error: 'tasks must be a non-empty array' });
      });

      it('should handle undefined args gracefully', async () => {
        const result = await handleManagePlan(undefined, 42, 'TestAgent');
        expect(result).toEqual({ error: 'tasks must be a non-empty array' });
      });
    });
  });

  // ─── ADR-077 Task 5: Ticket Context & Handoff Protocol ──────

  describe('ADR-077 Task 5: isTicketsTable()', () => {

    it('should return isTicket=true for Space 11 Tickets table (1708)', () => {
      const result = isTicketsTable(1708);
      expect(result.isTicket).toBe(true);
      expect(result.spaceId).toBe(11);
      expect(result.config).toBeDefined();
      expect(result.config.TICKETS_TABLE_ID).toBe(1708);
    });

    it('should return isTicket=true for Space 36 Tickets table (3207)', () => {
      const result = isTicketsTable(3207);
      expect(result.isTicket).toBe(true);
      expect(result.spaceId).toBe(36);
    });

    it('should return isTicket=false for non-ticket table', () => {
      const result = isTicketsTable(9999);
      expect(result.isTicket).toBe(false);
      expect(result.spaceId).toBeNull();
      expect(result.config).toBeNull();
    });

    it('should return isTicket=false for null/undefined', () => {
      expect(isTicketsTable(null).isTicket).toBe(false);
      expect(isTicketsTable(undefined).isTicket).toBe(false);
      expect(isTicketsTable(0).isTicket).toBe(false);
    });

    it('should handle string table_id by converting to number', () => {
      // table_id might come as string from DB
      const result = isTicketsTable(1708);
      expect(result.isTicket).toBe(true);
    });
  });

  describe('ADR-077 Task 5: buildTicketContext()', () => {

    const mockConfig = {
      TICKETS_TABLE_ID: 1708,
      STATE: { BACKLOG: 24275, IN_PROGRESS: 24276, DONE: 24278 },
    };

    it('should build rich ticket context with all fields', () => {
      const boundRow = {
        table_id: 1708,
        row_id: 12345,
        table_name: 'Tickets',
        data: {
          what: 'Implement feature X',
          why: 'Users need feature X for productivity',
          type: 'Backend',
          priority: 'High',
          state: 'Backlog',
          assigned_to: 'Developer Ralph',
          adr_ref: 'ADR-077',
          chain_id: 'chain-abc-123',
          acceptance_criteria: '- [ ] AC1: Thing works\n- [ ] AC2: Tests pass',
        },
      };

      const result = buildTicketContext(boundRow, mockConfig);

      expect(result).toContain('## Linked Ticket (table_id: 1708, row_id: 12345)');
      expect(result).toContain('**Title**: Implement feature X');
      expect(result).toContain('**Why**: Users need feature X');
      expect(result).toContain('**Type**: Backend');
      expect(result).toContain('**Priority**: High');
      expect(result).toContain('**State**: Backlog');
      expect(result).toContain('**Assigned to**: Developer Ralph');
      expect(result).toContain('**ADR Reference**: ADR-077');
      expect(result).toContain('**Chain ID**: chain-abc-123');
      expect(result).toContain('**Acceptance Criteria**:');
      expect(result).toContain('- [ ] AC1: Thing works');
    });

    it('should handle minimal ticket data (only what)', () => {
      const boundRow = {
        table_id: 1708,
        row_id: 99,
        table_name: 'Tickets',
        data: { what: 'Simple task' },
      };

      const result = buildTicketContext(boundRow, mockConfig);

      expect(result).toContain('## Linked Ticket');
      expect(result).toContain('**Title**: Simple task');
      expect(result).not.toContain('**Why**');
      expect(result).not.toContain('**Acceptance Criteria**');
    });

    it('should return empty string for null/undefined data', () => {
      expect(buildTicketContext(null, mockConfig)).toBe('');
      expect(buildTicketContext({ data: null }, mockConfig)).toBe('');
      expect(buildTicketContext(undefined, mockConfig)).toBe('');
    });

    it('should include test_steps when present', () => {
      const boundRow = {
        table_id: 1708,
        row_id: 100,
        table_name: 'Tickets',
        data: {
          what: 'Test task',
          test_steps: '1. Run npm test\n2. Check coverage',
        },
      };

      const result = buildTicketContext(boundRow, mockConfig);
      expect(result).toContain('**Test Steps**:');
      expect(result).toContain('1. Run npm test');
    });

    it('should include date fields when present', () => {
      const boundRow = {
        table_id: 1708,
        row_id: 101,
        table_name: 'Tickets',
        data: {
          what: 'Date task',
          due_date: '2026-04-01',
          scheduled_date: '2026-03-15',
        },
      };

      const result = buildTicketContext(boundRow, mockConfig);
      expect(result).toContain('**Due date**: 2026-04-01');
      expect(result).toContain('**Scheduled date**: 2026-03-15');
    });
  });

  describe('ADR-077 Task 5: buildHandoffProtocol()', () => {

    const mockConfig = {
      STATE: {
        BACKLOG: 24275,
        IN_PROGRESS: 24276,
        REVIEW: 24277,
        DONE: 24278,
      },
    };

    it('should return handoff protocol with state transitions', () => {
      const result = buildHandoffProtocol(mockConfig);

      expect(result).toContain('## Handoff Protocol');
      expect(result).toContain('backlog(24275)');
      expect(result).toContain('in_progress(24276)');
      expect(result).toContain('review(24277)');
      expect(result).toContain('done(24278)');
    });

    it('should include agent delegation instructions using <<@slug>> invocation syntax', () => {
      const result = buildHandoffProtocol(mockConfig);

      // ADR-116: delegation uses <<@slug>> invocation tokens, not plain @slug references
      expect(result).toContain('<<@orchestrator>>');
      expect(result).toContain('<<@architect>>');
      expect(result).toContain('<<@developer-ralph>>');
      expect(result).toContain('<<@frontend>>');
      // Should explain the plain @slug vs <<@slug>> distinction
      expect(result).toContain('plain `@slug`');
    });

    it('should include state update instructions', () => {
      const result = buildHandoffProtocol(mockConfig);

      expect(result).toContain('update_row');
      expect(result).toContain('Pick up');
      expect(result).toContain('Submit');
      expect(result).toContain('Delegate');
    });

    it('should include chain context guidance', () => {
      const result = buildHandoffProtocol(mockConfig);
      expect(result).toContain('Chain context');
    });
  });

  describe('ADR-116: buildDelegationInstructions()', () => {

    it('should include the invocation section header', () => {
      const result = buildDelegationInstructions();
      expect(result).toContain('## Agent Invocation & Reference Syntax');
    });

    it('should document <<@slug>> as invocation trigger', () => {
      const result = buildDelegationInstructions();
      expect(result).toContain('<<@slug>>');
      expect(result).toContain('INVOKE');
    });

    it('should document <</slug>> as slash invocation trigger', () => {
      const result = buildDelegationInstructions();
      expect(result).toContain('<</slug>>');
    });

    it('should document plain @slug as reference (no trigger)', () => {
      const result = buildDelegationInstructions();
      expect(result).toContain('@slug');
      expect(result).toContain('REFERENCE');
    });

    it('should document plain /slug as reference (no trigger)', () => {
      const result = buildDelegationInstructions();
      expect(result).toContain('/slug');
    });

    it('should state the rule about when to use each form', () => {
      const result = buildDelegationInstructions();
      expect(result).toContain('Rule');
    });
  });

  describe('ADR-077 Task 5: buildAgentSystemPrompt() with ticket context', () => {

    it('should inject ticket context when bound row is a Tickets table row', async () => {
      const agentConfig = {
        main_instructions: 'You are a helpful developer agent.',
      };
      const context = {
        spaceId: 11,
        conversationId: 42,
        boundRow: {
          table_id: 1708,
          row_id: 12345,
          table_name: 'Tickets',
          data: {
            what: 'Build the widget',
            why: 'User needs widgets',
            state: 'Backlog',
            assigned_to: 'Developer Ralph',
            acceptance_criteria: '- [ ] Widget renders\n- [ ] Tests pass',
          },
        },
        agentMode: 'agent',
      };

      const result = await buildAgentSystemPrompt(agentConfig, context, 'account');

      // Should have ticket context
      expect(result).toContain('## Linked Ticket');
      expect(result).toContain('**Title**: Build the widget');
      expect(result).toContain('**Acceptance Criteria**');
      expect(result).toContain('- [ ] Widget renders');

      // Should have handoff protocol (because agentMode = 'agent')
      expect(result).toContain('## Handoff Protocol');
      expect(result).toContain('@developer-ralph');
    });

    it('should inject ticket context but NOT handoff protocol in non-agent mode', async () => {
      const agentConfig = {
        main_instructions: 'You are an assistant.',
      };
      const context = {
        spaceId: 11,
        conversationId: 42,
        boundRow: {
          table_id: 1708,
          row_id: 12345,
          table_name: 'Tickets',
          data: {
            what: 'Build feature',
            state: 'Backlog',
          },
        },
        agentMode: 'ask',
      };

      const result = await buildAgentSystemPrompt(agentConfig, context, 'account');

      // Ticket context should still be there
      expect(result).toContain('## Linked Ticket');
      expect(result).toContain('**Title**: Build feature');

      // But NO handoff protocol
      expect(result).not.toContain('## Handoff Protocol');
    });

    it('should fall back to generic bound row context for non-ticket tables', async () => {
      const agentConfig = {
        main_instructions: 'You are an assistant.',
      };
      const context = {
        spaceId: 11,
        conversationId: 42,
        boundRow: {
          table_id: 9999,
          row_id: 100,
          table_name: 'Documents',
          data: { title: 'Some doc' },
        },
        agentMode: 'agent',
      };

      const result = await buildAgentSystemPrompt(agentConfig, context, 'account');

      // Should NOT have ticket context
      expect(result).not.toContain('## Linked Ticket');
      expect(result).not.toContain('## Handoff Protocol');

      // Should have generic bound row reference
      expect(result).toContain('Linked row: table "Documents" (table_id: 9999, row_id: 100)');
    });

    it('should fall back to JSON bound row context for non-ticket tables in ask mode', async () => {
      const agentConfig = {
        main_instructions: 'You are an assistant.',
      };
      const context = {
        spaceId: 11,
        conversationId: 42,
        boundRow: {
          table_id: 9999,
          row_id: 100,
          table_name: 'Documents',
          data: { title: 'Some doc' },
        },
        agentMode: 'ask',
      };

      const result = await buildAgentSystemPrompt(agentConfig, context, 'account');

      // Should have JSON context
      expect(result).toContain('--- Linked Row ---');
      expect(result).toContain('"title": "Some doc"');
    });
  });
});
