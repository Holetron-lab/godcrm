/**
 * Formula Parser Tests - Sprint 1 (ADR-026)
 * Testing formula dependency extraction and parsing
 * 
 * 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 */

import { describe, test, expect } from 'vitest';
import { 
  parseFormulaDependencies,
  extractColumns,
  extractVariables,
  extractFunctions,
  FORMULA_FUNCTIONS
} from '../formulaParser.js';

// ============================================================
// TESTS
// ============================================================

describe('Formula Parser (ADR-026)', () => {
  
  // ============================================================
  // 🔴 RED PHASE: extractColumns
  // ============================================================
  
  describe('extractColumns()', () => {
    /**
     * BEHAVIOR: When parsing a formula
     * GIVEN a formula with {{column_name}} references
     * THEN return array of column names
     */
    test('should extract single column reference', () => {
      const result = extractColumns('SUM({{amount}})');
      expect(result).toEqual(['amount']);
    });

    test('should extract multiple column references', () => {
      const result = extractColumns('{{price}} * {{quantity}}');
      expect(result).toEqual(['price', 'quantity']);
    });

    test('should handle formula without columns', () => {
      const result = extractColumns('100 + 50');
      expect(result).toEqual([]);
    });

    test('should handle complex formulas with nested columns', () => {
      const result = extractColumns('IF({{status}} == "active", SUM({{revenue}}) - SUM({{costs}}), 0)');
      expect(result).toEqual(['status', 'revenue', 'costs']);
    });

    test('should not duplicate column names', () => {
      const result = extractColumns('{{amount}} + {{amount}}');
      expect(result).toEqual(['amount']);
    });
  });

  // ============================================================
  // 🔴 RED PHASE: extractVariables
  // ============================================================
  
  describe('extractVariables()', () => {
    /**
     * BEHAVIOR: When parsing a formula
     * GIVEN a formula with $variable_name references
     * THEN return array of variable names
     */
    test('should extract single variable reference', () => {
      const result = extractVariables('$tax_rate * 100');
      expect(result).toEqual(['$tax_rate']);
    });

    test('should extract multiple variable references', () => {
      const result = extractVariables('$total_revenue - $total_costs');
      expect(result).toEqual(['$total_revenue', '$total_costs']);
    });

    test('should handle formula without variables', () => {
      const result = extractVariables('SUM({{amount}})');
      expect(result).toEqual([]);
    });

    test('should handle complex variable names with underscores', () => {
      const result = extractVariables('$margin_percent_ytd + $growth_rate_q1');
      expect(result).toEqual(['$margin_percent_ytd', '$growth_rate_q1']);
    });

    test('should not duplicate variable names', () => {
      const result = extractVariables('$tax * 2 + $tax * 3');
      expect(result).toEqual(['$tax']);
    });

    test('should not confuse $variables with other $ patterns', () => {
      // Price like $100 should not be captured
      const result = extractVariables('$total + 100');
      expect(result).toEqual(['$total']);
    });
  });

  // ============================================================
  // 🔴 RED PHASE: extractFunctions
  // ============================================================
  
  describe('extractFunctions()', () => {
    /**
     * BEHAVIOR: When parsing a formula
     * GIVEN a formula with function calls
     * THEN return array of function names (uppercase)
     */
    test('should extract single function', () => {
      const result = extractFunctions('SUM({{amount}})');
      expect(result).toEqual(['SUM']);
    });

    test('should extract multiple functions', () => {
      const result = extractFunctions('SUM({{revenue}}) / COUNT({{orders}})');
      expect(result).toEqual(['SUM', 'COUNT']);
    });

    test('should extract nested functions', () => {
      const result = extractFunctions('ROUND(AVG({{price}}), 2)');
      expect(result).toContain('ROUND');
      expect(result).toContain('AVG');
    });

    test('should handle formula without functions', () => {
      const result = extractFunctions('{{price}} * {{quantity}}');
      expect(result).toEqual([]);
    });

    test('should handle IF function', () => {
      const result = extractFunctions('IF({{status}} == "active", 1, 0)');
      expect(result).toEqual(['IF']);
    });
  });

  // ============================================================
  // 🔴 RED PHASE: parseFormulaDependencies
  // ============================================================
  
  describe('parseFormulaDependencies()', () => {
    /**
     * BEHAVIOR: Full dependency parsing
     * GIVEN a complex formula
     * THEN return columns, variables, and functions arrays
     */
    test('should parse complex formula with all types of dependencies', () => {
      const formula = 'SUM({{revenue}}) * $tax_rate + AVG({{costs}})';
      const result = parseFormulaDependencies(formula);
      
      expect(result.columns).toEqual(['revenue', 'costs']);
      expect(result.variables).toEqual(['$tax_rate']);
      expect(result.functions).toContain('SUM');
      expect(result.functions).toContain('AVG');
    });

    test('should handle empty formula', () => {
      const result = parseFormulaDependencies('');
      expect(result.columns).toEqual([]);
      expect(result.variables).toEqual([]);
      expect(result.functions).toEqual([]);
    });

    test('should handle null formula', () => {
      const result = parseFormulaDependencies(null);
      expect(result.columns).toEqual([]);
      expect(result.variables).toEqual([]);
      expect(result.functions).toEqual([]);
    });

    test('should handle simple constant formula', () => {
      const result = parseFormulaDependencies('0.20');
      expect(result.columns).toEqual([]);
      expect(result.variables).toEqual([]);
      expect(result.functions).toEqual([]);
    });

    test('should parse chained variable formula', () => {
      const formula = '$total_revenue * 0.3';
      const result = parseFormulaDependencies(formula);
      
      expect(result.columns).toEqual([]);
      expect(result.variables).toEqual(['$total_revenue']);
    });

    test('should parse formula with COUNTIF', () => {
      const formula = 'COUNTIF({{status}}, "active")';
      const result = parseFormulaDependencies(formula);
      
      expect(result.columns).toEqual(['status']);
      expect(result.functions).toEqual(['COUNTIF']);
    });
  });

  // ============================================================
  // 🔴 RED PHASE: FORMULA_FUNCTIONS registry
  // ============================================================
  
  describe('FORMULA_FUNCTIONS', () => {
    test('should have SUM function', () => {
      expect(FORMULA_FUNCTIONS.SUM).toBeDefined();
      expect(FORMULA_FUNCTIONS.SUM([1, 2, 3])).toBe(6);
    });

    test('should have AVG function', () => {
      expect(FORMULA_FUNCTIONS.AVG).toBeDefined();
      expect(FORMULA_FUNCTIONS.AVG([2, 4, 6])).toBe(4);
    });

    test('should have MIN function', () => {
      expect(FORMULA_FUNCTIONS.MIN).toBeDefined();
      expect(FORMULA_FUNCTIONS.MIN([3, 1, 2])).toBe(1);
    });

    test('should have MAX function', () => {
      expect(FORMULA_FUNCTIONS.MAX).toBeDefined();
      expect(FORMULA_FUNCTIONS.MAX([3, 1, 2])).toBe(3);
    });

    test('should have COUNT function', () => {
      expect(FORMULA_FUNCTIONS.COUNT).toBeDefined();
      expect(FORMULA_FUNCTIONS.COUNT([1, 2, 3, 4, 5])).toBe(5);
    });

    test('should have ROUND function', () => {
      expect(FORMULA_FUNCTIONS.ROUND).toBeDefined();
      expect(FORMULA_FUNCTIONS.ROUND(3.14159, 2)).toBe(3.14);
    });

    test('should have IF function', () => {
      expect(FORMULA_FUNCTIONS.IF).toBeDefined();
      expect(FORMULA_FUNCTIONS.IF(true, 'yes', 'no')).toBe('yes');
      expect(FORMULA_FUNCTIONS.IF(false, 'yes', 'no')).toBe('no');
    });

    test('should have NOW function', () => {
      expect(FORMULA_FUNCTIONS.NOW).toBeDefined();
      const now = FORMULA_FUNCTIONS.NOW();
      expect(now instanceof Date).toBe(true);
    });

    test('should have CONCAT function', () => {
      expect(FORMULA_FUNCTIONS.CONCAT).toBeDefined();
      expect(FORMULA_FUNCTIONS.CONCAT('Hello', ' ', 'World')).toBe('Hello World');
    });

    test('should have ABS function', () => {
      expect(FORMULA_FUNCTIONS.ABS).toBeDefined();
      expect(FORMULA_FUNCTIONS.ABS(-5)).toBe(5);
    });
  });
});
