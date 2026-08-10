// @vitest-environment node
/**
 * ADR-165 WP-1 — Unified capability gate (pure decision layer).
 *
 * Pins:
 *  - No agent scope in context (system caller: MCP userId=1, human owner) → unrestricted.
 *  - Agent scope present + tool in allowlist → permitted, no violation.
 *  - Agent scope present + tool NOT in allowlist → violation.
 *      · warn-only (enforce=false): permitted (proceeds) but flagged for telemetry.
 *      · enforce (enforce=true): blocked.
 *  - Allowlist names read from BOTH OpenAI-shape ({function:{name}}) and flat ({name}) defs,
 *    since callers thread the same resolved `allowedTools` list they built for the LLM.
 */

import { describe, it, expect } from 'vitest';
import { resolveAllowlistNames, evaluateToolGate } from '../capability-gate.js';

const oaiTools = [
  { type: 'function', function: { name: 'query_table_data' } },
  { type: 'function', function: { name: 'get_table_schema' } },
];

describe('resolveAllowlistNames', () => {
  it('returns null when no context is provided (system caller)', () => {
    expect(resolveAllowlistNames(undefined)).toBeNull();
    expect(resolveAllowlistNames(null)).toBeNull();
  });

  it('returns null when context carries no allowedTools (system caller)', () => {
    expect(resolveAllowlistNames({ spaceId: 11, source: 'mcp' })).toBeNull();
  });

  it('returns null for an empty allowedTools array', () => {
    expect(resolveAllowlistNames({ allowedTools: [] })).toBeNull();
  });

  it('extracts names from OpenAI-shape tool defs', () => {
    const names = resolveAllowlistNames({ allowedTools: oaiTools });
    expect(names).toBeInstanceOf(Set);
    expect(names.has('query_table_data')).toBe(true);
    expect(names.has('get_table_schema')).toBe(true);
    expect(names.size).toBe(2);
  });

  it('also accepts flat {name} tool defs', () => {
    const names = resolveAllowlistNames({ allowedTools: [{ name: 'delete_table' }] });
    expect(names.has('delete_table')).toBe(true);
  });

  it('ignores malformed entries without a name', () => {
    const names = resolveAllowlistNames({ allowedTools: [null, {}, { function: {} }, { name: 'ok' }] });
    expect(names.size).toBe(1);
    expect(names.has('ok')).toBe(true);
  });
});

describe('evaluateToolGate', () => {
  const scoped = { allowedTools: oaiTools };

  it('permits any tool when no agent scope is present (unrestricted system caller)', () => {
    for (const enforce of [false, true]) {
      const gate = evaluateToolGate('delete_table', { spaceId: 11 }, enforce);
      expect(gate).toEqual({ permitted: true, violation: false });
    }
  });

  it('permits an in-allowlist tool with no violation', () => {
    for (const enforce of [false, true]) {
      const gate = evaluateToolGate('query_table_data', scoped, enforce);
      expect(gate).toEqual({ permitted: true, violation: false });
    }
  });

  it('warn-only: flags an out-of-allowlist tool as a violation but still permits it', () => {
    const gate = evaluateToolGate('delete_table', scoped, false);
    expect(gate).toEqual({ permitted: true, violation: true });
  });

  it('enforce: blocks an out-of-allowlist tool', () => {
    const gate = evaluateToolGate('delete_table', scoped, true);
    expect(gate).toEqual({ permitted: false, violation: true });
  });
});
