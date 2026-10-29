// @vitest-environment node
// Bug 1552/228714 (Fleet Audit WP-6): `<</slug>>` resolves by the agent row's
// own `slug` key, not only by the slug derived from `name`. Before this,
// `<</marketer>>` never matched "Marketing Strategist" (name-slug
// `marketing-strategist`) even though the row carries slug = marketer.
import { describe, it, expect, vi } from 'vitest';

const rows = [
  { row_id: 44465, data: JSON.stringify({ name: 'Marketing Strategist', slug: 'marketer', status: 'active' }) },
  { row_id: 33484, data: JSON.stringify({ name: 'SysAdmin', slug: 'sysadmin', status: 'active' }) },
  { row_id: 166709, data: JSON.stringify({ name: 'Crypto Ralph', slug: 'cryptoralph-ton', status: 'inactive' }) },
  { row_id: 33487, data: JSON.stringify({ name: 'Table Architect', status: 'active' }) },
];

vi.mock('../chatShared.js', () => ({
  dbRun: vi.fn(), dbGet: vi.fn(), dbAll: vi.fn(async () => rows),
  isPostgres: () => true,
  safeJsonParse: (s, d) => { try { return JSON.parse(s); } catch { return d; } },
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  _resolveAgentUserService: vi.fn(async () => null),
}));
vi.mock('../chatAgentSubAgents.js', () => ({
  validateSubAgentRowIds: vi.fn(), enrichSubAgents: vi.fn(),
  autoJoinAgentToConversation: vi.fn(), resolveAgentInfoForMessages: vi.fn(),
}));

const { findAiAgentByCommand } = await import('../chatAgentHelpers.js');

describe('findAiAgentByCommand', () => {
  it('matches the row slug', async () => {
    const agent = await findAiAgentByCommand('marketer');
    expect(agent?.managed_by_agent_row_id).toBe(44465);
    expect(agent._agentConfig.slug).toBe('marketer');
  });

  it('still matches the name-derived slug when the row has no slug', async () => {
    const agent = await findAiAgentByCommand('table-architect');
    expect(agent?.managed_by_agent_row_id).toBe(33487);
  });

  it('skips inactive agents even on a slug match', async () => {
    expect(await findAiAgentByCommand('cryptoralph-ton')).toBeNull();
  });

  it('returns null for an unknown command', async () => {
    expect(await findAiAgentByCommand('nobody')).toBeNull();
  });
});
