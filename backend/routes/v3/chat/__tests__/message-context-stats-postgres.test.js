// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
import { Router } from 'express';
import { dbGet } from '../../../../database/connection.js';

const fixture = vi.hoisted(() => ({ tokensIn: 0, tokensOut: 0 }));
vi.mock('../chatShared.js', async () => ({
  ...await import('../../../../database/connection.js'),
  ...await import('../../../../utils/response.js'),
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  requireAuth: (_req, _res, next) => next(),
  dbAll: async () => [{ id: 1, role: 'user', content: 'History is intact', content_type: 'text' }],
  dbGet: async (sql, params) => {
    if (!sql.includes('SUM(tokens_in)')) return null;
    const { dbGet: query } = await import('../../../../database/connection.js');
    // Execute the route's actual aggregate in PostgreSQL over two virtual rows.
    // No test records or schema changes, and no access to real message contents.
    return query(`WITH messages(conversation_id, tokens_in, tokens_out, content_type) AS (
      VALUES ($1::int, $2::int, $3::int, 'text'), ($1::int, 1, 1, 'tool_call')
    ) ${sql}`, [...params, fixture.tokensIn, fixture.tokensOut]);
  },
}));
vi.mock('../../../../services/chat/conversation-read-access.js', () => ({ canReadConversation: async () => true }));
vi.mock('../chatAgentHelpers.js', () => ({ resolveAgentInfoForMessages: async rows => rows }));
vi.mock('../chatAgentExecution.js', () => ({ executeAgentResponse: vi.fn() }));
vi.mock('../chatAgentAutoRespond.js', () => ({}));
vi.mock('../../../../services/messageMoveService.js', () => ({}));
vi.mock('../../../../services/criterionTicketSpawnService.js', () => ({}));
vi.mock('../../../../services/EffectiveRoleService.js', () => ({}));
vi.mock('../../../../services/inflight/queryActive.js', () => ({ queryActiveInflight: async () => [] }));
vi.mock('../../../../services/chat/rowAttachment.js', () => ({ getCommentThreadChildId: async () => null }));
vi.mock('../../../../services/translate/translateMessage.js', () => ({}));

const { default: register } = await import('../messageController.js');
const router = Router();
register(router);
const handler = router.stack.find(layer => layer.route?.path === '/conversations/:id/messages' && layer.route.methods.get).route.stack.at(-1).handle;

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
});

it.each([
  [2147483647, 10], // input token total crosses int32
  [10, 2147483647], // output token total crosses int32 independently
  [2147483647, 2147483647],
  [0, 0],
  [null, null],
])('loads history with input=%s and output=%s per row', async (tokensIn, tokensOut) => {
  Object.assign(fixture, { tokensIn, tokensOut });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ user: { id: 1 }, params: { id: '3660' }, query: {} }, res);
  expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
  expect(res.body.data.messages[0].content).toBe('History is intact');
  expect(res.body.data.context_stats).toMatchObject({
    total_tokens_in: (tokensIn ?? 0) + 1,
    total_tokens_out: (tokensOut ?? 0) + 1,
    total_messages: 2, text_messages: 1, tool_calls: 1, thinking_steps: 0,
  });
});
