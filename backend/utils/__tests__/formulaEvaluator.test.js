/**
 * Formula Evaluator Tests - TDD Approach (ADR-026)
 * 
 * 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 */

import { describe, test, expect } from 'vitest';
import {
  evaluateFormula,
  evaluateAggregation,
  FORMULA_FUNCTIONS
} from '../formulaEvaluator.js';

describe('Formula Evaluator (ADR-026)', () => {
  
  // ============================================================
  // PART 1: Basic Arithmetic
  // ============================================================
  
  describe('evaluateFormula() - Basic Arithmetic', () => {
    test('should evaluate simple number', () => {
      expect(evaluateFormula('42')).toBe(42);
    });

    test('should evaluate decimal number', () => {
      expect(evaluateFormula('0.20')).toBe(0.20);
    });

    test('should evaluate addition', () => {
      expect(evaluateFormula('10 + 5')).toBe(15);
    });

    test('should evaluate subtraction', () => {
      expect(evaluateFormula('10 - 3')).toBe(7);
    });

    test('should evaluate multiplication', () => {
      expect(evaluateFormula('6 * 7')).toBe(42);
    });

    test('should evaluate division', () => {
      expect(evaluateFormula('100 / 4')).toBe(25);
    });

    test('should evaluate parentheses', () => {
      expect(evaluateFormula('(10 + 5) * 2')).toBe(30);
    });

    test('should handle negative numbers', () => {
      expect(evaluateFormula('-5 + 10')).toBe(5);
    });
  });

  // ============================================================
  // PART 2: Variables substitution
  // ============================================================
  
  describe('evaluateFormula() - Variable substitution', () => {
    test('should substitute $variable with value', () => {
      const context = { variables: { $tax_rate: 0.20 } };
      expect(evaluateFormula('100 * $tax_rate', context)).toBe(20);
    });

    test('should handle multiple variables', () => {
      const context = { 
        variables: { 
          $price: 100, 
          $tax_rate: 0.20,
          $discount: 10 
        } 
      };
      expect(evaluateFormula('$price * $tax_rate - $discount', context)).toBe(10);
    });

    test('should return error for undefined variable', () => {
      expect(() => evaluateFormula('$undefined_var')).toThrow();
    });
  });

  // ============================================================
  // PART 3: Column references
  // ============================================================
  
  describe('evaluateFormula() - Column references', () => {
    test('should substitute {{column}} with row value', () => {
      const context = { 
        row: { amount: 150, quantity: 3 } 
      };
      expect(evaluateFormula('{{amount}} * {{quantity}}', context)).toBe(450);
    });

    test('should handle column with spaces in name', () => {
      const context = { 
        row: { 'Total Amount': 200 } 
      };
      expect(evaluateFormula('{{Total Amount}} * 2', context)).toBe(400);
    });
  });

  // ============================================================
  // PART 4: Aggregation functions
  // ============================================================
  
  describe('evaluateAggregation()', () => {
    const testData = [10, 20, 30, 40, 50];

    test('SUM should return sum of values', () => {
      expect(evaluateAggregation('SUM', testData)).toBe(150);
    });

    test('AVG should return average of values', () => {
      expect(evaluateAggregation('AVG', testData)).toBe(30);
    });

    test('MIN should return minimum value', () => {
      expect(evaluateAggregation('MIN', testData)).toBe(10);
    });

    test('MAX should return maximum value', () => {
      expect(evaluateAggregation('MAX', testData)).toBe(50);
    });

    test('COUNT should return count of values', () => {
      expect(evaluateAggregation('COUNT', testData)).toBe(5);
    });

    test('COUNT_EMPTY should count null/undefined values', () => {
      const data = [10, null, 20, undefined, 30, ''];
      expect(evaluateAggregation('COUNT_EMPTY', data)).toBe(3);
    });

    test('COUNT_NOT_EMPTY should count non-null values', () => {
      const data = [10, null, 20, undefined, 30, ''];
      expect(evaluateAggregation('COUNT_NOT_EMPTY', data)).toBe(3);
    });

    test('SUM should return 0 for empty array', () => {
      expect(evaluateAggregation('SUM', [])).toBe(0);
    });

    test('AVG should return 0 for empty array', () => {
      expect(evaluateAggregation('AVG', [])).toBe(0);
    });
  });

  // ============================================================
  // PART 5: Built-in functions
  // ============================================================
  
  describe('FORMULA_FUNCTIONS', () => {
    test('IF should return true value when condition is true', () => {
      const context = { row: { status: 'completed' } };
      expect(evaluateFormula('IF({{status}} == "completed", 100, 0)', context)).toBe(100);
    });

    test('IF should return false value when condition is false', () => {
      const context = { row: { status: 'pending' } };
      expect(evaluateFormula('IF({{status}} == "completed", 100, 0)', context)).toBe(0);
    });

    test('ROUND should round to specified decimals', () => {
      expect(evaluateFormula('ROUND(3.14159, 2)')).toBe(3.14);
    });

    test('FLOOR should round down', () => {
      expect(evaluateFormula('FLOOR(3.9)')).toBe(3);
    });

    test('CEIL should round up', () => {
      expect(evaluateFormula('CEIL(3.1)')).toBe(4);
    });

    test('ABS should return absolute value', () => {
      expect(evaluateFormula('ABS(-42)')).toBe(42);
    });

    test('IFERROR should return value when no error', () => {
      expect(evaluateFormula('IFERROR(10 / 2, 0)')).toBe(5);
    });

    test('IFERROR should return fallback on error', () => {
      expect(evaluateFormula('IFERROR(10 / 0, 0)')).toBe(0);
    });
  });

  // ============================================================
  // PART 6: Edge cases
  // ============================================================
  
  describe('Edge cases', () => {
    test('should handle division by zero', () => {
      expect(evaluateFormula('IFERROR(10 / 0, 0)')).toBe(0);
    });

    test('should handle empty formula', () => {
      expect(evaluateFormula('')).toBe(0);
    });

    test('should handle whitespace-only formula', () => {
      expect(evaluateFormula('   ')).toBe(0);
    });

    test('should handle string values', () => {
      expect(evaluateFormula('"hello"')).toBe('hello');
    });
  });
});
