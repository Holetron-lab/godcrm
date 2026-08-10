/**
 * ADR-110 Phase 1: Hierarchical Smart Context Tests
 *
 * Tests for:
 *   - loadConversationHistory() with context levels (Levels 1-4)
 *   - resolveContextLevels() defaults and merging
 *   - buildContentTypes() dynamic SQL clause building
 *   - formatMessageByLevel() message formatting
 *   - extractToolName() / extractToolArgs()
 *   - Backward compatibility (no context_levels set)
 *
 * @see backend/services/chat/agent-execution-shared.js
 * @see ADR-110: Hierarchical Smart Context
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

import {
  loadConversationHistory,
  resolveContextLevels,
  buildContentTypes,
  formatMessageByLevel,
  extractToolName,
  extractToolArgs,
  CONTEXT_LEVELS_DEFAULTS,
  BASE_CONTENT_TYPES,
} from '../agent-execution-shared.js';
import { dbAll } from '../../../database/connection.js';

describe('ADR-110: Hierarchical Smart Context', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── resolveContextLevels ─────────────────────────────────

  describe('resolveContextLevels()', () => {

    it('should return all defaults when no context_settings', () => {
      const levels = resolveContextLevels({});
      expect(levels).toEqual(CONTEXT_LEVELS_DEFAULTS);
      expect(levels.thinking).toBe(false);
      expect(levels.thinking_preview_chars).toBe(200);
      expect(levels.tool_summaries).toBe(false);
      expect(levels.tool_preview_chars).toBe(100);
      expect(levels.full_tool_results).toBe(false);
    });

    it('should return defaults when context_settings has no context_levels', () => {
      const levels = resolveContextLevels({
        context_settings: { max_history: 100 },
      });
      expect(levels).toEqual(CONTEXT_LEVELS_DEFAULTS);
    });

    it('should merge partial context_levels with defaults', () => {
      const levels = resolveContextLevels({
        context_settings: {
          context_levels: { thinking: true },
        },
      });
      expect(levels.thinking).toBe(true);
      expect(levels.thinking_preview_chars).toBe(200); // default preserved
      expect(levels.tool_summaries).toBe(false);        // default preserved
    });

    it('should handle stringified context_settings', () => {
      const levels = resolveContextLevels({
        context_settings: JSON.stringify({
          context_levels: { thinking: true, thinking_preview_chars: 500 },
        }),
      });
      expect(levels.thinking).toBe(true);
      expect(levels.thinking_preview_chars).toBe(500);
    });

    it('should override all fields when fully specified', () => {
      const levels = resolveContextLevels({
        context_settings: {
          context_levels: {
            thinking: true,
            thinking_preview_chars: 300,
            tool_summaries: true,
            tool_preview_chars: 50,
            full_tool_results: true,
          },
        },
      });
      expect(levels.thinking).toBe(true);
      expect(levels.thinking_preview_chars).toBe(300);
      expect(levels.tool_summaries).toBe(true);
      expect(levels.tool_preview_chars).toBe(50);
      expect(levels.full_tool_results).toBe(true);
    });

    it('should handle null agentConfig gracefully', () => {
      const levels = resolveContextLevels(null);
      expect(levels).toEqual(CONTEXT_LEVELS_DEFAULTS);
    });

    it('should handle context_levels set to non-object gracefully', () => {
      const levels = resolveContextLevels({
        context_settings: { context_levels: 'invalid' },
      });
      expect(levels).toEqual(CONTEXT_LEVELS_DEFAULTS);
    });
  });

  // ─── buildContentTypes ────────────────────────────────────

  describe('buildContentTypes()', () => {

    it('should return base types only for Level 1 (defaults)', () => {
      const types = buildContentTypes(CONTEXT_LEVELS_DEFAULTS);
      expect(types).toEqual(BASE_CONTENT_TYPES);
      expect(types).toEqual(['text', 'markdown', 'code', 'plan']);
    });

    it('should add thinking for Level 2', () => {
      const types = buildContentTypes({ ...CONTEXT_LEVELS_DEFAULTS, thinking: true });
      expect(types).toContain('thinking');
      expect(types).not.toContain('tool_call');
      expect(types).not.toContain('tool_result');
    });

    it('should add tool_call and tool_result for Level 3 (tool_summaries)', () => {
      const types = buildContentTypes({ ...CONTEXT_LEVELS_DEFAULTS, tool_summaries: true });
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
      expect(types).not.toContain('thinking');
    });

    it('should add tool_call and tool_result for Level 4 (full_tool_results)', () => {
      const types = buildContentTypes({ ...CONTEXT_LEVELS_DEFAULTS, full_tool_results: true });
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
    });

    it('should include all types for full Level 2+3+4', () => {
      const types = buildContentTypes({
        thinking: true,
        tool_summaries: true,
        full_tool_results: true,
        thinking_preview_chars: 200,
        tool_preview_chars: 100,
      });
      expect(types).toEqual(['text', 'markdown', 'code', 'plan', 'thinking', 'tool_call', 'tool_result']);
    });

    it('should not duplicate types when both tool_summaries and full_tool_results are true', () => {
      const types = buildContentTypes({
        ...CONTEXT_LEVELS_DEFAULTS,
        tool_summaries: true,
        full_tool_results: true,
      });
      const toolCallCount = types.filter(t => t === 'tool_call').length;
      const toolResultCount = types.filter(t => t === 'tool_result').length;
      expect(toolCallCount).toBe(1);
      expect(toolResultCount).toBe(1);
    });
  });

  // ─── extractToolName ──────────────────────────────────────

  describe('extractToolName()', () => {

    it('should extract tool name from tool_results JSON', () => {
      const name = extractToolName({
        tool_results: JSON.stringify({ tool: 'search_records', args: { query: 'test' } }),
        content_type: 'tool_call',
      });
      expect(name).toBe('search_records');
    });

    it('should extract tool name from tool_results.name field', () => {
      const name = extractToolName({
        tool_results: JSON.stringify({ name: 'update_row', result: 'ok' }),
        content_type: 'tool_result',
      });
      expect(name).toBe('update_row');
    });

    it('should extract tool name from content when tool_call and content is tool name', () => {
      const name = extractToolName({
        tool_results: null,
        content: 'search_records',
        content_type: 'tool_call',
      });
      expect(name).toBe('search_records');
    });

    it('should extract tool name from JSON content', () => {
      const name = extractToolName({
        tool_results: null,
        content: JSON.stringify({ tool: 'create_task' }),
        content_type: 'tool_call',
      });
      expect(name).toBe('create_task');
    });

    it('should return "unknown" when no tool name extractable', () => {
      const name = extractToolName({
        tool_results: null,
        content: 'some long content that is not a tool name',
        content_type: 'thinking',
      });
      expect(name).toBe('unknown');
    });

    it('should handle null tool_results and content gracefully', () => {
      const name = extractToolName({
        tool_results: null,
        content: null,
        content_type: 'tool_call',
      });
      expect(name).toBe('unknown');
    });
  });

  // ─── extractToolArgs ──────────────────────────────────────

  describe('extractToolArgs()', () => {

    it('should extract and truncate string args', () => {
      const longArgs = 'a'.repeat(200);
      const args = extractToolArgs({
        tool_results: JSON.stringify({ tool: 'test', args: longArgs }),
      }, 100);
      expect(args).toHaveLength(103); // 100 + '...'
      expect(args.endsWith('...')).toBe(true);
    });

    it('should extract and stringify object args', () => {
      const args = extractToolArgs({
        tool_results: JSON.stringify({ tool: 'test', args: { query: 'hello' } }),
      }, 100);
      expect(args).toContain('query');
      expect(args).toContain('hello');
    });

    it('should return empty string when no args', () => {
      const args = extractToolArgs({
        tool_results: JSON.stringify({ tool: 'test' }),
      }, 100);
      expect(args).toBe('');
    });

    it('should return empty string when no tool_results', () => {
      const args = extractToolArgs({ tool_results: null }, 100);
      expect(args).toBe('');
    });

    it('should not truncate short args', () => {
      const args = extractToolArgs({
        tool_results: JSON.stringify({ tool: 'test', args: 'short' }),
      }, 100);
      expect(args).toBe('short');
      expect(args).not.toContain('...');
    });
  });

  // ─── formatMessageByLevel ─────────────────────────────────

  describe('formatMessageByLevel()', () => {

    it('should format thinking message with truncation', () => {
      const longThinking = 'A'.repeat(300);
      const result = formatMessageByLevel(
        { id: 42, content_type: 'thinking', content: longThinking },
        { ...CONTEXT_LEVELS_DEFAULTS, thinking: true, thinking_preview_chars: 200 }
      );
      expect(result.startsWith('[Thinking step_id=42]: ')).toBe(true);
      expect(result).toContain('...');
      // 200 chars of content + prefix + '...'
      const contentPart = result.replace('[Thinking step_id=42]: ', '');
      expect(contentPart).toBe('A'.repeat(200) + '...');
    });

    it('should not truncate short thinking message', () => {
      const result = formatMessageByLevel(
        { id: 42, content_type: 'thinking', content: 'brief thought' },
        { ...CONTEXT_LEVELS_DEFAULTS, thinking: true }
      );
      expect(result).toBe('[Thinking step_id=42]: brief thought');
      expect(result).not.toContain('...');
    });

    it('should format tool_call message', () => {
      const result = formatMessageByLevel(
        {
          id: 55,
          content_type: 'tool_call',
          content: 'search_records',
          tool_results: JSON.stringify({ tool: 'search_records', args: { query: 'test' } }),
        },
        { ...CONTEXT_LEVELS_DEFAULTS, tool_summaries: true }
      );
      expect(result.startsWith('[Tool Call step_id=55]: search_records(')).toBe(true);
      expect(result).toContain('query');
    });

    it('should format tool_result message with summary (truncated)', () => {
      const longResult = 'R'.repeat(200);
      const result = formatMessageByLevel(
        {
          id: 56,
          content_type: 'tool_result',
          content: longResult,
          tool_results: JSON.stringify({ tool: 'search_records', result: longResult }),
        },
        { ...CONTEXT_LEVELS_DEFAULTS, tool_summaries: true, tool_preview_chars: 100 }
      );
      expect(result.startsWith('[Tool Result step_id=56 tool=search_records]: ')).toBe(true);
      expect(result).toContain('...');
      const contentPart = result.replace('[Tool Result step_id=56 tool=search_records]: ', '');
      expect(contentPart).toBe('R'.repeat(100) + '...');
    });

    it('should format tool_result message with full results (no truncation)', () => {
      const longResult = 'R'.repeat(500);
      const result = formatMessageByLevel(
        {
          id: 56,
          content_type: 'tool_result',
          content: longResult,
          tool_results: JSON.stringify({ tool: 'search_records' }),
        },
        { ...CONTEXT_LEVELS_DEFAULTS, full_tool_results: true }
      );
      expect(result.startsWith('[Tool Result step_id=56 tool=search_records]: ')).toBe(true);
      const contentPart = result.replace('[Tool Result step_id=56 tool=search_records]: ', '');
      expect(contentPart).toBe(longResult);
      expect(contentPart).not.toContain('...');
    });

    it('should return plain content for text messages', () => {
      const result = formatMessageByLevel(
        { id: 10, content_type: 'text', content: 'Hello world' },
        CONTEXT_LEVELS_DEFAULTS
      );
      expect(result).toBe('Hello world');
    });

    it('should return plain content for markdown messages', () => {
      const result = formatMessageByLevel(
        { id: 11, content_type: 'markdown', content: '## Title' },
        CONTEXT_LEVELS_DEFAULTS
      );
      expect(result).toBe('## Title');
    });

    it('should return plain content for code messages', () => {
      const result = formatMessageByLevel(
        { id: 12, content_type: 'code', content: 'const x = 1;' },
        CONTEXT_LEVELS_DEFAULTS
      );
      expect(result).toBe('const x = 1;');
    });

    it('should handle null content gracefully', () => {
      const result = formatMessageByLevel(
        { id: 42, content_type: 'thinking', content: null },
        { ...CONTEXT_LEVELS_DEFAULTS, thinking: true }
      );
      expect(result).toBe('[Thinking step_id=42]: ');
    });
  });

  // ─── loadConversationHistory ──────────────────────────────

  describe('loadConversationHistory()', () => {

    // Helper to create mock DB messages (returned in DESC order)
    function mockMessages(msgs) {
      dbAll.mockResolvedValueOnce(msgs);
    }

    describe('Level 1: Default (text/markdown/code only)', () => {

      it('should load only text/markdown/code when no context_levels set', async () => {
        mockMessages([
          { id: 3, content: 'Thanks', role: 'user', sender_id: 1, sender_name: 'Alice', content_type: 'text' },
          { id: 2, content: 'Response', role: 'assistant', sender_id: 2, content_type: 'text' },
          { id: 1, content: 'Hello', role: 'user', sender_id: 1, sender_name: 'Alice', content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42, {});

        // Verify SQL query uses only base content types
        const sqlQuery = dbAll.mock.calls[0][0];
        expect(sqlQuery).toContain('content_type IN');

        // Verify params include base types
        const params = dbAll.mock.calls[0][1];
        expect(params).toContain('text');
        expect(params).toContain('markdown');
        expect(params).toContain('code');
        expect(params).not.toContain('thinking');
        expect(params).not.toContain('tool_call');

        // Verify results
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ role: 'user', content: '[Alice]: Hello' });
        expect(result[1]).toEqual({ role: 'assistant', content: 'Response' });
      });

      it('should be backward compatible with existing agentConfig formats', async () => {
        mockMessages([]);

        await loadConversationHistory(42, { max_history: 30 });

        const params = dbAll.mock.calls[0][1];
        // Should include conversationId and maxHistory plus content types
        expect(params[0]).toBe(42);
        // Content types should be base only
        expect(params).toContain('text');
        expect(params).not.toContain('thinking');
      });
    });

    describe('Level 2: Thinking messages', () => {

      it('should include thinking messages when thinking=true', async () => {
        mockMessages([
          { id: 2, content: 'I need to check the database', role: 'assistant', sender_id: 2, content_type: 'thinking' },
          { id: 1, content: 'Check the tasks', role: 'user', sender_id: 1, sender_name: 'Bob', content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: {
            context_levels: { thinking: true },
          },
        });

        const params = dbAll.mock.calls[0][1];
        expect(params).toContain('thinking');

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ role: 'user', content: '[Bob]: Check the tasks' });
        expect(result[1].content).toContain('[Thinking step_id=2]');
        expect(result[1].content).toContain('I need to check the database');
      });

      it('should truncate long thinking messages to thinking_preview_chars', async () => {
        const longThought = 'T'.repeat(500);
        mockMessages([
          { id: 1, content: longThought, role: 'assistant', sender_id: 2, content_type: 'thinking' },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: {
            context_levels: { thinking: true, thinking_preview_chars: 100 },
          },
        });

        const thinkingContent = result[0].content;
        expect(thinkingContent.startsWith('[Thinking step_id=1]: ')).toBe(true);
        const contentPart = thinkingContent.replace('[Thinking step_id=1]: ', '');
        expect(contentPart).toBe('T'.repeat(100) + '...');
      });
    });

    describe('Level 3: Tool summaries', () => {

      it('should include tool_call and tool_result messages with summaries', async () => {
        const toolResultContent = 'Found 5 records: ' + 'data '.repeat(50);
        mockMessages([
          { id: 3, content: toolResultContent, role: 'assistant', sender_id: 2, content_type: 'tool_result',
            tool_results: JSON.stringify({ tool: 'search_records', result: toolResultContent }) },
          { id: 2, content: 'search_records', role: 'assistant', sender_id: 2, content_type: 'tool_call',
            tool_results: JSON.stringify({ tool: 'search_records', args: { query: 'open tasks' } }) },
          { id: 1, content: 'Find open tasks', role: 'user', sender_id: 1, sender_name: 'Alice', content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: {
            context_levels: { tool_summaries: true, tool_preview_chars: 50 },
          },
        });

        const params = dbAll.mock.calls[0][1];
        expect(params).toContain('tool_call');
        expect(params).toContain('tool_result');

        expect(result).toHaveLength(3);

        // User message unchanged
        expect(result[0]).toEqual({ role: 'user', content: '[Alice]: Find open tasks' });

        // Tool call formatted
        expect(result[1].content.startsWith('[Tool Call step_id=2]: search_records(')).toBe(true);

        // Tool result truncated
        expect(result[2].content.startsWith('[Tool Result step_id=3 tool=search_records]: ')).toBe(true);
        expect(result[2].content).toContain('...');
      });
    });

    describe('Level 4: Full tool results', () => {

      it('should include full tool results without truncation', async () => {
        const fullResult = 'Complete result: ' + 'x'.repeat(500);
        mockMessages([
          { id: 2, content: fullResult, role: 'assistant', sender_id: 2, content_type: 'tool_result',
            tool_results: JSON.stringify({ tool: 'get_row', result: fullResult }) },
          { id: 1, content: 'Get row 42', role: 'user', sender_id: 1, content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: {
            context_levels: { full_tool_results: true },
          },
        });

        // Full result should not be truncated
        expect(result[1].content).toContain(fullResult);
        expect(result[1].content.endsWith('...')).toBe(false);
        expect(result[1].content.startsWith('[Tool Result step_id=2 tool=get_row]: ')).toBe(true);
      });
    });

    describe('Combined levels', () => {

      it('should support thinking + tool summaries (Level 2+3)', async () => {
        mockMessages([
          { id: 3, content: 'Result data', role: 'assistant', sender_id: 2, content_type: 'tool_result',
            tool_results: JSON.stringify({ tool: 'search', result: 'Result data' }) },
          { id: 2, content: 'Let me search...', role: 'assistant', sender_id: 2, content_type: 'thinking' },
          { id: 1, content: 'Hello', role: 'user', sender_id: 1, content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: {
            context_levels: { thinking: true, tool_summaries: true },
          },
        });

        const params = dbAll.mock.calls[0][1];
        expect(params).toContain('thinking');
        expect(params).toContain('tool_call');
        expect(params).toContain('tool_result');

        expect(result[1].content).toContain('[Thinking step_id=2]');
        expect(result[2].content).toContain('[Tool Result step_id=3');
      });

      it('should support all levels (Level 2+3+4)', async () => {
        mockMessages([
          { id: 3, content: 'R'.repeat(500), role: 'assistant', sender_id: 2, content_type: 'tool_result',
            tool_results: JSON.stringify({ tool: 'search' }) },
          { id: 2, content: 'Thought', role: 'assistant', sender_id: 2, content_type: 'thinking' },
          { id: 1, content: 'Go', role: 'user', sender_id: 1, content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: {
            context_levels: {
              thinking: true,
              tool_summaries: true,
              full_tool_results: true,
            },
          },
        });

        // full_tool_results should take precedence over tool_summaries for tool_result
        const toolResultMsg = result[2];
        expect(toolResultMsg.content).toContain('R'.repeat(500));
        expect(toolResultMsg.content.endsWith('...')).toBe(false);
      });
    });

    describe('Backward compatibility', () => {

      it('should behave identically to original when no context_levels', async () => {
        mockMessages([
          { id: 2, content: 'Response', role: 'assistant', sender_id: 99, content_type: 'text' },
          { id: 1, content: 'Hello', role: 'user', sender_id: 1, sender_name: 'Alice', content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42, {}, 99);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ role: 'user', content: '[Alice]: Hello' });
        expect(result[1]).toEqual({ role: 'assistant', content: 'Response' });
      });

      it('should handle attachments on text messages', async () => {
        mockMessages([
          {
            id: 1,
            content: 'See attached',
            role: 'user',
            sender_id: 1,
            sender_name: 'Alice',
            content_type: 'text',
            attachments: JSON.stringify([
              { name: 'doc.pdf', type: 'application/pdf', url: '/files/doc.pdf' },
            ]),
          },
        ]);

        const result = await loadConversationHistory(42, {});

        expect(result[0].content).toContain('[Attached files]');
        expect(result[0].content).toContain('doc.pdf');
      });

      it('should NOT include attachments section on step messages', async () => {
        mockMessages([
          {
            id: 1,
            content: 'Thinking about the problem',
            role: 'assistant',
            sender_id: 2,
            content_type: 'thinking',
            attachments: JSON.stringify([
              { name: 'debug.log', type: 'text/plain', url: '/files/debug.log' },
            ]),
          },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: { context_levels: { thinking: true } },
        });

        expect(result[0].content).toContain('[Thinking step_id=1]');
        expect(result[0].content).not.toContain('[Attached files]');
      });

      it('should determine assistant role using agentUserId', async () => {
        mockMessages([
          { id: 1, content: 'Agent reply', role: 'user', sender_id: 99, sender_name: 'Bot', content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42, {}, 99);
        expect(result[0].role).toBe('assistant');
      });

      it('should use default max history (50) when not configured', async () => {
        mockMessages([]);
        await loadConversationHistory(42, {});

        const params = dbAll.mock.calls[0][1];
        // Last param for SQLite is LIMIT
        const lastParam = params[params.length - 1];
        expect(lastParam).toBe(50);
      });

      it('should use configurable max_history', async () => {
        mockMessages([]);
        await loadConversationHistory(42, { max_history: 25 });

        const params = dbAll.mock.calls[0][1];
        const lastParam = params[params.length - 1];
        expect(lastParam).toBe(25);
      });

      it('should reverse DB DESC results to chronological ASC order', async () => {
        mockMessages([
          { id: 3, content: 'Third', role: 'user', sender_id: 1, content_type: 'text' },
          { id: 2, content: 'Second', role: 'user', sender_id: 1, content_type: 'text' },
          { id: 1, content: 'First', role: 'user', sender_id: 1, content_type: 'text' },
        ]);

        const result = await loadConversationHistory(42);

        expect(result[0].content).toBe('First');
        expect(result[1].content).toBe('Second');
        expect(result[2].content).toBe('Third');
      });
    });

    describe('Edge cases', () => {

      it('should handle empty conversation gracefully', async () => {
        mockMessages([]);
        const result = await loadConversationHistory(42, {
          context_settings: {
            context_levels: { thinking: true, tool_summaries: true },
          },
        });
        expect(result).toEqual([]);
      });

      it('should handle messages with missing content', async () => {
        mockMessages([
          { id: 1, content: null, role: 'assistant', sender_id: 2, content_type: 'thinking' },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: { context_levels: { thinking: true } },
        });

        expect(result[0].content).toBe('[Thinking step_id=1]: ');
      });

      it('should handle tool_result with no tool_results JSON', async () => {
        mockMessages([
          { id: 1, content: 'Some result', role: 'assistant', sender_id: 2, content_type: 'tool_result', tool_results: null },
        ]);

        const result = await loadConversationHistory(42, {
          context_settings: { context_levels: { tool_summaries: true } },
        });

        expect(result[0].content).toContain('[Tool Result step_id=1 tool=unknown]');
      });
    });
  });

  // ─── SQL Parameter Structure ──────────────────────────────

  describe('SQL parameter structure', () => {

    function mockMessages(msgs) {
      dbAll.mockResolvedValueOnce(msgs);
    }

    it('should build correct SQLite params: [conversationId, ...types, limit]', async () => {
      mockMessages([]);
      await loadConversationHistory(42, {
        max_history: 25,
        context_settings: {
          context_levels: { thinking: true, tool_summaries: true },
        },
      });

      const params = dbAll.mock.calls[0][1];
      // First param: conversationId
      expect(params[0]).toBe(42);
      // Middle params: content types
      expect(params).toContain('text');
      expect(params).toContain('markdown');
      expect(params).toContain('code');
      expect(params).toContain('thinking');
      expect(params).toContain('tool_call');
      expect(params).toContain('tool_result');
      // Last param: LIMIT
      expect(params[params.length - 1]).toBe(25);
    });

    it('should include tool_results column in SELECT', async () => {
      mockMessages([]);
      await loadConversationHistory(42, {
        context_settings: { context_levels: { tool_summaries: true } },
      });

      const sql = dbAll.mock.calls[0][0];
      expect(sql).toContain('m.tool_results');
    });
  });
});
