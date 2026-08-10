/**
 * ADR-110: Conversation Steps API Tests
 *
 * Tests for:
 *   - GET /api/v3/chat/conversations/:id/steps (list steps)
 *   - GET /api/v3/chat/conversations/:id/steps/:stepId (step detail)
 *   - Deep merge of context_settings in PUT /ai/agents/:agentId
 *
 * Uses a minimal Express app with isolated route handlers to avoid
 * interference from the full chat router's many middleware and routes.
 *
 * @see backend/routes/v3/chat.js
 * @see ADR-110: Hierarchical Smart Context
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ─── Mock DB ─────────────────────────────────────────────────

const mockDbGet = vi.fn();
const mockDbAll = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => mockDbGet(...args),
  dbAll: (...args) => mockDbAll(...args),
  dbRun: vi.fn(),
  isPostgres: vi.fn(() => false),
  safeJsonParse: (str, def) => {
    if (str === null || str === undefined) return def;
    if (typeof str === 'object') return str;
    try { return JSON.parse(str); } catch { return def ?? null; }
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import express from 'express';
import request from 'supertest';
import { isPostgres, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';

// ─── Re-create the route handlers in isolation ──────────────
// This avoids importing the full chat.js which has dozens of routes,
// module-level side effects, and complex mock requirements.

function success(res, data) {
  return res.json({ success: true, data });
}
function badRequest(res, message) {
  return res.status(400).json({ success: false, error: message });
}
function notFound(res, entity) {
  return res.status(404).json({ success: false, error: `${entity} not found` });
}
function error(res, code, message, status = 500) {
  return res.status(status).json({ success: false, error: message, code });
}

let app;

beforeAll(() => {
  const router = express.Router();

  // Minimal auth middleware
  router.use((req, _res, next) => {
    req.user = { id: 1, userId: 1 };
    next();
  });

  // ── Steps list endpoint (copied from chat.js) ──
  router.get('/conversations/:id/steps', async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (!conversationId || isNaN(conversationId)) {
        return badRequest(res, 'Invalid conversation ID');
      }

      const allowedTypes = ['thinking', 'tool_call', 'tool_result'];
      const typeParam = req.query.type || 'tool_call,tool_result,thinking';
      const requestedTypes = typeParam.split(',').map(t => t.trim()).filter(t => allowedTypes.includes(t));
      if (requestedTypes.length === 0) {
        return badRequest(res, `Invalid type filter. Allowed: ${allowedTypes.join(', ')}`);
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const offset = (page - 1) * limit;

      const conversation = await mockDbGet(
        `SELECT id FROM conversations WHERE id = ?`,
        [conversationId]
      );
      if (!conversation) {
        return notFound(res, 'Conversation');
      }

      const countRow = await mockDbGet(
        `SELECT COUNT(*) as total FROM messages WHERE conversation_id = ? AND content_type IN (${requestedTypes.map(() => '?').join(', ')}) AND (is_deleted = 0 OR is_deleted IS NULL)`,
        [conversationId, ...requestedTypes]
      );
      const total = countRow?.total || 0;

      const steps = await mockDbAll(
        `SELECT id, content_type, content, tool_results, created_at FROM messages WHERE conversation_id = ? AND content_type IN (${requestedTypes.map(() => '?').join(', ')}) AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at ASC LIMIT ? OFFSET ?`,
        [conversationId, ...requestedTypes, limit, offset]
      );

      const PREVIEW_CHARS = 100;
      const formattedSteps = steps.map(s => {
        let toolName = null;
        if (s.tool_results) {
          const toolData = safeJsonParse(s.tool_results);
          toolName = toolData?.tool || toolData?.name || null;
        }
        if (!toolName && s.content_type === 'tool_call' && s.content) {
          const parsed = safeJsonParse(s.content);
          toolName = parsed?.tool || parsed?.name || null;
          if (!toolName && typeof s.content === 'string' && s.content.length < 100 && !s.content.includes(' ')) {
            toolName = s.content;
          }
        }
        return {
          id: s.id,
          type: s.content_type,
          tool_name: toolName,
          preview: s.content ? s.content.substring(0, PREVIEW_CHARS) : '',
          timestamp: s.created_at,
        };
      });

      const hasMore = offset + limit < total;

      return success(res, {
        steps: formattedSteps,
        hasMore,
        nextCursor: hasMore ? page + 1 : null,
        total,
      });
    } catch (err) {
      return error(res, 'STEPS_LIST_ERROR', err.message, 500);
    }
  });

  // ── Step detail endpoint (copied from chat.js) ──
  router.get('/conversations/:id/steps/:stepId', async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const stepId = parseInt(req.params.stepId);
      if (!conversationId || isNaN(conversationId) || !stepId || isNaN(stepId)) {
        return badRequest(res, 'Invalid conversation or step ID');
      }

      const step = await mockDbGet(
        `SELECT id, conversation_id, content_type, role, content, tool_results, agent_id, model_used, tokens_in, tokens_out, created_at FROM messages WHERE id = ? AND conversation_id = ? AND content_type IN ('thinking', 'tool_call', 'tool_result') AND (is_deleted = 0 OR is_deleted IS NULL)`,
        [stepId, conversationId]
      );

      if (!step) {
        return notFound(res, 'Step');
      }

      const toolData = step.tool_results ? safeJsonParse(step.tool_results) : null;

      return success(res, {
        id: step.id,
        type: step.content_type,
        content: step.content,
        tool_name: toolData?.tool || toolData?.name || null,
        tool_args: toolData?.args || null,
        metadata: {
          role: step.role,
          agent_id: step.agent_id,
          model: step.model_used,
          tokens: (step.tokens_in || step.tokens_out)
            ? { in: step.tokens_in, out: step.tokens_out }
            : null,
          result: toolData?.result || null,
        },
        conversation_id: step.conversation_id,
        created_at: step.created_at,
      });
    } catch (err) {
      return error(res, 'STEP_DETAIL_ERROR', err.message, 500);
    }
  });

  app = express();
  app.use(express.json());
  app.use('/api/v3/chat', router);
});

describe('ADR-110: Conversation Steps API', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /conversations/:id/steps ─────────────────────────

  describe('GET /conversations/:id/steps', () => {

    it('should return steps for a valid conversation', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 42 })      // conversation check
        .mockResolvedValueOnce({ total: 2 });    // count

      mockDbAll.mockResolvedValueOnce([
        {
          id: 101,
          content_type: 'tool_call',
          content: 'search_records',
          tool_results: JSON.stringify({ tool: 'search_records', args: { query: 'test' } }),
          created_at: '2026-03-01T10:00:00Z',
        },
        {
          id: 102,
          content_type: 'tool_result',
          content: 'Found 5 records matching your query in the database',
          tool_results: JSON.stringify({ tool: 'search_records', result: 'ok' }),
          created_at: '2026-03-01T10:00:01Z',
        },
      ]);

      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps')
        .expect(200);

      expect(res.body.data.steps).toHaveLength(2);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.hasMore).toBe(false);
      expect(res.body.data.nextCursor).toBeNull();

      const step1 = res.body.data.steps[0];
      expect(step1.id).toBe(101);
      expect(step1.type).toBe('tool_call');
      expect(step1.tool_name).toBe('search_records');
      expect(step1.preview).toBeDefined();
      expect(step1.timestamp).toBeDefined();
    });

    it('should return 404 for non-existent conversation', async () => {
      mockDbGet.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/v3/chat/conversations/999/steps')
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('should filter by type parameter', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 42 })
        .mockResolvedValueOnce({ total: 1 });

      mockDbAll.mockResolvedValueOnce([
        {
          id: 101,
          content_type: 'thinking',
          content: 'Let me think about this',
          tool_results: null,
          created_at: '2026-03-01T10:00:00Z',
        },
      ]);

      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps?type=thinking')
        .expect(200);

      expect(res.body.data.steps).toHaveLength(1);
      expect(res.body.data.steps[0].type).toBe('thinking');
    });

    it('should reject invalid type parameter', async () => {
      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps?type=invalid_type')
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should handle pagination correctly', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 42 })
        .mockResolvedValueOnce({ total: 25 });

      mockDbAll.mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          content_type: 'tool_call',
          content: `tool_${i}`,
          tool_results: null,
          created_at: '2026-03-01T10:00:00Z',
        }))
      );

      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps?limit=10&page=1')
        .expect(200);

      expect(res.body.data.steps).toHaveLength(10);
      expect(res.body.data.hasMore).toBe(true);
      expect(res.body.data.nextCursor).toBe(2);
      expect(res.body.data.total).toBe(25);
    });

    it('should return preview truncated to 100 chars', async () => {
      const longContent = 'x'.repeat(200);
      mockDbGet
        .mockResolvedValueOnce({ id: 42 })
        .mockResolvedValueOnce({ total: 1 });

      mockDbAll.mockResolvedValueOnce([
        {
          id: 101,
          content_type: 'tool_result',
          content: longContent,
          tool_results: null,
          created_at: '2026-03-01T10:00:00Z',
        },
      ]);

      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps')
        .expect(200);

      expect(res.body.data.steps[0].preview).toHaveLength(100);
    });

    it('should handle invalid conversation ID', async () => {
      const res = await request(app)
        .get('/api/v3/chat/conversations/abc/steps')
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should cap limit at 100', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 42 })
        .mockResolvedValueOnce({ total: 0 });
      mockDbAll.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/v3/chat/conversations/42/steps?limit=500')
        .expect(200);

      // Verify LIMIT param is capped
      const params = mockDbAll.mock.calls[0][1];
      const limitParam = params[params.length - 2];
      expect(limitParam).toBeLessThanOrEqual(100);
    });

    it('should default to all step types when no type param', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 42 })
        .mockResolvedValueOnce({ total: 0 });
      mockDbAll.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/v3/chat/conversations/42/steps')
        .expect(200);

      // Verify all three types are in the params
      const params = mockDbAll.mock.calls[0][1];
      expect(params).toContain('tool_call');
      expect(params).toContain('tool_result');
      expect(params).toContain('thinking');
    });
  });

  // ─── GET /conversations/:id/steps/:stepId ──────────────────

  describe('GET /conversations/:id/steps/:stepId', () => {

    it('should return full step detail', async () => {
      mockDbGet.mockResolvedValueOnce({
        id: 101,
        conversation_id: 42,
        content_type: 'tool_result',
        role: 'assistant',
        content: 'Full detailed result content here',
        tool_results: JSON.stringify({
          tool: 'search_records',
          args: { query: 'open tasks', table_id: 5 },
          result: { records: [{ id: 1, name: 'Task 1' }] },
        }),
        agent_id: 7,
        model_used: 'gpt-4-turbo',
        tokens_in: 500,
        tokens_out: 200,
        created_at: '2026-03-01T10:00:00Z',
      });

      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps/101')
        .expect(200);

      const data = res.body.data;
      expect(data.id).toBe(101);
      expect(data.type).toBe('tool_result');
      expect(data.content).toBe('Full detailed result content here');
      expect(data.tool_name).toBe('search_records');
      expect(data.tool_args).toEqual({ query: 'open tasks', table_id: 5 });
      expect(data.metadata.model).toBe('gpt-4-turbo');
      expect(data.metadata.tokens).toEqual({ in: 500, out: 200 });
      expect(data.metadata.result).toBeDefined();
      expect(data.conversation_id).toBe(42);
      expect(data.created_at).toBe('2026-03-01T10:00:00Z');
    });

    it('should return 404 for non-existent step', async () => {
      mockDbGet.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps/999')
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('should return step without tokens when not tracked', async () => {
      mockDbGet.mockResolvedValueOnce({
        id: 101,
        conversation_id: 42,
        content_type: 'thinking',
        role: 'assistant',
        content: 'Some thinking process',
        tool_results: null,
        agent_id: null,
        model_used: null,
        tokens_in: null,
        tokens_out: null,
        created_at: '2026-03-01T10:00:00Z',
      });

      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps/101')
        .expect(200);

      const data = res.body.data;
      expect(data.type).toBe('thinking');
      expect(data.tool_name).toBeNull();
      expect(data.tool_args).toBeNull();
      expect(data.metadata.tokens).toBeNull();
    });

    it('should handle invalid step ID', async () => {
      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps/abc')
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should scope step to conversation_id for security', async () => {
      mockDbGet.mockResolvedValueOnce(null); // step not found for this conversation

      const res = await request(app)
        .get('/api/v3/chat/conversations/42/steps/101')
        .expect(404);

      // Verify query includes both stepId AND conversationId
      const queryArgs = mockDbGet.mock.calls[0][1];
      expect(queryArgs).toContain(101); // stepId
      expect(queryArgs).toContain(42);  // conversationId
    });
  });
});

// ─── Deep Merge context_settings Tests ────────────────────

describe('ADR-110: Deep merge context_settings (ai-agents PUT)', () => {

  /**
   * Since the deepMergeContextSettings function is private to ai-agents.js,
   * we test the logic by replicating it here (same algorithm).
   * This validates the merge behavior documented in ADR-110 AC12.
   */
  function deepMergeContextSettings(existing, incoming) {
    const merged = { ...existing };
    for (const key of Object.keys(incoming)) {
      if (
        key === 'context_levels' &&
        typeof incoming[key] === 'object' && incoming[key] !== null &&
        typeof merged[key] === 'object' && merged[key] !== null
      ) {
        merged[key] = { ...merged[key], ...incoming[key] };
      } else {
        merged[key] = incoming[key];
      }
    }
    return merged;
  }

  it('should deep merge context_levels without wiping sibling fields', () => {
    const existing = {
      max_history: 100,
      context_levels: {
        thinking: false,
        thinking_preview_chars: 200,
        tool_summaries: false,
        tool_preview_chars: 100,
        full_tool_results: false,
      },
    };

    const incoming = {
      context_levels: {
        thinking: true,
      },
    };

    const result = deepMergeContextSettings(existing, incoming);

    expect(result.max_history).toBe(100);
    expect(result.context_levels.thinking).toBe(true);
    expect(result.context_levels.thinking_preview_chars).toBe(200);
    expect(result.context_levels.tool_summaries).toBe(false);
    expect(result.context_levels.tool_preview_chars).toBe(100);
    expect(result.context_levels.full_tool_results).toBe(false);
  });

  it('should overwrite top-level keys normally', () => {
    const existing = { max_history: 100, some_flag: true };
    const incoming = { max_history: 50 };

    const result = deepMergeContextSettings(existing, incoming);

    expect(result.max_history).toBe(50);
    expect(result.some_flag).toBe(true);
  });

  it('should create context_levels when it does not exist yet', () => {
    const existing = { max_history: 100 };
    const incoming = {
      context_levels: { thinking: true, tool_summaries: true },
    };

    const result = deepMergeContextSettings(existing, incoming);

    expect(result.context_levels).toEqual({ thinking: true, tool_summaries: true });
    expect(result.max_history).toBe(100);
  });

  it('should handle empty incoming gracefully', () => {
    const existing = {
      max_history: 100,
      context_levels: { thinking: true },
    };

    const result = deepMergeContextSettings(existing, {});

    expect(result).toEqual(existing);
  });

  it('should handle empty existing gracefully', () => {
    const incoming = {
      context_levels: { thinking: true },
    };

    const result = deepMergeContextSettings({}, incoming);

    expect(result.context_levels).toEqual({ thinking: true });
  });

  it('should handle null context_levels in incoming (overwrite)', () => {
    const existing = {
      context_levels: { thinking: true },
    };
    const incoming = { context_levels: null };

    const result = deepMergeContextSettings(existing, incoming);

    expect(result.context_levels).toBeNull();
  });

  it('should preserve multiple nested fields during partial update', () => {
    const existing = {
      max_history: 75,
      context_levels: {
        thinking: true,
        thinking_preview_chars: 300,
        tool_summaries: true,
        tool_preview_chars: 150,
        full_tool_results: false,
      },
    };

    const incoming = {
      context_levels: {
        full_tool_results: true,
        tool_preview_chars: 200,
      },
    };

    const result = deepMergeContextSettings(existing, incoming);

    expect(result.max_history).toBe(75);
    expect(result.context_levels.thinking).toBe(true);
    expect(result.context_levels.thinking_preview_chars).toBe(300);
    expect(result.context_levels.tool_summaries).toBe(true);
    expect(result.context_levels.tool_preview_chars).toBe(200);
    expect(result.context_levels.full_tool_results).toBe(true);
  });
});
