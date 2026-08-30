// @vitest-environment node
/**
 * ADR-173 §B.2/B.3 — mail label rule evaluator.
 *
 * Pure unit test (no network/DB): field extraction, each operator (contains /
 * in_list / equals / regex), match any|all, manual-only (empty) rules, and the
 * regex DoS guards (length cap, catastrophic-shape rejection, invalid pattern).
 * Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import { describe, it, expect } from 'vitest';
import { matchesRules, matchingLabelIds, buildMatchFields, normalizeRules, RuleError, __testables } from '../../services/mail/labelRules.js';

const msg = {
  from_name: 'Boss Person',
  from_address: 'boss@acme.com',
  to_addresses: ['me@corp.io', 'team@corp.io'],
  subject: 'Q3 Invoice #42',
  body_text: 'Please review the договор attached.',
};

describe('buildMatchFields', () => {
  it('lowercases and joins from/to and builds `any`', () => {
    const f = buildMatchFields(msg);
    expect(f.from).toBe('boss@acme.com boss person');
    expect(f.to).toBe('me@corp.io team@corp.io');
    expect(f.subject).toBe('q3 invoice #42');
    expect(f.any).toContain('boss@acme.com');
    expect(f.any).toContain('договор');
  });

  it('handles a JSON-string to_addresses column and missing body', () => {
    const f = buildMatchFields({ to_addresses: 'x@y.com', subject: 'Hi' });
    expect(f.to).toBe('x@y.com');
    expect(f.body).toBe('');
  });
});

describe('matchesRules — operators', () => {
  it('contains is case-insensitive on the chosen field', () => {
    expect(matchesRules({ conditions: [{ field: 'subject', op: 'contains', value: 'invoice' }] }, msg)).toBe(true);
    expect(matchesRules({ conditions: [{ field: 'subject', op: 'contains', value: 'refund' }] }, msg)).toBe(false);
  });

  it('in_list matches an exact address and an @domain entry', () => {
    expect(matchesRules({ conditions: [{ field: 'from', op: 'in_list', value: ['x@z.com', 'boss@acme.com'] }] }, msg)).toBe(true);
    expect(matchesRules({ conditions: [{ field: 'from', op: 'in_list', value: ['@acme.com'] }] }, msg)).toBe(true);
    expect(matchesRules({ conditions: [{ field: 'from', op: 'in_list', value: ['@other.com'] }] }, msg)).toBe(false);
  });

  it('body contains a non-ASCII fragment', () => {
    expect(matchesRules({ conditions: [{ field: 'body', op: 'contains', value: 'договор' }] }, msg)).toBe(true);
  });

  it('equals compares the whole (trimmed, lowercased) field', () => {
    expect(matchesRules({ conditions: [{ field: 'from', op: 'equals', value: 'boss@acme.com boss person' }] }, msg)).toBe(true);
    expect(matchesRules({ conditions: [{ field: 'from', op: 'equals', value: 'boss@acme.com' }] }, msg)).toBe(false);
  });

  it('regex matches on `any`', () => {
    expect(matchesRules({ conditions: [{ field: 'any', op: 'regex', value: 'invoice\\s+#\\d+' }] }, msg)).toBe(true);
  });
});

describe('matchesRules — match any|all', () => {
  const rules = (match) => ({
    match,
    conditions: [
      { field: 'from', op: 'in_list', value: ['@acme.com'] }, // true
      { field: 'subject', op: 'contains', value: 'refund' }, // false
    ],
  });
  it('any = OR', () => expect(matchesRules(rules('any'), msg)).toBe(true));
  it('all = AND', () => expect(matchesRules(rules('all'), msg)).toBe(false));
  it('defaults to any when match omitted', () =>
    expect(matchesRules({ conditions: rules('any').conditions }, msg)).toBe(true));
});

describe('matchesRules — manual-only / malformed', () => {
  it('empty or absent conditions never match', () => {
    expect(matchesRules({}, msg)).toBe(false);
    expect(matchesRules({ conditions: [] }, msg)).toBe(false);
    expect(matchesRules(null, msg)).toBe(false);
  });
  it('unknown field/op is a non-match, not a throw', () => {
    expect(matchesRules({ conditions: [{ field: 'nope', op: 'contains', value: 'x' }] }, msg)).toBe(false);
    expect(matchesRules({ conditions: [{ field: 'subject', op: 'nope', value: 'x' }] }, msg)).toBe(false);
  });
});

describe('regex DoS guards', () => {
  it('rejects an over-long pattern', () => {
    expect(__testables.safeRegexTest('a'.repeat(201), 'aaaa')).toBe(false);
  });
  it('rejects textbook catastrophic shapes', () => {
    expect(__testables.looksCatastrophic('(a+)+')).toBe(true);
    expect(__testables.looksCatastrophic('(a*)*')).toBe(true);
    expect(__testables.looksCatastrophic('invoice\\s+#\\d+')).toBe(false);
  });
  it('an invalid pattern is a non-match, not a throw', () => {
    expect(__testables.safeRegexTest('(', 'anything')).toBe(false);
  });
});

describe('normalizeRules — API-boundary validation', () => {
  it('normalizes null/undefined/empty to a manual-only label', () => {
    expect(normalizeRules(null)).toEqual({ match: 'any', conditions: [] });
    expect(normalizeRules(undefined)).toEqual({ match: 'any', conditions: [] });
    expect(normalizeRules({})).toEqual({ match: 'any', conditions: [] });
  });

  it('keeps a valid rule and defaults match to any', () => {
    const r = normalizeRules({ conditions: [{ field: 'from', op: 'in_list', value: ['@acme.com', ' x@y.com '] }] });
    expect(r.match).toBe('any');
    expect(r.conditions[0]).toEqual({ field: 'from', op: 'in_list', value: ['@acme.com', 'x@y.com'] });
  });

  it('preserves match:all', () => {
    expect(normalizeRules({ match: 'all', conditions: [{ field: 'subject', op: 'contains', value: 'x' }] }).match).toBe('all');
  });

  it('rejects unknown field / op / empty value / bad in_list', () => {
    expect(() => normalizeRules({ conditions: [{ field: 'nope', op: 'contains', value: 'x' }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'subject', op: 'nope', value: 'x' }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'subject', op: 'contains', value: '' }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'from', op: 'in_list', value: [] }] })).toThrow(RuleError);
  });

  it('rejects an over-long / catastrophic / invalid regex', () => {
    expect(() => normalizeRules({ conditions: [{ field: 'any', op: 'regex', value: 'a'.repeat(201) }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'any', op: 'regex', value: '(a+)+' }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'any', op: 'regex', value: '(' }] })).toThrow(RuleError);
  });

  it('rejects a non-object rules and non-array conditions', () => {
    expect(() => normalizeRules([])).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: 'x' })).toThrow(RuleError);
  });
});

describe('matchingLabelIds', () => {
  const labels = [
    { id: 1, rules: { conditions: [{ field: 'from', op: 'in_list', value: ['@acme.com'] }] } },
    { id: 2, rules: '{"conditions":[{"field":"subject","op":"contains","value":"invoice"}]}' }, // JSON string
    { id: 3, rules: { conditions: [{ field: 'subject', op: 'contains', value: 'refund' }] } }, // no match
    { id: 4, enabled: false, rules: { conditions: [{ field: 'from', op: 'in_list', value: ['@acme.com'] }] } }, // disabled
    { id: 5, rules: {} }, // manual-only
  ];
  it('returns ids of enabled, matching, rule-bearing labels only', () => {
    expect(matchingLabelIds(labels, msg)).toEqual([1, 2]);
  });
});

describe('normalizeRules — CRUD boundary validation', () => {
  it('normalizes null/{} to a manual-only label', () => {
    expect(normalizeRules(null)).toEqual({ match: 'any', conditions: [] });
    expect(normalizeRules({})).toEqual({ match: 'any', conditions: [] });
  });

  it('coerces match to any|all and normalizes in_list to a clean array', () => {
    const out = normalizeRules({
      match: 'all',
      conditions: [{ field: 'from', op: 'in_list', value: [' a@b.com ', '', '@x.com'] }],
    });
    expect(out.match).toBe('all');
    expect(out.conditions[0].value).toEqual(['a@b.com', '@x.com']);
  });

  it('defaults an unknown match to any', () => {
    expect(normalizeRules({ match: 'weird', conditions: [] }).match).toBe('any');
  });

  it('rejects non-object rules, bad field/op, empty value', () => {
    expect(() => normalizeRules([])).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: {} })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'nope', op: 'contains', value: 'x' }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'subject', op: 'nope', value: 'x' }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'subject', op: 'contains', value: '' }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'from', op: 'in_list', value: [] }] })).toThrow(RuleError);
  });

  it('rejects a catastrophic / over-long / invalid regex up front', () => {
    expect(() => normalizeRules({ conditions: [{ field: 'any', op: 'regex', value: '(a+)+' }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'any', op: 'regex', value: 'a'.repeat(201) }] })).toThrow(RuleError);
    expect(() => normalizeRules({ conditions: [{ field: 'any', op: 'regex', value: '(' }] })).toThrow(RuleError);
    expect(normalizeRules({ conditions: [{ field: 'any', op: 'regex', value: 'inv\\d+' }] }).conditions[0].value).toBe('inv\\d+');
  });
});
