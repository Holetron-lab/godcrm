// @vitest-environment node
import { it, expect, vi, beforeEach } from 'vitest';
const h = vi.hoisted(() => ({ kimi: vi.fn(), fetch: vi.fn(), dbGet: vi.fn() }));
vi.mock('../../../../database/connection.js', () => ({ dbGet: h.dbGet, dbRun: vi.fn(), isPostgres: () => true }));
vi.mock('../../../../services/AgentToolsService.js', () => ({ executeTool: vi.fn() }));
vi.mock('../../../../services/AgentActivityLogger.js', () => ({ logToolUsed: vi.fn() }));
vi.mock('../../../../utils/logger.js', () => ({ apiLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../services/labs/ai-execution-service.js', () => ({ default: { executeKimiCli: h.kimi } }));
vi.mock('../../../../services/chat/agent-execution-shared.js', () => ({
  resolveAgentProvider: async () => ({ provider: 'kimi-code', model: 'kimi-code/k3.1-pro', isLocal: true }),
  detectProvider: () => ({ isKimi: true, isCliAgent: true }),
  buildAgentSystemPrompt: async () => 'system', getHistoryLimit: () => 0,
  loadConversationHistory: async () => [], fetchBoundRowContext: async () => null,
  markSyncActive: vi.fn(), markSyncInactive: vi.fn(),
}));
vi.mock('../shared.js', () => ({
  safeParseJSON: x => x, resolveAgentRelations: vi.fn(), saveStepMessage: vi.fn(),
  setConversationProcessing: vi.fn(), getMaxOutputTokens: () => 100, fetchWithRateRetry: h.fetch,
}));
vi.mock('../sharedTools.js', () => ({
  getAllowedTools: async () => [], toAnthropicTools: vi.fn(), getAnthropicText: vi.fn(),
  sanitizeToolResult: vi.fn(), injectToolContext: vi.fn(),
}));
vi.mock('../sharedInteractionLog.js', () => ({ logInteraction: vi.fn() }));
vi.mock('../sharedClaudeCodeEvents.js', () => ({ buildClaudeCodeEventHandler: async () => ({ onEvent: vi.fn() }) }));
import runRouter from '../agentExecutionController.js';
import chatRouter from '../agentChatController.js';

beforeEach(() => {
  vi.clearAllMocks();
  h.dbGet.mockResolvedValue({ data: { name: 'Pilot' }, table_id: 1784, space_id: 11 });
  h.kimi.mockResolvedValue({ content: 'OK', usage: {} });
});
for (const [route, router] of [['/run', runRouter], ['/chat', chatRouter]]) {
  it(`${route} uses Kimi with the resolved agent identity, not an API-key fallback`, async () => {
    const handle = router.stack.find(layer => layer.route?.path === route).route.stack[0].handle;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handle({ body: { agentId: 42, message: 'test', spaceId: 999 }, user: { id: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(h.kimi).toHaveBeenCalledWith(expect.objectContaining({ agentId: 42, spaceId: 11 }));
    expect(h.fetch).not.toHaveBeenCalled();
  });
}
