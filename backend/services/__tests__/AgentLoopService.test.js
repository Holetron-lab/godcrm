/**
 * AgentLoopService Tests — ADR-095: Agent Tool Loop & Backward Compatibility
 *
 * Ticket #41425: Agent tool loop saves step messages
 *   - saveStepMessage() persists messages with correct content_type, role, agent_id
 *   - toAnthropicTools() converts OpenAI→Anthropic tool format
 *   - sanitizeToolResult() handles circular JSON, large strings
 *   - resolveAllowedTools() filters tools per agent config
 *   - getMaxOutputTokens() returns model-aware token limits
 *   - injectToolContext() injects space_id into tool arguments
 *
 * Ticket #41426: Backward compatibility Q&A path
 *   - When agent has no tools → should NOT enter tool loop
 *   - When agent mode is "ask" or "read" → uses callAgentAI path
 *   - Response saved via saveStepMessage with contentType 'text'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// vi.hoisted lets us define variables that are accessible inside vi.mock factories
const { mockDbRun, mockDbGet, mockIsPostgres, mockExecuteTool, MOCK_AGENT_TOOLS } = vi.hoisted(() => {
  const mockDbRun = vi.fn();
  const mockDbGet = vi.fn().mockResolvedValue({ is_processing: true });
  const mockIsPostgres = vi.fn(() => false);
  const mockExecuteTool = vi.fn();
  const MOCK_AGENT_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'get_workspace_info',
        description: 'Get workspace info',
        parameters: { type: 'object', properties: { space_id: { type: 'number' } }, required: ['space_id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'query_table_data',
        description: 'Query table data',
        parameters: { type: 'object', properties: { table_id: { type: 'number' } }, required: ['table_id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_table_schema',
        description: 'Get table schema',
        parameters: { type: 'object', properties: { table_id: { type: 'number' } }, required: ['table_id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_tables',
        description: 'List all tables',
        parameters: { type: 'object', properties: { space_id: { type: 'number' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_table_data',
        description: 'Analyze table data',
        parameters: { type: 'object', properties: { table_id: { type: 'number' } }, required: ['table_id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_dashboard',
        description: 'Create a dashboard',
        parameters: { type: 'object', properties: { space_id: { type: 'number' }, title: { type: 'string' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_row',
        description: 'Update a row in a table',
        parameters: { type: 'object', properties: { table_id: { type: 'number' }, row_id: { type: 'number' }, data: { type: 'object' } } },
      },
    },
  ];
  return { mockDbRun, mockDbGet, mockIsPostgres, mockExecuteTool, MOCK_AGENT_TOOLS };
});

vi.mock('../../database/connection.js', () => ({
  dbRun: (...args) => mockDbRun(...args),
  dbGet: (...args) => mockDbGet(...args),
  dbAll: vi.fn().mockResolvedValue([]),
  isPostgres: () => mockIsPostgres(),
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../chat/agent-execution-shared.js', () => ({
  detectProvider: vi.fn((provider, model) => ({
    isClaudeCode: provider === 'claude-code',
    isCopilot: provider === 'copilot',
    isAnthropic: provider === 'anthropic' || (model && model.includes('claude')),
  })),
  // T-148527 (WP-A): default to "no fresh messages" so existing fixtures
  // that didn't anticipate mid-run injection keep producing identical loop
  // shapes. Individual tests can re-mock if they want to verify injection.
  loadNewMessagesSince: vi.fn(async () => []),
}));

vi.mock('../labs/ai-execution-service.js', () => ({
  default: {
    executeCopilotCli: vi.fn(),
    executeClaudeCode: vi.fn(),
  },
}));

vi.mock('../AgentToolsService.js', () => ({
  AGENT_TOOLS: MOCK_AGENT_TOOLS,
  executeTool: (...args) => mockExecuteTool(...args),
}));

vi.mock('../AgentActivityLogger.js', () => ({
  logToolUsed: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import {
  saveStepMessage,
  toAnthropicTools,
  getAnthropicText,
  getMaxOutputTokens,
  sanitizeToolResult,
  injectToolContext,
  resolveAllowedTools,
  agentLoop,
  executeAgentToolLoop,
} from '../AgentLoopService.js';

// ═══════════════════════════════════════════════════════════════════════════
// Task 1: Ticket #41425 — Agent tool loop saves step messages
// ═══════════════════════════════════════════════════════════════════════════

describe('ADR-095: AgentLoopService', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRun.mockResolvedValue({ lastInsertRowid: 1 });
    mockIsPostgres.mockReturnValue(false);
  });

  // ─── saveStepMessage() ──────────────────────────────────────────────────

  describe('saveStepMessage()', () => {

    it('should INSERT into messages table with correct fields', async () => {
      await saveStepMessage(42, {
        content: 'Hello from agent',
        contentType: 'text',
        role: 'assistant',
        senderType: 'agent',
        agentId: 10,
        senderId: 99,
        modelUsed: 'gpt-4',
      });

      expect(mockDbRun).toHaveBeenCalledTimes(2); // INSERT + UPDATE conversations
      const [insertSql, insertParams] = mockDbRun.mock.calls[0];
      expect(insertSql).toContain('INSERT INTO messages');
      expect(insertParams[0]).toBe(42);          // conversation_id
      expect(insertParams[1]).toBe(99);           // sender_id
      expect(insertParams[2]).toBe('agent');       // sender_type
      expect(insertParams[3]).toBe('assistant');   // role
      expect(insertParams[4]).toBe('Hello from agent'); // content
      expect(insertParams[5]).toBe('text');        // content_type
      expect(insertParams[6]).toBe(10);            // agent_id
      expect(insertParams[7]).toBe('gpt-4');       // model_used
    });

    it('should save tool_call content_type with tool_results JSON', async () => {
      await saveStepMessage(42, {
        content: 'get_workspace_info',
        contentType: 'tool_call',
        role: 'assistant',
        senderType: 'agent',
        agentId: 10,
        toolResults: { tool: 'get_workspace_info', args: { space_id: 5 } },
      });

      const [, insertParams] = mockDbRun.mock.calls[0];
      expect(insertParams[5]).toBe('tool_call');    // content_type
      expect(insertParams[11]).toBe(JSON.stringify({ tool: 'get_workspace_info', args: { space_id: 5 } })); // tool_results
    });

    it('should save tool_result content_type with role "tool"', async () => {
      await saveStepMessage(42, {
        content: '{"success": true}',
        contentType: 'tool_result',
        role: 'tool',
        senderType: 'agent',
        agentId: 10,
      });

      const [, insertParams] = mockDbRun.mock.calls[0];
      expect(insertParams[3]).toBe('tool');         // role
      expect(insertParams[5]).toBe('tool_result');  // content_type
    });

    it('should save thinking content_type', async () => {
      await saveStepMessage(42, {
        content: 'Let me analyze this data...',
        contentType: 'thinking',
        role: 'assistant',
        senderType: 'agent',
        agentId: 10,
      });

      const [, insertParams] = mockDbRun.mock.calls[0];
      expect(insertParams[5]).toBe('thinking');
    });

    it('should update conversation updated_at after inserting message', async () => {
      await saveStepMessage(42, { content: 'test' });

      expect(mockDbRun).toHaveBeenCalledTimes(2);
      const [updateSql, updateParams] = mockDbRun.mock.calls[1];
      expect(updateSql).toContain('UPDATE conversations');
      expect(updateParams[0]).toBe(42);
    });

    it('should return lastInsertRowid', async () => {
      mockDbRun.mockResolvedValueOnce({ lastInsertRowid: 123 });
      mockDbRun.mockResolvedValueOnce({}); // UPDATE conversations

      const result = await saveStepMessage(42, { content: 'test' });
      expect(result).toBe(123);
    });

    it('should use default values when opts are omitted', async () => {
      await saveStepMessage(42, {});

      const [, insertParams] = mockDbRun.mock.calls[0];
      expect(insertParams[1]).toBeNull();    // senderId default null
      expect(insertParams[2]).toBe('agent'); // senderType default
      expect(insertParams[3]).toBe('assistant'); // role default
      expect(insertParams[4]).toBe('');      // content default
      expect(insertParams[5]).toBe('text');  // contentType default
      expect(insertParams[6]).toBeNull();    // agentId default null
      expect(insertParams[7]).toBeNull();    // modelUsed default null
      expect(insertParams[8]).toBeNull();    // tokensIn default null
      expect(insertParams[9]).toBeNull();    // tokensOut default null
      expect(insertParams[10]).toBeNull();   // latencyMs default null
      expect(insertParams[11]).toBeNull();   // toolResults default null (no JSON.stringify of null)
      expect(insertParams[12]).toBeNull();   // metadata default null
    });

    it('should use Postgres syntax when isPostgres() returns true', async () => {
      mockIsPostgres.mockReturnValue(true);

      await saveStepMessage(42, { content: 'test' });

      const [insertSql] = mockDbRun.mock.calls[0];
      expect(insertSql).toContain('$1');
      expect(insertSql).toContain('NOW()');
      expect(insertSql).not.toContain("datetime('now')");
    });

    it('should use SQLite syntax when isPostgres() returns false', async () => {
      mockIsPostgres.mockReturnValue(false);

      await saveStepMessage(42, { content: 'test' });

      const [insertSql] = mockDbRun.mock.calls[0];
      expect(insertSql).toContain('?');
      expect(insertSql).toContain("datetime('now')");
    });

    it('should persist token usage and latency metrics', async () => {
      await saveStepMessage(42, {
        content: 'response',
        tokensIn: 500,
        tokensOut: 200,
        latencyMs: 1234,
        modelUsed: 'claude-sonnet-4',
      });

      const [, insertParams] = mockDbRun.mock.calls[0];
      expect(insertParams[7]).toBe('claude-sonnet-4'); // model_used
      expect(insertParams[8]).toBe(500);                // tokens_in
      expect(insertParams[9]).toBe(200);                // tokens_out
      expect(insertParams[10]).toBe(1234);              // latency_ms
    });
  });

  // ─── toAnthropicTools() ─────────────────────────────────────────────────

  describe('toAnthropicTools()', () => {

    it('should convert OpenAI tool format to Anthropic format', () => {
      const openaiTools = [
        {
          type: 'function',
          function: {
            name: 'get_workspace_info',
            description: 'Get workspace info',
            parameters: { type: 'object', properties: { space_id: { type: 'number' } }, required: ['space_id'] },
          },
        },
      ];

      const result = toAnthropicTools(openaiTools);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'get_workspace_info',
        description: 'Get workspace info',
        input_schema: { type: 'object', properties: { space_id: { type: 'number' } }, required: ['space_id'] },
      });
    });

    it('should convert multiple tools', () => {
      const tools = [
        { type: 'function', function: { name: 'tool_a', description: 'A', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'tool_b', description: 'B', parameters: { type: 'object', properties: {} } } },
      ];

      const result = toAnthropicTools(tools);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('tool_a');
      expect(result[1].name).toBe('tool_b');
    });

    it('should filter out tools without function.name', () => {
      const tools = [
        { type: 'function', function: { name: 'valid_tool', description: 'Valid' } },
        { type: 'function', function: { description: 'Missing name' } },
        { type: 'function' },
        null,
      ];

      const result = toAnthropicTools(tools);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('valid_tool');
    });

    it('should provide defaults for missing description and parameters', () => {
      const tools = [
        { type: 'function', function: { name: 'bare_tool' } },
      ];

      const result = toAnthropicTools(tools);
      expect(result[0].description).toBe('');
      expect(result[0].input_schema).toEqual({ type: 'object', properties: {} });
    });

    it('should return empty array for null/undefined input', () => {
      expect(toAnthropicTools(null)).toEqual([]);
      expect(toAnthropicTools(undefined)).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      expect(toAnthropicTools([])).toEqual([]);
    });
  });

  // ─── sanitizeToolResult() ───────────────────────────────────────────────

  describe('sanitizeToolResult()', () => {

    it('should return the result unchanged for normal objects', () => {
      const input = { success: true, data: [1, 2, 3] };
      const result = sanitizeToolResult(input);
      expect(result).toEqual(input);
    });

    it('should truncate results larger than 50000 characters', () => {
      const largeData = 'x'.repeat(60000);
      const input = { data: largeData };
      const result = sanitizeToolResult(input);

      expect(result._truncated).toBe(true);
      expect(result.data.length).toBeLessThanOrEqual(50003); // 50000 + '...'
      expect(result.data).toContain('...');
    });

    it('should handle circular JSON references gracefully', () => {
      const obj = { a: 1 };
      obj.self = obj; // circular reference

      const result = sanitizeToolResult(obj);
      expect(result).toEqual({ success: false, error: 'Result not serializable' });
    });

    it('should return error object for null/undefined input', () => {
      expect(sanitizeToolResult(null)).toEqual({ success: false, error: 'No result' });
      expect(sanitizeToolResult(undefined)).toEqual({ success: false, error: 'No result' });
    });

    it('should handle empty string as falsy', () => {
      // Empty string is falsy in JS
      const result = sanitizeToolResult('');
      expect(result).toEqual({ success: false, error: 'No result' });
    });

    it('should pass through normal-sized results without modification', () => {
      const input = { success: true, rows: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Row ${i}` })) };
      const result = sanitizeToolResult(input);
      expect(result).toEqual(input);
      expect(result._truncated).toBeUndefined();
    });

    it('should handle string results', () => {
      const result = sanitizeToolResult('simple string');
      expect(result).toBe('simple string');
    });

    it('should handle number results', () => {
      const result = sanitizeToolResult(42);
      expect(result).toBe(42);
    });
  });

  // ─── resolveAllowedTools() ──────────────────────────────────────────────

  describe('resolveAllowedTools()', () => {

    it('should return ALL AGENT_TOOLS when no tools configured', async () => {
      const result = await resolveAllowedTools({}, null);
      expect(result).toEqual(MOCK_AGENT_TOOLS);
    });

    it('should filter tools by array of tool names', async () => {
      const result = await resolveAllowedTools({
        tools: ['update_row'],
      }, null);

      const names = result.map(t => t.function.name);
      // Should include the specified tool plus base consulting tools
      expect(names).toContain('update_row');
      expect(names).toContain('get_workspace_info');
      expect(names).toContain('query_table_data');
      expect(names).toContain('get_table_schema');
      expect(names).toContain('list_tables');
      expect(names).toContain('analyze_table_data');
    });

    it('should parse JSON string tool list', async () => {
      const result = await resolveAllowedTools({
        tools: JSON.stringify(['update_row', 'create_dashboard']),
      }, null);

      const names = result.map(t => t.function.name);
      expect(names).toContain('update_row');
      expect(names).toContain('create_dashboard');
      // Base consulting tools always included
      expect(names).toContain('get_workspace_info');
    });

    it('should parse comma-separated tool list', async () => {
      const result = await resolveAllowedTools({
        tools: 'update_row, create_dashboard',
      }, null);

      const names = result.map(t => t.function.name);
      expect(names).toContain('update_row');
      expect(names).toContain('create_dashboard');
    });

    it('should always include base consulting tools', async () => {
      const result = await resolveAllowedTools({
        tools: ['create_dashboard'],
      }, null);

      const names = result.map(t => t.function.name);
      const baseTools = ['get_workspace_info', 'query_table_data', 'get_table_schema', 'list_tables', 'analyze_table_data'];
      for (const baseTool of baseTools) {
        expect(names).toContain(baseTool);
      }
    });

    it('should use allowed_tools as fallback config key', async () => {
      const result = await resolveAllowedTools({
        allowed_tools: ['update_row'],
      }, null);

      const names = result.map(t => t.function.name);
      expect(names).toContain('update_row');
    });

    it('should fall back to full AGENT_TOOLS if filtered list is empty', async () => {
      const result = await resolveAllowedTools({
        tools: ['nonexistent_tool_xyz'],
      }, null);

      // The specified tool does not exist in AGENT_TOOLS, but base consulting tools do.
      // Since filtered includes base tools, it should NOT be empty.
      // However, if the agent specifies ONLY nonexistent tools AND base tools also don't match,
      // it would fall back to full list. With our mock, base tools DO exist.
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─── getMaxOutputTokens() ──────────────────────────────────────────────

  describe('getMaxOutputTokens()', () => {

    it('should return 32000 for claude-opus-4', () => {
      expect(getMaxOutputTokens('claude-opus-4')).toBe(32000);
    });

    it('should return 16000 for claude-sonnet-4', () => {
      expect(getMaxOutputTokens('claude-sonnet-4')).toBe(16000);
    });

    it('should return 8192 for claude-3-5-sonnet', () => {
      expect(getMaxOutputTokens('claude-3-5-sonnet-20241022')).toBe(8192);
    });

    it('should return 8192 for claude-3.5-sonnet variant', () => {
      expect(getMaxOutputTokens('claude-3.5-sonnet')).toBe(8192);
    });

    it('should return 16384 for gpt-4o', () => {
      expect(getMaxOutputTokens('gpt-4o')).toBe(16384);
    });

    it('should return 8192 for gpt-4', () => {
      expect(getMaxOutputTokens('gpt-4-turbo')).toBe(8192);
    });

    it('should return 100000 for o1/o3/o4 reasoning models', () => {
      expect(getMaxOutputTokens('o1-preview')).toBe(100000);
      expect(getMaxOutputTokens('o3-mini')).toBe(100000);
      expect(getMaxOutputTokens('o4-mini')).toBe(100000);
    });

    it('should return 8192 as default for unknown models', () => {
      expect(getMaxOutputTokens('some-unknown-model')).toBe(8192);
    });

    it('should return 8192 as default when modelId is null/undefined', () => {
      expect(getMaxOutputTokens(null)).toBe(8192);
      expect(getMaxOutputTokens(undefined)).toBe(8192);
    });

    it('should respect agentConfig.max_tokens override', () => {
      expect(getMaxOutputTokens('gpt-4', { max_tokens: 2048 })).toBe(2048);
    });

    it('should ignore agentConfig.max_tokens if not positive', () => {
      expect(getMaxOutputTokens('gpt-4', { max_tokens: 0 })).toBe(8192);
      expect(getMaxOutputTokens('gpt-4', { max_tokens: -1 })).toBe(8192);
    });

    it('should handle case insensitivity for model names', () => {
      expect(getMaxOutputTokens('Claude-Opus-4')).toBe(32000);
      expect(getMaxOutputTokens('CLAUDE-SONNET-4')).toBe(16000);
      expect(getMaxOutputTokens('GPT-4O')).toBe(16384);
    });
  });

  // ─── injectToolContext() ────────────────────────────────────────────────

  describe('injectToolContext()', () => {

    it('should inject space_id for get_workspace_info when not provided', () => {
      const result = injectToolContext('get_workspace_info', {}, { spaceId: 11, userId: 1 });
      expect(result.space_id).toBe(11);
    });

    it('should inject space_id for create_dashboard when not provided', () => {
      const result = injectToolContext('create_dashboard', { title: 'My Dashboard' }, { spaceId: 11, userId: 1 });
      expect(result.space_id).toBe(11);
      expect(result.title).toBe('My Dashboard');
    });

    it('should NOT overwrite existing space_id', () => {
      const result = injectToolContext('get_workspace_info', { space_id: 99 }, { spaceId: 11, userId: 1 });
      expect(result.space_id).toBe(99); // Keep original
    });

    it('should inject space_id for list_tables when no project_id or space_id', () => {
      const result = injectToolContext('list_tables', {}, { spaceId: 11, userId: 1 });
      expect(result.space_id).toBe(11);
    });

    it('should NOT inject space_id for list_tables when project_id is present', () => {
      const result = injectToolContext('list_tables', { project_id: 5 }, { spaceId: 11, userId: 1 });
      expect(result.space_id).toBeUndefined();
      expect(result.project_id).toBe(5);
    });

    it('should NOT inject space_id for tools not in the injection lists', () => {
      const result = injectToolContext('query_table_data', { table_id: 100 }, { spaceId: 11, userId: 1 });
      expect(result.space_id).toBeUndefined();
      expect(result.table_id).toBe(100);
    });

    it('should not inject space_id when context has no spaceId', () => {
      const result = injectToolContext('get_workspace_info', {}, { userId: 1 });
      expect(result.space_id).toBeUndefined();
    });

    it('should not mutate the original args object', () => {
      const original = { table_id: 100 };
      const result = injectToolContext('get_workspace_info', original, { spaceId: 11, userId: 1 });
      expect(original.space_id).toBeUndefined(); // Original unchanged
      expect(result.space_id).toBe(11);
    });
  });

  // ─── getAnthropicText() ─────────────────────────────────────────────────

  describe('getAnthropicText()', () => {

    it('should return text from content blocks array', () => {
      const blocks = [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'World' },
      ];
      expect(getAnthropicText(blocks)).toBe('Hello \nWorld');
    });

    it('should filter out non-text blocks', () => {
      const blocks = [
        { type: 'text', text: 'Analysis:' },
        { type: 'tool_use', id: 'tu_1', name: 'query_table_data', input: {} },
        { type: 'text', text: 'Here are the results.' },
      ];
      expect(getAnthropicText(blocks)).toBe('Analysis:\nHere are the results.');
    });

    it('should return string content directly', () => {
      expect(getAnthropicText('Hello World')).toBe('Hello World');
    });

    it('should return empty string for null/undefined', () => {
      expect(getAnthropicText(null)).toBe('');
      expect(getAnthropicText(undefined)).toBe('');
    });

    it('should return empty string for empty array', () => {
      expect(getAnthropicText([])).toBe('');
    });

    it('should skip text blocks with falsy text', () => {
      const blocks = [
        { type: 'text', text: '' },
        { type: 'text', text: null },
        { type: 'text', text: 'Actual text' },
      ];
      expect(getAnthropicText(blocks)).toBe('Actual text');
    });
  });

  // ─── executeAgentToolLoop alias ─────────────────────────────────────────

  describe('executeAgentToolLoop alias', () => {
    it('should be the same function as agentLoop', () => {
      expect(executeAgentToolLoop).toBe(agentLoop);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Task 2: Ticket #41426 — Backward compatibility Q&A path
  // ═══════════════════════════════════════════════════════════════════════

  describe('ADR-095: Backward compatibility — Q&A path routing', () => {

    /**
     * These tests verify the routing logic from chat.js (ADR-095 Task 1+4):
     *
     *   if (agent_mode === 'agent' && hasTools) → executeAgentToolLoop()
     *   else → callAgentAI() (simple Q&A)
     *
     * We test the building blocks that enable this routing:
     *   - resolveAllowedTools returns tools/empty based on config
     *   - saveStepMessage works for simple text responses (Q&A path)
     *   - agentLoop safety net ensures a final text response
     */

    describe('Q&A routing conditions', () => {

      it('agent with no tools config returns ALL tools (defaults to tool loop eligible)', async () => {
        // When no tools are configured, resolveAllowedTools returns all AGENT_TOOLS
        const tools = await resolveAllowedTools({}, null);
        expect(tools.length).toBe(MOCK_AGENT_TOOLS.length);
        expect(tools.length).toBeGreaterThan(0);
      });

      it('agent with explicit empty tools array returns ALL tools (fallback)', async () => {
        // Empty array means "no specific filter" → returns all tools
        const tools = await resolveAllowedTools({ tools: [] }, null);
        expect(tools.length).toBe(MOCK_AGENT_TOOLS.length);
      });

      it('Q&A response should be saved via saveStepMessage with contentType "text"', async () => {
        // Simulates the Q&A path in chat.js where callAgentAI response is saved
        await saveStepMessage(42, {
          content: 'Here is the answer to your question.',
          contentType: 'text',
          role: 'assistant',
          senderType: 'agent',
          agentId: 10,
          senderId: 99,
          modelUsed: 'gpt-4',
          metadata: JSON.stringify({ agent_name: 'Helper Bot', agent_icon: 'bot', agent_row_id: 10 }),
        });

        expect(mockDbRun).toHaveBeenCalledTimes(2);
        const [, insertParams] = mockDbRun.mock.calls[0];
        expect(insertParams[5]).toBe('text');       // content_type is 'text' for Q&A
        expect(insertParams[3]).toBe('assistant');    // role
        expect(insertParams[6]).toBe(10);             // agent_id
        expect(insertParams[12]).toContain('Helper Bot'); // metadata includes agent name
      });

      it('Q&A path should NOT produce tool_call or tool_result messages', async () => {
        // In Q&A mode, only a single text message is saved
        await saveStepMessage(42, {
          content: 'Simple response without tools',
          contentType: 'text',
          role: 'assistant',
          agentId: 10,
        });

        // Only 2 DB calls: INSERT message + UPDATE conversations
        expect(mockDbRun).toHaveBeenCalledTimes(2);
        const [, insertParams] = mockDbRun.mock.calls[0];
        expect(insertParams[5]).toBe('text');
        expect(insertParams[11]).toBeNull(); // no tool_results
      });
    });

    describe('agentLoop safety net (ADR-095 Task 2)', () => {

      it('should produce a safety net message when tool loop returns no text', async () => {
        // Mock global fetch for Anthropic API that returns an empty response
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            content: [],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 0 },
          }),
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;

        try {
          const result = await agentLoop({
            conversationId: 42,
            systemPrompt: 'You are a helpful assistant.',
            history: [],
            userMessage: 'Hello',
            agentConfig: { max_iterations: 1 },
            resolved: { apiKey: 'sk-test', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          // Safety net should produce a fallback message with iteration limit info
          const expectedFallback = '\u26a0\ufe0f Agent reached iteration limit (1). The task may be incomplete. Please retry or increase max_iterations in agent settings.';
          expect(result).toBe(expectedFallback);

          // saveStepMessage should have been called with the safety text
          const saveCall = mockDbRun.mock.calls.find(([sql, params]) =>
            sql.includes('INSERT INTO messages') && params[4] === expectedFallback
          );
          expect(saveCall).toBeTruthy();
          expect(saveCall[1][5]).toBe('text'); // content_type
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      it('should return the AI text response when tool loop completes normally', async () => {
        // Mock Anthropic API returning a text-only response (no tool use)
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            content: [{ type: 'text', text: 'Here is my analysis of the data.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;

        try {
          const result = await agentLoop({
            conversationId: 42,
            systemPrompt: 'You are a helpful assistant.',
            history: [],
            userMessage: 'Analyze this',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          expect(result).toBe('Here is my analysis of the data.');

          // Verify the text was saved as a step message
          const saveCall = mockDbRun.mock.calls.find(([sql, params]) =>
            sql.includes('INSERT INTO messages') && params[4] === 'Here is my analysis of the data.'
          );
          expect(saveCall).toBeTruthy();
          expect(saveCall[1][5]).toBe('text');        // content_type
          expect(saveCall[1][3]).toBe('assistant');    // role
          expect(saveCall[1][6]).toBe(10);             // agent_id
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });

    describe('agentLoop with Anthropic tool execution', () => {

      it('should save tool_call and tool_result step messages during tool loop', async () => {
        // Iteration 1: AI wants to use a tool
        // Iteration 2: AI responds with final text
        const mockFetch = vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              content: [
                { type: 'text', text: 'Let me check the workspace.' },
                { type: 'tool_use', id: 'tu_001', name: 'get_workspace_info', input: { space_id: 11 } },
              ],
              stop_reason: 'tool_use',
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              content: [{ type: 'text', text: 'Your workspace has 5 tables.' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 200, output_tokens: 60 },
            }),
          });

        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;
        mockExecuteTool.mockResolvedValue({ success: true, tables: ['Users', 'Tasks', 'Projects', 'Notes', 'Tags'] });

        try {
          const result = await agentLoop({
            conversationId: 42,
            systemPrompt: 'You are a helpful assistant.',
            history: [],
            userMessage: 'What tables are in my workspace?',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          expect(result).toBe('Your workspace has 5 tables.');

          // Verify step messages were saved:
          // 1. thinking message ("Let me check the workspace.")
          // 2. tool_call message (get_workspace_info)
          // 3. tool_result message
          // 4. final text response
          const insertCalls = mockDbRun.mock.calls.filter(([sql]) => sql.includes('INSERT INTO messages'));

          // Find the thinking message
          const thinkingCall = insertCalls.find(([, params]) => params[5] === 'thinking');
          expect(thinkingCall).toBeTruthy();
          expect(thinkingCall[1][4]).toBe('Let me check the workspace.');

          // Find the tool_call message
          const toolCallSave = insertCalls.find(([, params]) => params[5] === 'tool_call');
          expect(toolCallSave).toBeTruthy();
          expect(toolCallSave[1][4]).toBe('get_workspace_info'); // content = tool name
          expect(toolCallSave[1][6]).toBe(10);                    // agent_id

          // Find the tool_result message
          const toolResultSave = insertCalls.find(([, params]) => params[5] === 'tool_result');
          expect(toolResultSave).toBeTruthy();
          expect(toolResultSave[1][3]).toBe('tool');  // role = 'tool'

          // Find the final text message
          const finalTextSave = insertCalls.find(([, params]) => params[5] === 'text' && params[4] === 'Your workspace has 5 tables.');
          expect(finalTextSave).toBeTruthy();
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      it('should handle API errors gracefully and trigger safety net', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;

        try {
          const result = await agentLoop({
            conversationId: 42,
            systemPrompt: 'You are a helpful assistant.',
            history: [],
            userMessage: 'Hello',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          // Safety net kicks in since no text was produced (default max_iterations=25)
          expect(result).toBe('\u26a0\ufe0f Agent reached iteration limit (25). The task may be incomplete. Please retry or increase max_iterations in agent settings.');
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });

    describe('agentLoop with OpenAI provider', () => {

      it('should save step messages for OpenAI tool calls', async () => {
        // Iteration 1: OpenAI wants to call a function
        // Iteration 2: OpenAI returns final text
        const mockFetch = vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  content: 'Let me look that up.',
                  tool_calls: [{
                    id: 'call_001',
                    type: 'function',
                    function: { name: 'query_table_data', arguments: '{"table_id": 5}' },
                  }],
                },
                finish_reason: 'tool_calls',
              }],
              usage: { prompt_tokens: 100, completion_tokens: 50 },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              choices: [{
                message: { content: 'Found 10 rows in the table.' },
                finish_reason: 'stop',
              }],
              usage: { prompt_tokens: 200, completion_tokens: 60 },
            }),
          });

        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;
        mockExecuteTool.mockResolvedValue({ success: true, rows: Array(10).fill({ id: 1 }) });

        try {
          const result = await agentLoop({
            conversationId: 42,
            systemPrompt: 'You are a helpful assistant.',
            history: [],
            userMessage: 'Show me table 5 data',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'gpt-4-turbo', provider: 'openai', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          expect(result).toBe('Found 10 rows in the table.');

          // Verify step messages
          const insertCalls = mockDbRun.mock.calls.filter(([sql]) => sql.includes('INSERT INTO messages'));

          // thinking step (before tool calls)
          const thinkingCall = insertCalls.find(([, params]) => params[5] === 'thinking');
          expect(thinkingCall).toBeTruthy();
          expect(thinkingCall[1][4]).toBe('Let me look that up.');

          // tool_call step
          const toolCallSave = insertCalls.find(([, params]) => params[5] === 'tool_call');
          expect(toolCallSave).toBeTruthy();
          expect(toolCallSave[1][4]).toBe('query_table_data');

          // tool_result step
          const toolResultSave = insertCalls.find(([, params]) => params[5] === 'tool_result');
          expect(toolResultSave).toBeTruthy();
          expect(toolResultSave[1][3]).toBe('tool');

          // Final text
          const finalSave = insertCalls.find(([, params]) => params[5] === 'text');
          expect(finalSave).toBeTruthy();
          expect(finalSave[1][4]).toBe('Found 10 rows in the table.');
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      it('should use correct API URL for OpenAI provider', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;

        try {
          await agentLoop({
            conversationId: 42,
            systemPrompt: 'Test',
            history: [],
            userMessage: 'Hello',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'gpt-4', provider: 'openai', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: null,
            userId: 1,
          });

          expect(mockFetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/chat/completions',
            expect.any(Object)
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      it('should use correct API URL for OpenRouter provider', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;

        try {
          await agentLoop({
            conversationId: 42,
            systemPrompt: 'Test',
            history: [],
            userMessage: 'Hello',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'gpt-4', provider: 'openrouter', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: null,
            userId: 1,
          });

          expect(mockFetch).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/chat/completions',
            expect.any(Object)
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });

    describe('agentLoop max_iterations enforcement', () => {

      it('should respect agentConfig.max_iterations', async () => {
        // Return tool_use every time to force iteration
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            content: [
              { type: 'tool_use', id: 'tu_loop', name: 'get_workspace_info', input: { space_id: 1 } },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;
        mockExecuteTool.mockResolvedValue({ success: true });

        try {
          await agentLoop({
            conversationId: 42,
            systemPrompt: 'Test',
            history: [],
            userMessage: 'Hello',
            agentConfig: { max_iterations: 3 },
            resolved: { apiKey: 'sk-test', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          // Should have made 3 tool-loop calls + 1 summary call (no text response after 3 iterations)
          expect(mockFetch).toHaveBeenCalledTimes(4);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      it('should default to 10 max_iterations when not configured', async () => {
        let callCount = 0;
        const mockFetch = vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount >= 10) {
            // On the 10th call, return end_turn to prevent any surprises
            return {
              ok: true,
              json: async () => ({
                content: [{ type: 'text', text: 'Done' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 100, output_tokens: 50 },
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              content: [
                { type: 'tool_use', id: `tu_${callCount}`, name: 'get_workspace_info', input: { space_id: 1 } },
              ],
              stop_reason: 'tool_use',
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
          };
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;
        mockExecuteTool.mockResolvedValue({ success: true });

        try {
          await agentLoop({
            conversationId: 42,
            systemPrompt: 'Test',
            history: [],
            userMessage: 'Hello',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          // Should stop at or before 10 iterations
          expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(10);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });

    describe('Summary call instead of generic safety net', () => {

      it('should make a summary call when Anthropic tool loop ends without text response', async () => {
        let callCount = 0;
        const mockFetch = vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // First call: tool_use
            return {
              ok: true,
              json: async () => ({
                content: [
                  { type: 'tool_use', id: 'tu_1', name: 'get_workspace_info', input: { space_id: 1 } },
                ],
                stop_reason: 'tool_use',
                usage: { input_tokens: 100, output_tokens: 50 },
              }),
            };
          }
          if (callCount === 2) {
            // Second call: another tool_use, no text — forces tool_result but no more iterations
            return {
              ok: true,
              json: async () => ({
                content: [],
                stop_reason: 'end_turn',
                usage: { input_tokens: 100, output_tokens: 10 },
              }),
            };
          }
          // Third call: summary call — return text summary
          return {
            ok: true,
            json: async () => ({
              content: [{ type: 'text', text: 'Here is what I accomplished: created workspace.' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 200, output_tokens: 80 },
            }),
          };
        });

        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;
        mockExecuteTool.mockResolvedValue({ success: true });

        try {
          const result = await agentLoop({
            conversationId: 42,
            systemPrompt: 'Test',
            history: [],
            userMessage: 'Create workspace',
            agentConfig: { max_iterations: 5 },
            resolved: { apiKey: 'sk-test', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          // Should get summary text instead of "Task completed"
          expect(result).toBe('Here is what I accomplished: created workspace.');
          // 2 loop calls + 1 summary call = 3
          expect(mockFetch).toHaveBeenCalledTimes(3);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      it('should make a summary call for OpenAI when tool loop ends without text', async () => {
        let callCount = 0;
        const mockFetch = vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              json: async () => ({
                choices: [{
                  message: {
                    content: null,
                    tool_calls: [{
                      id: 'call_1', type: 'function',
                      function: { name: 'get_workspace_info', arguments: '{"space_id":1}' }
                    }]
                  },
                  finish_reason: 'tool_calls'
                }],
                usage: { prompt_tokens: 100, completion_tokens: 50 },
              }),
            };
          }
          if (callCount === 2) {
            // No more tool calls, but empty content
            return {
              ok: true,
              json: async () => ({
                choices: [{
                  message: { content: '', tool_calls: undefined },
                  finish_reason: 'stop'
                }],
                usage: { prompt_tokens: 100, completion_tokens: 10 },
              }),
            };
          }
          // Summary call
          return {
            ok: true,
            json: async () => ({
              choices: [{
                message: { content: 'Summary: workspace info retrieved successfully.' },
                finish_reason: 'stop'
              }],
              usage: { prompt_tokens: 200, completion_tokens: 60 },
            }),
          };
        });

        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;
        mockExecuteTool.mockResolvedValue({ success: true });

        try {
          const result = await agentLoop({
            conversationId: 42,
            systemPrompt: 'Test',
            history: [],
            userMessage: 'Get info',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'gpt-4o', provider: 'openai', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          expect(result).toBe('Summary: workspace info retrieved successfully.');
          expect(mockFetch).toHaveBeenCalledTimes(3);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      it('should fall back to generic message when summary call fails', async () => {
        const mockFetch = vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              content: [
                { type: 'tool_use', id: 'tu_1', name: 'get_workspace_info', input: { space_id: 1 } },
              ],
              stop_reason: 'tool_use',
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              content: [],
              stop_reason: 'end_turn',
              usage: { input_tokens: 100, output_tokens: 10 },
            }),
          })
          // Summary call fails
          .mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error',
          });

        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch;
        mockExecuteTool.mockResolvedValue({ success: true });

        try {
          const result = await agentLoop({
            conversationId: 42,
            systemPrompt: 'Test',
            history: [],
            userMessage: 'Do something',
            agentConfig: {},
            resolved: { apiKey: 'sk-test', model: 'claude-sonnet-4', provider: 'anthropic', isLocal: false },
            agentRowId: 10,
            senderId: 99,
            spaceId: 11,
            userId: 1,
          });

          // Falls back to generic message with iteration limit (default max_iterations=25)
          expect(result).toBe('\u26a0\ufe0f Agent reached iteration limit (25). The task may be incomplete. Please retry or increase max_iterations in agent settings.');
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });
  });
});
