// @vitest-environment node
// Bug 1552/228714 (Fleet Audit WP-6, ADR-203 D4): CLI run timeout comes from
// the agent row (`run_timeout_min`), with a 10-minute default for <</slug>>
// one-shot runs and the legacy 30 minutes for everything else.
import { describe, it, expect } from 'vitest';
import { resolveRunTimeoutMin, resolveRunTimeoutMs } from '../run-timeout.js';

describe('resolveRunTimeoutMin', () => {
  it('uses the agent row value when set', () => {
    expect(resolveRunTimeoutMin({ run_timeout_min: 45 }, 'command')).toBe(45);
    expect(resolveRunTimeoutMin({ run_timeout_min: '7' }, null)).toBe(7);
  });

  it('defaults to 10 min for /command runs and 30 min otherwise', () => {
    expect(resolveRunTimeoutMin({}, 'command')).toBe(10);
    expect(resolveRunTimeoutMin({}, 'mention')).toBe(30);
    expect(resolveRunTimeoutMin({}, null)).toBe(30);
    expect(resolveRunTimeoutMin(undefined, undefined)).toBe(30);
  });

  it('ignores empty, zero, negative and junk values', () => {
    for (const bad of ['', null, 0, -5, 'abc', NaN]) {
      expect(resolveRunTimeoutMin({ run_timeout_min: bad }, 'command')).toBe(10);
    }
  });

  it('resolveRunTimeoutMs is minutes × 60 000', () => {
    expect(resolveRunTimeoutMs({ run_timeout_min: 2 }, null)).toBe(120_000);
    expect(resolveRunTimeoutMs({}, 'command')).toBe(600_000);
  });
});
