import { describe, expect, it } from 'vitest';
import { validateRule, type ValidationRule } from './validation';

describe('invalid validation configuration', () => {
  it.each([
    { type: 'regex' as const, config: { pattern: '[' } },
    { type: 'custom' as const, config: { customJs: 'return (' } },
    { type: 'custom' as const, config: { customJs: 'throw new Error("invalid rule")' } },
  ])('preserves the fallback for $type without throwing', ({ type, config }) => {
    const rule: ValidationRule = {
      id: 'invalid', name: 'Invalid rule', enabled: true,
      type, config, errorMessage: 'Invalid value',
    };
    expect(validateRule('value', rule)).toEqual({ valid: true });
  });
});
