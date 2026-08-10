/**
 * @file formulaEvaluator.test.ts
 * @description Tests for frontend formula evaluator
 * @created 2025-01-14
 * @context ADR-026 - Formulas, Variables, Aggregations & Charts
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateFormula,
  tryEvaluateFormula,
  evaluateAggregation,
  isFormula,
  extractFormula,
  FORMULA_FUNCTIONS,
} from '../formulaEvaluator';

describe('evaluateFormula', () => {
  describe('basic arithmetic', () => {
    it('evaluates addition', () => {
      expect(evaluateFormula('2 + 3')).toBe(5);
    });

    it('evaluates subtraction', () => {
      expect(evaluateFormula('10 - 4')).toBe(6);
    });

    it('evaluates multiplication', () => {
      expect(evaluateFormula('3 * 4')).toBe(12);
    });

    it('evaluates division', () => {
      expect(evaluateFormula('10 / 2')).toBe(5);
    });

    it('evaluates parentheses', () => {
      expect(evaluateFormula('(2 + 3) * 4')).toBe(20);
    });

    it('evaluates complex expression', () => {
      expect(evaluateFormula('(10 + 5) / 3 * 2')).toBe(10);
    });
  });

  describe('variables', () => {
    it('substitutes single variable', () => {
      expect(evaluateFormula('$price', { variables: { $price: 100 } })).toBe(100);
    });

    it('substitutes multiple variables', () => {
      expect(
        evaluateFormula('$price * $qty', {
          variables: { $price: 10, $qty: 5 },
        })
      ).toBe(50);
    });

    it('throws on undefined variable', () => {
      expect(() => evaluateFormula('$missing')).toThrow('Undefined variable');
    });

    it('handles string variables', () => {
      expect(
        evaluateFormula('$name', { variables: { $name: 'Alice' } })
      ).toBe('Alice');
    });

    it('handles null variables as 0', () => {
      expect(
        evaluateFormula('$val + 1', { variables: { $val: null } })
      ).toBe(1);
    });
  });

  describe('column references', () => {
    it('substitutes column value', () => {
      expect(
        evaluateFormula('{{amount}}', { row: { amount: 100 } })
      ).toBe(100);
    });

    it('substitutes multiple columns', () => {
      expect(
        evaluateFormula('{{price}} * {{quantity}}', {
          row: { price: 10, quantity: 5 },
        })
      ).toBe(50);
    });

    it('throws on undefined column', () => {
      expect(() =>
        evaluateFormula('{{missing}}', { row: {} })
      ).toThrow('Undefined column');
    });

    it('mixes columns and variables', () => {
      expect(
        evaluateFormula('{{base}} * $tax', {
          row: { base: 100 },
          variables: { $tax: 0.1 },
        })
      ).toBe(10);
    });
  });

  describe('built-in functions', () => {
    it('ROUND - rounds to specified decimals', () => {
      expect(evaluateFormula('ROUND(3.14159, 2)')).toBe(3.14);
    });

    it('ROUND - defaults to 0 decimals', () => {
      expect(evaluateFormula('ROUND(3.7)')).toBe(4);
    });

    it('FLOOR - rounds down', () => {
      expect(evaluateFormula('FLOOR(3.9)')).toBe(3);
    });

    it('CEIL - rounds up', () => {
      expect(evaluateFormula('CEIL(3.1)')).toBe(4);
    });

    it('ABS - absolute value', () => {
      expect(evaluateFormula('ABS(-5)')).toBe(5);
    });

    it('SQRT - square root', () => {
      expect(evaluateFormula('SQRT(16)')).toBe(4);
    });

    it('POW - power', () => {
      expect(evaluateFormula('POW(2, 3)')).toBe(8);
    });

    it('LEN - string length', () => {
      expect(evaluateFormula('LEN("hello")')).toBe(5);
    });

    it('UPPER - uppercase', () => {
      expect(evaluateFormula('UPPER("hello")')).toBe('HELLO');
    });

    it('LOWER - lowercase', () => {
      expect(evaluateFormula('LOWER("HELLO")')).toBe('hello');
    });

    it('CONCAT - concatenates strings', () => {
      expect(evaluateFormula('CONCAT("a", "b", "c")')).toBe('abc');
    });

    it('TRIM - trims whitespace', () => {
      expect(evaluateFormula('TRIM("  hello  ")')).toBe('hello');
    });
  });

  describe('IF function', () => {
    it('returns true value when condition is true', () => {
      expect(evaluateFormula('IF(1 > 0, 10, 20)')).toBe(10);
    });

    it('returns false value when condition is false', () => {
      expect(evaluateFormula('IF(1 < 0, 10, 20)')).toBe(20);
    });

    it('handles equality', () => {
      expect(evaluateFormula('IF(5 == 5, 100, 0)')).toBe(100);
    });

    it('handles inequality', () => {
      expect(evaluateFormula('IF(5 != 3, 100, 0)')).toBe(100);
    });

    it('works with variables', () => {
      expect(
        evaluateFormula('IF($val > 10, 1, 0)', { variables: { $val: 15 } })
      ).toBe(1);
    });
  });

  describe('IFERROR function', () => {
    it('returns value when no error', () => {
      expect(evaluateFormula('IFERROR(10 / 2, 0)')).toBe(5);
    });

    it('returns fallback on division by zero', () => {
      expect(evaluateFormula('IFERROR(10 / 0, 0)')).toBe(0);
    });
  });

  describe('string literals', () => {
    it('returns double-quoted string', () => {
      expect(evaluateFormula('"hello world"')).toBe('hello world');
    });

    it('returns single-quoted string', () => {
      expect(evaluateFormula("'hello world'")).toBe('hello world');
    });
  });

  describe('edge cases', () => {
    it('returns 0 for empty formula', () => {
      expect(evaluateFormula('')).toBe(0);
    });

    it('returns 0 for whitespace formula', () => {
      expect(evaluateFormula('   ')).toBe(0);
    });

    it('throws on invalid characters', () => {
      expect(() => evaluateFormula('system.exit()')).toThrow();
    });
  });
});

describe('tryEvaluateFormula', () => {
  it('returns result on success', () => {
    expect(tryEvaluateFormula('2 + 3')).toBe(5);
  });

  it('returns default on error', () => {
    expect(tryEvaluateFormula('$missing', {}, 0)).toBe(0);
  });

  it('returns custom default on error', () => {
    expect(tryEvaluateFormula('$missing', {}, -1)).toBe(-1);
  });
});

describe('evaluateAggregation', () => {
  describe('SUM', () => {
    it('sums numbers', () => {
      expect(evaluateAggregation('SUM', [1, 2, 3, 4, 5])).toBe(15);
    });

    it('handles empty array', () => {
      expect(evaluateAggregation('SUM', [])).toBe(0);
    });

    it('filters non-numeric values', () => {
      expect(evaluateAggregation('SUM', [1, 'a', 2, null, 3])).toBe(6);
    });

    it('parses string numbers', () => {
      expect(evaluateAggregation('SUM', ['1', '2', '3'])).toBe(6);
    });
  });

  describe('AVG', () => {
    it('averages numbers', () => {
      expect(evaluateAggregation('AVG', [10, 20, 30])).toBe(20);
    });

    it('handles empty array', () => {
      expect(evaluateAggregation('AVG', [])).toBe(0);
    });
  });

  describe('MIN', () => {
    it('finds minimum', () => {
      expect(evaluateAggregation('MIN', [5, 3, 8, 1, 9])).toBe(1);
    });

    it('handles empty array', () => {
      expect(evaluateAggregation('MIN', [])).toBe(0);
    });
  });

  describe('MAX', () => {
    it('finds maximum', () => {
      expect(evaluateAggregation('MAX', [5, 3, 8, 1, 9])).toBe(9);
    });

    it('handles empty array', () => {
      expect(evaluateAggregation('MAX', [])).toBe(0);
    });
  });

  describe('COUNT', () => {
    it('counts all values', () => {
      expect(evaluateAggregation('COUNT', [1, 2, null, '', 5])).toBe(5);
    });
  });

  describe('COUNT_EMPTY', () => {
    it('counts empty values', () => {
      expect(evaluateAggregation('COUNT_EMPTY', [1, null, '', undefined, 5])).toBe(3);
    });
  });

  describe('COUNT_NOT_EMPTY', () => {
    it('counts non-empty values', () => {
      expect(evaluateAggregation('COUNT_NOT_EMPTY', [1, null, '', undefined, 5])).toBe(2);
    });
  });

  describe('MEDIAN', () => {
    it('finds median of odd count', () => {
      expect(evaluateAggregation('MEDIAN', [1, 3, 5, 7, 9])).toBe(5);
    });

    it('finds median of even count', () => {
      expect(evaluateAggregation('MEDIAN', [1, 2, 3, 4])).toBe(2.5);
    });

    it('handles empty array', () => {
      expect(evaluateAggregation('MEDIAN', [])).toBe(0);
    });
  });

  it('throws on unknown function', () => {
    expect(() => evaluateAggregation('UNKNOWN', [1, 2, 3])).toThrow();
  });
});

describe('isFormula', () => {
  it('returns true for formula starting with =', () => {
    expect(isFormula('=SUM(A1:A10)')).toBe(true);
  });

  it('returns true with leading whitespace', () => {
    expect(isFormula('  =2+3')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isFormula('hello')).toBe(false);
  });

  it('returns false for number', () => {
    expect(isFormula('123')).toBe(false);
  });
});

describe('extractFormula', () => {
  it('removes leading =', () => {
    expect(extractFormula('=2+3')).toBe('2+3');
  });

  it('trims whitespace', () => {
    expect(extractFormula('  = 2 + 3  ')).toBe('2 + 3');
  });

  it('returns original if not formula', () => {
    expect(extractFormula('hello')).toBe('hello');
  });
});

describe('FORMULA_FUNCTIONS', () => {
  it('contains all expected functions', () => {
    const expected = [
      'ROUND', 'FLOOR', 'CEIL', 'ABS', 'SQRT', 'POW',
      'NOW', 'TODAY', 'YEAR', 'MONTH', 'DAY',
      'LEN', 'UPPER', 'LOWER', 'CONCAT', 'TRIM',
    ];
    for (const func of expected) {
      expect(FORMULA_FUNCTIONS).toHaveProperty(func);
    }
  });
});
