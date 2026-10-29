// @vitest-environment node
import { it, expect, vi, beforeEach } from 'vitest';
const dbGet = vi.hoisted(() => vi.fn());
vi.mock('../../../database/connection.js', () => ({dbGet,safeJsonParse:(v,d) => typeof v === 'string' ? JSON.parse(v) : v || d}));
import { canAccessHistoricalChat, historicalChatGuard, guardHistoricalTool } from '../historical-access.js';
beforeEach(() => dbGet.mockReset());
it('allows ordinary chats through unchanged and refuses an outsider on an imported chat', async () => {
  dbGet.mockResolvedValueOnce({settings:'{}'});
  expect(await canAccessHistoricalChat(50,22)).toBe(true);
  dbGet.mockResolvedValueOnce({settings:JSON.stringify({historical_import:{key:'source'}})}).mockResolvedValueOnce(null);
  expect(await canAccessHistoricalChat(50,22)).toBe(false);
});
it('does not let the MCP transport identity stand in for an agent participant', async () => {
  dbGet.mockResolvedValueOnce({settings:{historical_import:{key:'source'}}}).mockResolvedValueOnce({id:79}).mockResolvedValueOnce(null);
  expect(await canAccessHistoricalChat(50,1,{agentId:110507,source:'mcp'})).toBe(false);
  expect(dbGet.mock.calls.at(-1)[1]).toEqual([50,79]);
});
it('denies steps/messages through the router before reaching the handler', async () => {
  dbGet.mockResolvedValueOnce({settings:{historical_import:{key:'source'}}}).mockResolvedValueOnce(null);
  const res = {status:vi.fn().mockReturnThis(),json:vi.fn()}, next=vi.fn();
  await historicalChatGuard({params:{id:'50'},user:{id:22}},res,next);
  expect(res.status).toHaveBeenCalledWith(404); expect(next).not.toHaveBeenCalled();
});
it('guards message-id introspection tools as well as conversation-id tools', async () => {
  dbGet.mockResolvedValueOnce({conversation_id:50}).mockResolvedValueOnce({settings:{historical_import:{key:'source'}}}).mockResolvedValueOnce(null);
  expect(await guardHistoricalTool('view_step_detail',{message_id:123},22,{})).toBe(false);
});
it('does not expose imported table rows through an MCP transport identity', async () => {
  dbGet.mockResolvedValueOnce({settings:{historical_import:{key:'source'}}})
    .mockResolvedValueOnce({id:50}).mockResolvedValueOnce({settings:{historical_import:{key:'source'}}});
  expect(await guardHistoricalTool('query_table_data',{table_id:70},17,{source:'mcp'})).toBe(false);
});
it('keeps ordinary table tools unchanged', async () => {
  dbGet.mockResolvedValueOnce({settings:'{}'});
  expect(await guardHistoricalTool('query_table_data',{table_id:70},17,{})).toBe(true);
});
