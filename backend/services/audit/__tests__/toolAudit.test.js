// backend/services/audit/__tests__/toolAudit.test.js
//
// ADR-0066-B — unit tests for agent tool-call audit policy.
//
// Test isolation (ADR-0009): writeAudit is mocked — no DB, no chain append.
// These tests pin the two things that make the provenance trail trustworthy:
// the fail-closed classifier, and the fact that a credential can never ride
// into an audit row.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeAudit = vi.fn().mockResolvedValue(undefined);
vi.mock('../writeAudit.js', () => ({ writeAudit, default: writeAudit }));

const { auditToolCall, shouldAuditTool, redactSecrets, AUDIT_EXEMPT_TOOLS } =
  await import('../toolAudit.js');

beforeEach(() => writeAudit.mockClear());

const lastEntry = () => writeAudit.mock.calls.at(-1)[1];
const lastReq = () => writeAudit.mock.calls.at(-1)[0];

describe('shouldAuditTool — fail-closed classifier', () => {
  it('exempts a pure read', () => {
    expect(shouldAuditTool('query_table_data')).toBe(false);
    expect(shouldAuditTool('list_tables')).toBe(false);
  });

  it('audits a mutation', () => {
    expect(shouldAuditTool('create_table')).toBe(true);
    expect(shouldAuditTool('delete_project_cascade')).toBe(true);
  });

  // The regression this guards: a tool added later must not escape the audit
  // trail just because nobody classified it. Unknown → audited.
  it('audits an unknown tool rather than skipping it', () => {
    expect(shouldAuditTool('some_tool_invented_next_quarter')).toBe(true);
  });

  it('audits outward-facing and spending tools, not just DB writes', () => {
    for (const t of ['send_telegram_message', 'slack_post_message', 'write_file',
      'printer_start', 'replicate_image_generate', 'revoke_passport']) {
      expect(shouldAuditTool(t), t).toBe(true);
    }
  });

  it('ignores a missing/empty tool name', () => {
    expect(shouldAuditTool(undefined)).toBe(false);
    expect(shouldAuditTool('')).toBe(false);
  });

  it('exempt set contains no obvious mutation verb', () => {
    for (const name of AUDIT_EXEMPT_TOOLS) {
      if (name === '_resetCascadePreviewsForTests') continue;
      expect(name, name).not.toMatch(/^(create|update|delete|add|batch|move|copy|send|upsert|write|edit|revoke|issue)_/);
    }
  });
});

describe('redactSecrets', () => {
  it('redacts credential-looking keys at any depth, keeps everything else', () => {
    const out = redactSecrets({
      table_id: 1708,
      api_key: 'sk-live-xxx',
      nested: { access_token: 'tok', label: 'keep me' },
      list: [{ password: 'p' }, { ok: 1 }],
    });
    expect(out.table_id).toBe(1708);
    expect(out.api_key).toBe('[redacted]');
    expect(out.nested.access_token).toBe('[redacted]');
    expect(out.nested.label).toBe('keep me');
    expect(out.list[0].password).toBe('[redacted]');
    expect(out.list[1].ok).toBe(1);
  });

  it('does not mutate the caller’s object', () => {
    const input = { api_key: 'secret' };
    redactSecrets(input);
    expect(input.api_key).toBe('secret');
  });

  it('terminates on deeply nested input', () => {
    let deep = { leaf: 1 };
    for (let i = 0; i < 50; i++) deep = { next: deep };
    expect(() => redactSecrets(deep)).not.toThrow();
  });
});

describe('auditToolCall', () => {
  const ctx = { agentId: 42, agentName: 'developer-ralph', spaceId: 11, conversationId: 3633 };

  it('writes nothing for an exempt tool', async () => {
    await auditToolCall({ toolName: 'query_table_data', args: {}, userId: 1, context: ctx, result: {} });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('records the delegated agent identity alongside the credential', async () => {
    await auditToolCall({
      toolName: 'create_table', args: { name: 'T' }, userId: 1, context: ctx,
      result: { table_id: 9 }, durationMs: 12,
    });

    expect(writeAudit).toHaveBeenCalledTimes(1);
    // The credential used…
    expect(lastReq().user).toEqual({ id: 1 });
    // …and the actor that used it. Both, or the trail is a lie.
    expect(lastReq().agentId).toBe(42);
    expect(lastReq().agentName).toBe('developer-ralph');
    expect(lastReq().spaceId).toBe(11);

    const entry = lastEntry();
    expect(entry.action).toBe('tool.create_table');
    expect(entry.entity_type).toBe('agent_tool');
    expect(entry.entity_id).toBe('create_table');
    expect(entry.details).toMatchObject({
      ok: true, args: { name: 'T' }, error: null, duration_ms: 12, conversation_id: 3633,
    });
  });

  it('marks a structured {error} return as a failure, not a success', async () => {
    await auditToolCall({
      toolName: 'delete_table', args: { table_id: 5 }, userId: 1, context: ctx,
      result: { error: 'tool_not_permitted' },
    });
    expect(lastEntry().details.ok).toBe(false);
    expect(lastEntry().details.error).toBe('tool_not_permitted');
  });

  it('records a thrown error', async () => {
    await auditToolCall({
      toolName: 'update_table_row', args: {}, userId: 1, context: ctx,
      thrown: new Error('connection reset'),
    });
    expect(lastEntry().details.ok).toBe(false);
    expect(lastEntry().details.error).toBe('connection reset');
  });

  it('never lets an injected connector credential reach the audit row', async () => {
    await auditToolCall({
      toolName: 'slack_post_message',
      args: { channel: '#ops', token: 'xoxb-leak' },
      userId: 1,
      // ADR-0028 attaches a live access_token to context — audit reads args only.
      context: { ...ctx, injected_connector: { access_token: 'xoxb-secret' } },
      result: { ok: true },
    });
    const serialized = JSON.stringify(writeAudit.mock.calls.at(-1));
    expect(serialized).not.toContain('xoxb-secret');
    expect(serialized).not.toContain('xoxb-leak');
  });

  it('survives a missing agent context (human/system caller)', async () => {
    await auditToolCall({ toolName: 'create_table', args: {}, userId: 1, context: null, result: {} });
    expect(lastReq().agentId).toBeNull();
    expect(lastEntry().details.ok).toBe(true);
  });
});
