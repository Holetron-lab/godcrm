// @vitest-environment node
/**
 * DCD fast-guardrail contract (ADR-157), shadow-mode rule-of-thumb.
 *
 * Pins:
 *  - retrieved context that shares the query's terms → grounded
 *  - retrieved context disjoint from the query → not grounded (the hallucination
 *    case the guardrail exists to flag)
 *  - empty recall → not grounded ("no retrieved context")
 *  - a contentless query is not flagged (cannot assess)
 *  - the verdict is pure data — never mutates inputs (shadow mode)
 *
 * Adaptive head (ADR-157 amendment — adaptive-head replaces fixed 150-window):
 *  - a near-front hit settles cheap (inspectedTokens stays small)
 *  - support living PAST the old fixed window is still found (window expands)
 *  - "not grounded" is only declared after the whole context is inspected
 *    (inspectedTokens === totalTokens) — the honest-exhaustion guarantee
 */
import { describe, it, expect } from 'vitest';
import { assessGrounding, GROUNDING_THRESHOLD } from '../fastGuardrail.js';

describe('assessGrounding', () => {
  it('marks context grounded when it shares the query terms', () => {
    const v = assessGrounding('how is the deploy pipeline configured', [
      { text: 'the deploy pipeline runs on pm2 and is configured per release' },
    ]);
    expect(v.grounded).toBe(true);
    expect(v.score).toBeGreaterThanOrEqual(GROUNDING_THRESHOLD);
  });

  it('flags ungrounded context disjoint from the query', () => {
    const v = assessGrounding('what are the vacation payroll rules', [
      { text: 'nginx restarts when the docker container exits unexpectedly' },
    ]);
    expect(v.grounded).toBe(false);
    expect(v.reason).toMatch(/no grounding/i);
  });

  it('returns not-grounded with no retrieved context', () => {
    const v = assessGrounding('anything', []);
    expect(v.grounded).toBe(false);
    expect(v.reason).toMatch(/no retrieved context/i);
  });

  it('does not flag a query with no content terms', () => {
    const v = assessGrounding('what is it', [{ text: 'some unrelated memory' }]);
    expect(v.grounded).toBe(true);
    expect(v.reason).toMatch(/not assessable/i);
  });

  it('is pure — does not mutate the inputs (shadow mode)', () => {
    const memories = [{ text: 'deploy pipeline release' }];
    const snapshot = JSON.stringify(memories);
    assessGrounding('deploy pipeline', memories);
    expect(JSON.stringify(memories)).toBe(snapshot);
  });

  it('settles a front-loaded hit cheaply — inspects far fewer than total tokens', () => {
    // Query terms appear in the first sentence; a long tail follows. The
    // adaptive head must accept early without reading the whole context.
    const tail = Array.from({ length: 300 }, (_, i) => `filler${i}`).join(' ');
    const v = assessGrounding('deploy pipeline pm2', [
      { text: `the deploy pipeline runs on pm2 per release. ${tail}` },
    ]);
    expect(v.grounded).toBe(true);
    expect(v.inspectedTokens).toBeLessThan(v.totalTokens);
    expect(v.inspectedTokens).toBeLessThanOrEqual(40); // first probe window
  });

  it('expands to find support living PAST the old fixed 150-token window', () => {
    // Support sits at ~token 200 — beyond the retired HEAD_TOKENS=150 cutoff.
    // The fixed window would have falsely reported "no grounding"; the adaptive
    // head doubles past it and finds the hit.
    const filler = Array.from({ length: 200 }, (_, i) => `noise${i}`).join(' ');
    const v = assessGrounding('vacation payroll', [
      { text: `${filler} the vacation payroll rules are documented here` },
    ]);
    expect(v.grounded).toBe(true);
    expect(v.inspectedTokens).toBeGreaterThan(150);
  });

  it('rejects only after exhausting the whole context (honest exhaustion)', () => {
    const v = assessGrounding('quantum cryptography lattice', [
      { text: 'the deploy pipeline runs on pm2 and nginx restarts on crash' },
    ]);
    expect(v.grounded).toBe(false);
    expect(v.reason).toMatch(/no grounding/i);
    // Honest reject: we read everything available before saying "not grounded".
    expect(v.inspectedTokens).toBe(v.totalTokens);
  });

  it('caps inspection at HEAD_MAX on very large ungrounded context', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `token${i}`).join(' ');
    const v = assessGrounding('unrelatedterm anotherterm', [{ text: huge }]);
    expect(v.grounded).toBe(false);
    expect(v.inspectedTokens).toBeLessThanOrEqual(600); // HEAD_MAX safety cap
  });
});
