/**
 * ADR-0042 Task 4 — eventTranslator unit tests.
 *
 * Pure module: no DB, no spawn. Boot guard from backend/test/setup.js still
 * runs (vitest setupFiles).
 *
 * Coverage gates per Task 4 brief — ≥10 cases:
 *   - output → message_start
 *   - output with tool_use marker → tool_use (regex hit)
 *   - output with no marker / non-string content → message_start (regex miss)
 *   - result → message_stop
 *   - error → error (with message preserved)
 *   - info → null (skip)
 *   - unknown / non-object / null / missing-type → null (defensive)
 *   - mcp__ tool name (double-underscore namespace) → tool_use
 *   - stream-json passthrough mode (env-flip)
 *   - warnLegacyOnce only prints once per process
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  eventTranslator,
  warnLegacyOnce,
  _resetLegacyWarnForTest,
  DEFAULT_BACKSTOP_MS,
} from '../run-stream-handler.mjs';

describe('ADR-0042 eventTranslator — basics', () => {
  it('exports DEFAULT_BACKSTOP_MS = 4 hours', () => {
    expect(DEFAULT_BACKSTOP_MS).toBe(4 * 60 * 60 * 1000);
  });

  it('output → message_start (no tool marker)', () => {
    const out = eventTranslator({ type: 'output', content: 'hello world', status: 'success', exit: 0 });
    expect(out).toEqual({ type: 'message_start' });
  });

  it('output with tool_use JSON marker → tool_use event', () => {
    const text = 'thinking...\n{"type":"tool_use","name":"Bash","input":{"cmd":"ls"}}';
    const out = eventTranslator({ type: 'output', content: text });
    expect(out).toMatchObject({ type: 'tool_use', name: 'Bash' });
  });

  it('output with mcp__ tool name preserves double-underscore namespace', () => {
    const text = '{"type":"tool_use","name":"mcp__godcrm__update_table_row","input":{}}';
    const out = eventTranslator({ type: 'output', content: text });
    expect(out).toMatchObject({ type: 'tool_use', name: 'mcp__godcrm__update_table_row' });
  });

  it('output with non-string content → plain message_start', () => {
    const out = eventTranslator({ type: 'output', content: { not: 'a string' } });
    expect(out).toEqual({ type: 'message_start' });
  });

  it('output empty content → plain message_start', () => {
    const out = eventTranslator({ type: 'output', content: '' });
    expect(out).toEqual({ type: 'message_start' });
  });

  it('result → message_stop', () => {
    const out = eventTranslator({ type: 'result', status: 'success', ticket_id: 1, exit: 0 });
    expect(out).toEqual({ type: 'message_stop' });
  });

  it('error → error event with message preserved', () => {
    const out = eventTranslator({ type: 'error', message: 'workspace_missing' });
    expect(out).toEqual({ type: 'error', message: 'workspace_missing' });
  });

  it('error with non-string message → empty string', () => {
    const out = eventTranslator({ type: 'error', message: { code: 7 } });
    expect(out).toEqual({ type: 'error', message: '' });
  });
});

describe('ADR-0042 eventTranslator — null returns', () => {
  it('info → null (skipped)', () => {
    expect(eventTranslator({ type: 'info', message: 'runner_starting' })).toBeNull();
  });

  it('unknown event type → null', () => {
    expect(eventTranslator({ type: 'wibble' })).toBeNull();
  });

  it('null input → null', () => {
    expect(eventTranslator(null)).toBeNull();
  });

  it('undefined input → null', () => {
    expect(eventTranslator(undefined)).toBeNull();
  });

  it('non-object input → null', () => {
    expect(eventTranslator('result')).toBeNull();
    expect(eventTranslator(42)).toBeNull();
  });

  it('object missing `type` field → null', () => {
    expect(eventTranslator({ content: 'orphan' })).toBeNull();
  });

  it('object with non-string `type` → null', () => {
    expect(eventTranslator({ type: 7 })).toBeNull();
  });
});

describe('ADR-0042 eventTranslator — tool_use regex edge cases', () => {
  it('does NOT match a malformed name (numeric only)', () => {
    const text = '{"type":"tool_use","name":"42","input":{}}';
    const out = eventTranslator({ type: 'output', content: text });
    // 42 fails the [A-Za-z_][\w]* anchor → falls back to message_start
    expect(out).toEqual({ type: 'message_start' });
  });

  it('matches the first tool_use when content has multiple', () => {
    const text =
      '{"type":"tool_use","name":"Read","input":{}} ' +
      'and later {"type":"tool_use","name":"Edit","input":{}}';
    const out = eventTranslator({ type: 'output', content: text });
    expect(out).toMatchObject({ type: 'tool_use', name: 'Read' });
  });

  it('content with only the word "tool_use" but no JSON → message_start', () => {
    const out = eventTranslator({
      type: 'output',
      content: 'I considered using a tool_use but decided against it.',
    });
    // No name match possible → plain message_start.
    expect(out).toEqual({ type: 'message_start' });
  });
});

describe('ADR-0042 eventTranslator — stream-json passthrough', () => {
  // The translator reads STREAM_FORMAT at module load. We can't easily flip
  // it mid-test without re-importing the module — vi.resetModules + dynamic
  // import is the standard pattern.
  it('passes Anthropic stream-json events through unchanged when AGENT_STREAM_FORMAT=stream-json', async () => {
    vi.resetModules();
    const prev = process.env.AGENT_STREAM_FORMAT;
    process.env.AGENT_STREAM_FORMAT = 'stream-json';
    try {
      const mod = await import('../run-stream-handler.mjs');
      const evt = { type: 'message_start', message: { id: 'msg_1' } };
      expect(mod.eventTranslator(evt)).toBe(evt);
      // info also passes through (not translated).
      const info = { type: 'info', message: 'x' };
      expect(mod.eventTranslator(info)).toBe(info);
    } finally {
      if (prev === undefined) delete process.env.AGENT_STREAM_FORMAT;
      else process.env.AGENT_STREAM_FORMAT = prev;
      vi.resetModules();
    }
  });
});

describe('ADR-0042 warnLegacyOnce', () => {
  let warnSpy;
  beforeEach(() => {
    _resetLegacyWarnForTest();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    _resetLegacyWarnForTest();
  });

  it('prints exactly once on repeated calls in legacy mode', () => {
    warnLegacyOnce();
    warnLegacyOnce();
    warnLegacyOnce();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('AGENT_STREAM_FORMAT=legacy');
  });
});
