// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  createLogCollector,
  normalizeLimits,
  truncateResult,
} from '../limits.js';

describe('codemode limits', () => {
  it('uses the ADR-206 defaults', () => {
    expect(normalizeLimits()).toEqual(DEFAULT_LIMITS);
  });

  it('clamps wall time, memory and tool calls to their maxima', () => {
    expect(normalizeLimits({ timeout_ms: 90_000, memory_mb: 1024, max_tool_calls: 500 })).toEqual({
      timeout_ms: 60_000,
      memory_mb: 256,
      max_tool_calls: 50,
    });
  });

  it('truncates oversized results to valid UTF-8 within 64 KB', () => {
    const out = truncateResult({ text: '🙂'.repeat(40_000) });
    expect(out.truncated).toBe(true);
    expect(typeof out.result).toBe('string');
    expect(Buffer.byteLength(out.result, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(out.result.endsWith('…')).toBe(true);
  });

  it('caps logs by lines and bytes', () => {
    const log = createLogCollector();
    for (let i = 0; i < 250; i += 1) log('log', ['x'.repeat(200)]);
    expect(log.lines().length).toBeLessThanOrEqual(200);
    expect(log.lines().length).toBeLessThan(250);
    expect(Buffer.byteLength(log.lines().join('\n'), 'utf8')).toBeLessThanOrEqual(16 * 1024);
  });
});
