// @vitest-environment node
/**
 * ADR-165 WP-2b — cost_limit_usd budget gate (pure decision layer).
 *
 * Pins:
 *  - mergeBudget accepts cost_limit_usd (positive number, incl. fractional $),
 *    rejects non-positive / non-finite / non-numeric, and honours override order.
 *  - budgetTripped adds the cost check symmetric with token_limit, LAST in order.
 *  - HARD INVARIANT: cost_limit_usd absent (or 0 cost) → cost never trips → no cap.
 *
 * Enforcement policy (warn-only soak vs halt behind AGENT_COST_LIMIT_ENFORCE)
 * lives in agent-loop/loop.js, not here — budgetTripped is the pure detector.
 */

import { describe, it, expect } from 'vitest';
import { mergeBudget, budgetTripped, HARNESS_BUDGET_DEFAULTS } from '../budgets.js';

// A "clean" counters + far-future start so only the field under test can trip.
const clean = { steps: 0, tool_calls: 0, tokens: 0, cost_usd: 0 };
const now = () => Date.now();

describe('mergeBudget — cost_limit_usd', () => {
  it('accepts a positive cost_limit_usd (including fractional dollars)', () => {
    expect(mergeBudget({ cost_limit_usd: 5 }).cost_limit_usd).toBe(5);
    expect(mergeBudget({ cost_limit_usd: 0.25 }).cost_limit_usd).toBe(0.25);
  });

  it('rejects non-positive / non-finite / non-numeric cost_limit_usd', () => {
    expect(mergeBudget({ cost_limit_usd: 0 }).cost_limit_usd).toBeUndefined();
    expect(mergeBudget({ cost_limit_usd: -3 }).cost_limit_usd).toBeUndefined();
    expect(mergeBudget({ cost_limit_usd: 'lots' }).cost_limit_usd).toBeUndefined();
    expect(mergeBudget({ cost_limit_usd: NaN }).cost_limit_usd).toBeUndefined();
    expect(mergeBudget({ cost_limit_usd: Infinity }).cost_limit_usd).toBeUndefined();
  });

  it('is absent by default (no cap unless configured) and parses from JSON string', () => {
    expect(mergeBudget().cost_limit_usd).toBeUndefined();
    expect(mergeBudget('{"cost_limit_usd": 2}').cost_limit_usd).toBe(2);
  });

  it('later source overrides earlier (dispatch override wins)', () => {
    expect(mergeBudget({ cost_limit_usd: 5 }, { cost_limit_usd: 1 }).cost_limit_usd).toBe(1);
    // preserves the frozen hard-limit defaults alongside the new field
    expect(mergeBudget({ cost_limit_usd: 5 }).step_limit).toBe(HARNESS_BUDGET_DEFAULTS.step_limit);
  });
});

describe('budgetTripped — cost_limit_usd', () => {
  const budget = mergeBudget({ cost_limit_usd: 1.0 }); // hard limits at defaults

  it('trips when accumulated cost >= cost_limit_usd', () => {
    expect(budgetTripped({ ...clean, cost_usd: 1.0 }, budget, now())).toBe('out_of_budget:cost_limit_usd');
    expect(budgetTripped({ ...clean, cost_usd: 2.5 }, budget, now())).toBe('out_of_budget:cost_limit_usd');
  });

  it('does NOT trip below the cap', () => {
    expect(budgetTripped({ ...clean, cost_usd: 0.99 }, budget, now())).toBeNull();
  });

  it('FAIL-OPEN: no cost_limit_usd configured → never trips regardless of cost', () => {
    const noCap = mergeBudget(); // hard-limit defaults only
    expect(budgetTripped({ ...clean, cost_usd: 9_999 }, noCap, now())).toBeNull();
  });

  it('cost is LAST in order — a hard limit trips before cost', () => {
    // token_limit tripped AND cost tripped → token wins (evaluated first)
    const both = mergeBudget({ token_limit: 100, cost_limit_usd: 1.0 });
    expect(budgetTripped({ ...clean, tokens: 100, cost_usd: 5 }, both, now())).toBe('out_of_budget:token_limit');
    // step_limit tripped AND cost tripped → step wins (evaluated first of all)
    expect(budgetTripped({ ...clean, steps: HARNESS_BUDGET_DEFAULTS.step_limit, cost_usd: 5 }, both, now()))
      .toBe('out_of_budget:step_limit');
  });

  it('cost trips independently of token_limit (bypass-proof: no token cap needed)', () => {
    const costOnly = mergeBudget({ cost_limit_usd: 1.0 }); // no token_limit
    expect(budgetTripped({ ...clean, tokens: 10_000_000, cost_usd: 1.0 }, costOnly, now()))
      .toBe('out_of_budget:cost_limit_usd');
  });
});
