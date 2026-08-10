// @vitest-environment node
/**
 * ADR-165 WP-2b — derived-cost pricing (pure, DB-free layer).
 *
 * Pins the HARD INVARIANT: an unknown/unpriced (or half-priced) model yields
 * cost 0, so cost_limit_usd can never trip for it — no cap, never a wrong cap.
 * `getModelPriceUsd` (the DB lookup) is exercised on staging smoke, not here —
 * these cover only the pure functions the invariant rests on.
 */

import { describe, it, expect } from 'vitest';
import { normalizePrice, deriveCostUsd } from '../pricing.js';

describe('normalizePrice', () => {
  it('returns a price object when both prices are finite & non-negative', () => {
    expect(normalizePrice(3, 15)).toEqual({ inputPrice: 3, outputPrice: 15 });
    expect(normalizePrice(0, 0)).toEqual({ inputPrice: 0, outputPrice: 0 });
    expect(normalizePrice('2.5', '10')).toEqual({ inputPrice: 2.5, outputPrice: 10 });
  });

  it('returns null when either price is missing (half-priced → no cap)', () => {
    expect(normalizePrice(3, null)).toBeNull();
    expect(normalizePrice(null, 15)).toBeNull();
    expect(normalizePrice(undefined, undefined)).toBeNull();
  });

  it('returns null on non-numeric or negative prices', () => {
    expect(normalizePrice('abc', 15)).toBeNull();
    expect(normalizePrice(-1, 15)).toBeNull();
    expect(normalizePrice(3, -0.01)).toBeNull();
    expect(normalizePrice(NaN, 15)).toBeNull();
    expect(normalizePrice(Infinity, 15)).toBeNull();
  });
});

describe('deriveCostUsd', () => {
  const price = { inputPrice: 3, outputPrice: 15 }; // USD per 1e6 tokens

  it('computes cost = (prompt*in + completion*out) / 1e6', () => {
    // 1M prompt @ $3 + 1M completion @ $15 = $18
    expect(deriveCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, price)).toBe(18);
    // 500k prompt @ $3 = $1.50, 200k completion @ $15 = $3.00 → $4.50
    expect(deriveCostUsd({ prompt_tokens: 500_000, completion_tokens: 200_000 }, price)).toBeCloseTo(4.5, 10);
  });

  it('FAIL-OPEN: null price → 0 (no cost, never a wrong cap)', () => {
    expect(deriveCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, null)).toBe(0);
    expect(deriveCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, undefined)).toBe(0);
  });

  it('treats missing/absent usage fields as 0 tokens', () => {
    expect(deriveCostUsd({}, price)).toBe(0);
    expect(deriveCostUsd(undefined, price)).toBe(0);
    expect(deriveCostUsd({ prompt_tokens: 1_000_000 }, price)).toBe(3); // completion absent → 0
  });

  it('ignores negative token counts (returns 0, never negative cost)', () => {
    expect(deriveCostUsd({ prompt_tokens: -1_000_000, completion_tokens: 1_000_000 }, price)).toBe(0);
  });
});
