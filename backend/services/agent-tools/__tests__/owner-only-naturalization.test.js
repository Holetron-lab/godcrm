// @vitest-environment node
/**
 * ADR-165 WP-4 — owner-gated naturalization & principal identity.
 *
 * Pins the two halves of the fix:
 *
 *  D1 (executor) — `issue_passport` / `revoke_passport` are refused for every
 *  principal except a verified human owner. The refusal happens BEFORE the
 *  WP-1 capability gate, so it is independent of an agent's allowlist and of
 *  AGENT_TOOL_ALLOWLIST_ENFORCE, and it performs no write (AC-1, AC-2).
 *
 *  D3 (handlers) — the recorded actor comes from the call's principal, not
 *  from `userId`. On the MCP transport `userId` is 1 by construction, which is
 *  how machine acts came to be signed with the owner's name (AC-5).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockIssue = vi.fn();
const mockRevoke = vi.fn();

vi.mock('../../agent-users.js', () => ({
  issuePassport: (...a) => mockIssue(...a),
  revokePassport: (...a) => mockRevoke(...a),
}));

import { executeTool } from '../executor.js';
import { passportToolHandlers } from '../passport-tools.js';
import { isOwnerPrincipal, resolvePrincipal } from '../principal.js';

// The context the MCP transport builds after D2.
const MCP_CONTEXT = {
  spaceId: 11,
  source: 'mcp',
  principal: { kind: 'system', label: 'mcp-system', userId: null },
};

beforeEach(() => {
  mockIssue.mockReset();
  mockRevoke.mockReset();
  mockIssue.mockResolvedValue({ ok: true, changed: true, user_id: 900, handle: 'ralph' });
  mockRevoke.mockResolvedValue({ ok: true, changed: true, user_id: 900, prior_handle: 'ralph' });
});

describe('AC-1 — the MCP transport cannot naturalize', () => {
  it('refuses issue_passport over MCP and performs no write', async () => {
    const res = await executeTool('issue_passport', { handle: 'ralph' }, 1, MCP_CONTEXT);

    expect(res.error).toBe('owner_only_tool');
    expect(res.tool).toBe('issue_passport');
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('refuses revoke_passport over MCP and performs no write', async () => {
    const res = await executeTool('revoke_passport', { handle: 'ralph' }, 1, MCP_CONTEXT);

    expect(res.error).toBe('owner_only_tool');
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('refuses a pre-D2 MCP context that declares no principal at all', async () => {
    // Absence of a claim is never read as ownership — that was the bug.
    const res = await executeTool('issue_passport', {}, 1, { spaceId: 11, source: 'mcp' });

    expect(res.error).toBe('owner_only_tool');
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('refuses a caller with no context whatsoever', async () => {
    const res = await executeTool('issue_passport', {}, 1, undefined);

    expect(res.error).toBe('owner_only_tool');
    expect(mockIssue).not.toHaveBeenCalled();
  });
});

describe('AC-2 — an agent principal is refused regardless of its allowlist', () => {
  it('refuses even when the tool IS in the agent allowlist (gate would permit)', async () => {
    const res = await executeTool('issue_passport', {}, 1, {
      agentId: 42,
      agentName: 'ralph',
      allowedTools: [{ name: 'issue_passport' }, { name: 'query_table_data' }],
    });

    expect(res.error).toBe('owner_only_tool');
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('refuses an agent that also claims to be the owner in its own context', async () => {
    const res = await executeTool('issue_passport', {}, 1, {
      agentId: 42,
      principal: { kind: 'human_owner', userId: 1 },
    });

    expect(res.error).toBe('owner_only_tool');
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('is independent of AGENT_TOOL_ALLOWLIST_ENFORCE (checked before the gate)', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_TOOL_ALLOWLIST_ENFORCE', 'true');
    const { executeTool: enforcedExecuteTool } = await import('../executor.js');

    const res = await enforcedExecuteTool('issue_passport', {}, 1, MCP_CONTEXT);

    expect(res.error).toBe('owner_only_tool');
    expect(mockIssue).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe('AC-3/AC-5 — a verified owner principal passes, and attribution is truthful', () => {
  it('lets a human-owner principal through and stamps the real user id', async () => {
    const res = await executeTool('issue_passport', { handle: 'ralph' }, 1, {
      principal: { kind: 'human_owner', userId: 1 },
    });

    expect(res.ok).toBe(true);
    expect(mockIssue).toHaveBeenCalledTimes(1);
    expect(mockIssue.mock.calls[0][0]).toMatchObject({ actor: 1, actor_label: null });
  });

  it('never signs a system act with the owner id, even forced past D1', async () => {
    // Regression fixture for AC-5: the exact MCP self-issue call, invoked
    // directly on the handler so D1 cannot mask a bad stamp underneath it.
    await passportToolHandlers.issue_passport({ handle: 'ralph' }, 1, MCP_CONTEXT);

    const stamp = mockIssue.mock.calls[0][0];
    expect(stamp.actor).toBeNull();
    expect(stamp.actor_label).toBe('mcp-system');
  });

  it('records a null actor for a revoke on the system transport too', async () => {
    await passportToolHandlers.revoke_passport({ handle: 'ralph' }, 1, MCP_CONTEXT);

    const stamp = mockRevoke.mock.calls[0][0];
    expect(stamp.actor).toBeNull();
    expect(stamp.actor_label).toBe('mcp-system');
  });
});

describe('AC-7 — the blast radius stays at two tools', () => {
  it('does not change behaviour for a non-OWNER_ONLY tool on the MCP path', async () => {
    const res = await executeTool('definitely_not_a_tool', {}, 1, MCP_CONTEXT);

    // Still the plain unknown-tool answer — not an owner refusal.
    expect(res.error).toBe('Unknown tool: definitely_not_a_tool');
  });
});

describe('principal resolution (pure)', () => {
  it('reads a declared principal', () => {
    expect(resolvePrincipal(MCP_CONTEXT)).toEqual({
      kind: 'system',
      label: 'mcp-system',
      userId: null,
    });
  });

  it('infers an agent principal from an agent scope', () => {
    expect(resolvePrincipal({ agentId: 42, agentName: 'ralph' })).toMatchObject({ kind: 'agent' });
  });

  it('reports an undeclared principal as unknown, never as owner', () => {
    expect(resolvePrincipal({ spaceId: 11 })).toMatchObject({ kind: 'unknown' });
    expect(isOwnerPrincipal({ spaceId: 11 })).toBe(false);
    expect(isOwnerPrincipal({ principal: { kind: 'human_owner', userId: 1 } })).toBe(true);
  });
});
