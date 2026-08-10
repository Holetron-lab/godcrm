// ADR-0011 · Phase E2 · Unit tests for tighten-only override validator (C-8).
//
// Covers all 7 enforcement rules per validateOverride.js:
//   1. cooldown_seconds       — RAISE only
//   2. required_methods       — RAISE only
//   3. guards                 — SUPERSET only (no removal)
//   4. available_methods      — SUBSET only (no addition)
//   5. ttl_seconds            — SHORTEN only (null base allows any positive)
//   6. rate_limit             — fewer attempts / longer window
//   7. policy                 — 'all' > 'any_n' (no downgrade)
//
// Plus edge cases: null override, infeasible required_methods, pass-through.

import { describe, it, expect } from 'vitest';
import { validateVerificationOverride } from '../validateOverride.js';

const BASE = Object.freeze({
  available_methods: ['totp', 'captcha'],
  required_methods: 1,
  cooldown_seconds: 300,
  cooldown_ms: 300000,
  ttl_seconds: 3600,
  ttl_ms: 3600000,
  locks_on_statuses: [],
  unlocks_on_statuses: [],
  guards: ['row_update_guard'],
  policy: 'any_n',
  rate_limit: { window_seconds: 60, max_attempts: 5 },
  method_config: {},
});

describe('validateVerificationOverride — null/empty', () => {
  it('null override → effective = base copy', () => {
    const r = validateVerificationOverride(BASE, null);
    expect(r.ok).toBe(true);
    expect(r.effective).toEqual(BASE);
  });

  it('undefined override → ok', () => {
    const r = validateVerificationOverride(BASE, undefined);
    expect(r.ok).toBe(true);
  });

  it('non-object override → reject', () => {
    expect(validateVerificationOverride(BASE, 'string').ok).toBe(false);
    expect(validateVerificationOverride(BASE, []).ok).toBe(false);
  });

  it('missing base → reject', () => {
    expect(validateVerificationOverride(null, {}).ok).toBe(false);
  });
});

describe('Rule 1 — cooldown_seconds (RAISE only)', () => {
  it('raise → accept', () => {
    const r = validateVerificationOverride(BASE, { cooldown_seconds: 600 });
    expect(r.ok).toBe(true);
    expect(r.effective.cooldown_seconds).toBe(600);
    expect(r.effective.cooldown_ms).toBe(600000);
  });

  it('equal → accept', () => {
    const r = validateVerificationOverride(BASE, { cooldown_seconds: 300 });
    expect(r.ok).toBe(true);
  });

  it('lower → reject', () => {
    const r = validateVerificationOverride(BASE, { cooldown_seconds: 60 });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('cooldown_seconds');
  });

  it('legacy cooldown_ms is converted', () => {
    const r = validateVerificationOverride(BASE, { cooldown_ms: 600000 });
    expect(r.ok).toBe(true);
    expect(r.effective.cooldown_seconds).toBe(600);
  });
});

describe('Rule 2 — required_methods (RAISE only)', () => {
  it('raise within available → accept', () => {
    const r = validateVerificationOverride(BASE, { required_methods: 2 });
    expect(r.ok).toBe(true);
    expect(r.effective.required_methods).toBe(2);
  });

  it('equal → accept', () => {
    const r = validateVerificationOverride(BASE, { required_methods: 1 });
    expect(r.ok).toBe(true);
  });

  it('lower → reject', () => {
    const base = { ...BASE, required_methods: 2 };
    const r = validateVerificationOverride(base, { required_methods: 1 });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('required_methods');
  });

  it('exceeds available_methods → reject (infeasible)', () => {
    const r = validateVerificationOverride(BASE, { required_methods: 5 });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('required_methods');
  });

  it('non-integer → reject', () => {
    const r = validateVerificationOverride(BASE, { required_methods: 1.5 });
    expect(r.ok).toBe(false);
  });
});

describe('Rule 3 — guards (SUPERSET only)', () => {
  it('superset → accept', () => {
    const r = validateVerificationOverride(BASE, { guards: ['row_update_guard', 'extra_guard'] });
    expect(r.ok).toBe(true);
    expect(r.effective.guards).toEqual(['row_update_guard', 'extra_guard']);
  });

  it('equal set → accept', () => {
    const r = validateVerificationOverride(BASE, { guards: ['row_update_guard'] });
    expect(r.ok).toBe(true);
  });

  it('drops base guard → reject', () => {
    const r = validateVerificationOverride(BASE, { guards: ['extra_guard'] });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('guards');
  });

  it('empty guards drops base → reject', () => {
    const r = validateVerificationOverride(BASE, { guards: [] });
    expect(r.ok).toBe(false);
  });
});

describe('Rule 4 — available_methods (SUBSET only)', () => {
  it('subset → accept', () => {
    const r = validateVerificationOverride(BASE, { available_methods: ['totp'] });
    expect(r.ok).toBe(true);
    expect(r.effective.available_methods).toEqual(['totp']);
  });

  it('adds new method not in base → reject', () => {
    const r = validateVerificationOverride(BASE, { available_methods: ['totp', 'sms'] });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('available_methods');
  });

  it('empty array → reject', () => {
    const r = validateVerificationOverride(BASE, { available_methods: [] });
    expect(r.ok).toBe(false);
  });

  it('shrinks below base required_methods → reject', () => {
    const base = { ...BASE, required_methods: 2 };
    const r = validateVerificationOverride(base, { available_methods: ['totp'] });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('required_methods');
  });
});

describe('Rule 5 — ttl_seconds (SHORTEN only)', () => {
  it('shorten → accept', () => {
    const r = validateVerificationOverride(BASE, { ttl_seconds: 1800 });
    expect(r.ok).toBe(true);
    expect(r.effective.ttl_seconds).toBe(1800);
  });

  it('lengthen → reject', () => {
    const r = validateVerificationOverride(BASE, { ttl_seconds: 7200 });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('ttl_seconds');
  });

  it('clear ttl when base set → reject', () => {
    const r = validateVerificationOverride(BASE, { ttl_seconds: null });
    expect(r.ok).toBe(false);
  });

  it('set ttl when base null → accept', () => {
    const base = { ...BASE, ttl_seconds: null, ttl_ms: null };
    const r = validateVerificationOverride(base, { ttl_seconds: 600 });
    expect(r.ok).toBe(true);
  });

  it('negative ttl → reject', () => {
    const r = validateVerificationOverride(BASE, { ttl_seconds: -1 });
    expect(r.ok).toBe(false);
  });
});

describe('Rule 6 — rate_limit (tighter only)', () => {
  it('fewer attempts → accept', () => {
    const r = validateVerificationOverride(BASE, { rate_limit: { window_seconds: 60, max_attempts: 3 } });
    expect(r.ok).toBe(true);
  });

  it('longer window → accept', () => {
    const r = validateVerificationOverride(BASE, { rate_limit: { window_seconds: 120, max_attempts: 5 } });
    expect(r.ok).toBe(true);
  });

  it('more attempts → reject', () => {
    const r = validateVerificationOverride(BASE, { rate_limit: { window_seconds: 60, max_attempts: 10 } });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('rate_limit.max_attempts');
  });

  it('shorter window → reject', () => {
    const r = validateVerificationOverride(BASE, { rate_limit: { window_seconds: 30, max_attempts: 5 } });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('rate_limit.window_seconds');
  });

  it('clear rate_limit when base set → reject', () => {
    const r = validateVerificationOverride(BASE, { rate_limit: null });
    expect(r.ok).toBe(false);
  });

  it('set rate_limit when base null → accept', () => {
    const base = { ...BASE, rate_limit: null };
    const r = validateVerificationOverride(base, { rate_limit: { window_seconds: 60, max_attempts: 3 } });
    expect(r.ok).toBe(true);
  });
});

describe('Rule 7 — policy (any_n → all only, never reverse)', () => {
  it('any_n → all → accept', () => {
    const r = validateVerificationOverride(BASE, { policy: 'all' });
    expect(r.ok).toBe(true);
    expect(r.effective.policy).toBe('all');
  });

  it('all → any_n → reject', () => {
    const base = { ...BASE, policy: 'all' };
    const r = validateVerificationOverride(base, { policy: 'any_n' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('policy');
  });

  it('invalid policy → reject', () => {
    const r = validateVerificationOverride(BASE, { policy: 'maybe' });
    expect(r.ok).toBe(false);
  });
});

describe('Pass-through fields', () => {
  it('locks_on_statuses passes through', () => {
    const r = validateVerificationOverride(BASE, { locks_on_statuses: ['done'] });
    expect(r.ok).toBe(true);
    expect(r.effective.locks_on_statuses).toEqual(['done']);
  });

  it('ADR-0003 extras pass through (required_reviewer_ids, screenshot_atom, diff_hash_match)', () => {
    const r = validateVerificationOverride(BASE, {
      required_reviewer_ids: [42, 99],
      screenshot_atom: 'atoms/abc',
      diff_hash_match: true,
    });
    expect(r.ok).toBe(true);
    expect(r.effective.required_reviewer_ids).toEqual([42, 99]);
    expect(r.effective.screenshot_atom).toBe('atoms/abc');
    expect(r.effective.diff_hash_match).toBe(true);
  });

  it('method_config merged with base', () => {
    const base = { ...BASE, method_config: { totp: { window: 1 } } };
    const r = validateVerificationOverride(base, { method_config: { captcha: { provider: 'h' } } });
    expect(r.ok).toBe(true);
    expect(r.effective.method_config).toEqual({
      totp: { window: 1 },
      captcha: { provider: 'h' },
    });
  });
});
