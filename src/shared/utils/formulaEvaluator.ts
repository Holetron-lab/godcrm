/**
 * @file formulaEvaluator.ts
 * @description Formula Evaluator for Frontend (ported from backend)
 * @created 2025-01-14
 * @context ADR-026 - Formulas, Variables, Aggregations & Charts
 * 
 * Evaluates formulas with support for:
 * - Basic arithmetic (+, -, *, /, parentheses)
 * - Variable substitution ($variable_name)
 * - Column references ({{column_name}})
 * - Aggregation functions (SUM, AVG, MIN, MAX, COUNT, etc.)
 * - Built-in functions (IF, ROUND, FLOOR, CEIL, ABS, IFERROR)
 */

// ============================================================
// Types
// ============================================================

export interface FormulaContext {
  /** Map of $variable_name to value */
  variables?: Record<string, string | number | null>;
  /** Current row data (for {{column}} references) */
  row?: Record<string, unknown>;
  /** All rows (for aggregations) */
  rows?: Record<string, unknown>[];
}

export type FormulaResult = number | string | boolean | null;

// ============================================================
// Aggregation Functions
// ============================================================

/**
 * Evaluate aggregation function on array of values
 */
export function evaluateAggregation(
  functionName: string,
  values: unknown[]
): number {
  // Filter out non-numeric values for numeric aggregations
  const numericValues = values
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map((v) => (typeof v === 'number' ? v : parseFloat(String(v))))
    .filter((v) => !isNaN(v));

  switch (functionName.toUpperCase()) {
    case 'SUM':
      return numericValues.reduce((acc, val) => acc + val, 0);

    case 'AVG':
      return numericValues.length > 0
        ? numericValues.reduce((acc, val) => acc + val, 0) / numericValues.length
        : 0;

    case 'MIN':
      return numericValues.length > 0 ? Math.min(...numericValues) : 0;

    case 'MAX':
      return numericValues.length > 0 ? Math.max(...numericValues) : 0;

    case 'COUNT':
      return values.length;

    case 'COUNT_EMPTY':
      return values.filter((v) => v === null || v === undefined || v === '').length;

    case 'COUNT_NOT_EMPTY':
      return values.filter((v) => v !== null && v !== undefined && v !== '').length;

    case 'MEDIAN': {
      if (numericValues.length === 0) return 0;
      const sorted = [...numericValues].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    default:
      throw new Error(`Unknown aggregation function: ${functionName}`);
  }
}

// ============================================================
// Built-in Functions
// ============================================================

type FormulaFunction = (...args: unknown[]) => FormulaResult;

/**
 * Available formula functions
 */
export const FORMULA_FUNCTIONS: Record<string, FormulaFunction> = {
  // Math functions
  ROUND: (value: unknown, decimals: unknown = 0) => {
    const num = Number(value);
    const dec = Number(decimals);
    const factor = Math.pow(10, dec);
    return Math.round(num * factor) / factor;
  },
  FLOOR: (value: unknown) => Math.floor(Number(value)),
  CEIL: (value: unknown) => Math.ceil(Number(value)),
  ABS: (value: unknown) => Math.abs(Number(value)),
  SQRT: (value: unknown) => Math.sqrt(Number(value)),
  POW: (base: unknown, exp: unknown) => Math.pow(Number(base), Number(exp)),

  // Date functions
  NOW: () => new Date().toISOString(),
  TODAY: () => new Date().toISOString().split('T')[0],
  YEAR: (date: unknown) => new Date(String(date)).getFullYear(),
  MONTH: (date: unknown) => new Date(String(date)).getMonth() + 1,
  DAY: (date: unknown) => new Date(String(date)).getDate(),

  // String functions
  LEN: (str: unknown) => String(str).length,
  UPPER: (str: unknown) => String(str).toUpperCase(),
  LOWER: (str: unknown) => String(str).toLowerCase(),
  CONCAT: (...args: unknown[]) => args.map(String).join(''),
  TRIM: (str: unknown) => String(str).trim(),
};

// ============================================================
// Parser Helpers
// ============================================================

/**
 * Parse function arguments string into array
 */
function parseArguments(argsString: string): unknown[] {
  if (!argsString.trim()) return [];

  const args: unknown[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (const char of argsString) {
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      current += char;
    } else if (char === stringChar && inString) {
      inString = false;
      current += char;
    } else if (char === '(' && !inString) {
      depth++;
      current += char;
    } else if (char === ')' && !inString) {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0 && !inString) {
      args.push(parseArgValue(current.trim()));
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    args.push(parseArgValue(current.trim()));
  }

  return args;
}

/**
 * Parse a single argument value
 */
function parseArgValue(value: string): unknown {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  const num = parseFloat(value);
  if (!isNaN(num)) {
    return num;
  }
  return value;
}

/**
 * Safe evaluation of mathematical expressions
 * Only allows: numbers, operators, parentheses, comparison, strings
 */
function safeEval(expression: string): FormulaResult {
  const sanitized = expression.trim();

  // Allow: numbers, operators, parentheses, comparison, strings
  if (!/^[\d\s+\-*/().=<>!&|"'a-zA-Z_]+$/.test(sanitized)) {
    throw new Error('Invalid characters in expression');
  }

  // Create a limited scope for evaluation
  // eslint-disable-next-line no-new-func
  const func = new Function(`
    "use strict";
    return (${sanitized});
  `);

  return func() as FormulaResult;
}

// ============================================================
// Main Evaluator
// ============================================================

/**
 * Evaluate a formula with context
 *
 * @param formula - Formula string
 * @param context - Evaluation context
 * @returns Evaluated result
 *
 * @example
 * // Basic arithmetic
 * evaluateFormula('2 + 3') // 5
 *
 * // With variables
 * evaluateFormula('$price * $qty', { variables: { '$price': 10, '$qty': 5 } }) // 50
 *
 * // With column references
 * evaluateFormula('{{amount}} * 0.1', { row: { amount: 100 } }) // 10
 *
 * // With functions
 * evaluateFormula('ROUND($total, 2)', { variables: { '$total': 123.456 } }) // 123.46
 */
export function evaluateFormula(
  formula: string,
  context: FormulaContext = {}
): FormulaResult {
  // Handle empty/whitespace formulas
  if (!formula || typeof formula !== 'string' || formula.trim() === '') {
    return 0;
  }

  const trimmed = formula.trim();

  // Handle pure string literals
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  // Substitute variables ($variable_name)
  let expression = trimmed;
  const { variables = {}, row = {} } = context;

  // Replace $variable references
  expression = expression.replace(
    /\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
    (match, varName: string) => {
      const fullName = '$' + varName;
      if (!(fullName in variables)) {
        throw new Error(`Undefined variable: ${fullName}`);
      }
      const value = variables[fullName];
      return typeof value === 'string' ? `"${value}"` : String(value);
    }
  );

  // Replace {{column}} references with row values
  expression = expression.replace(/\{\{([^}]+)\}\}/g, (match, columnName: string) => {
    const colName = columnName.trim();
    if (!(colName in row)) {
      throw new Error(`Undefined column: ${colName}`);
    }
    const value = row[colName];
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    return String(value);
  });

  // Handle IF function specially (ternary)
  expression = expression.replace(
    /IF\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi,
    (match, condition: string, trueVal: string, falseVal: string) => {
      // Evaluate condition - convert == to ===
      const evalCondition = condition.replace(/==/g, '===').replace(/!=/g, '!==');
      try {
        const result = safeEval(evalCondition);
        return result ? trueVal.trim() : falseVal.trim();
      } catch {
        return falseVal.trim();
      }
    }
  );

  // Handle IFERROR function
  expression = expression.replace(
    /IFERROR\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi,
    (match, expr: string, fallback: string) => {
      try {
        const result = safeEval(expr.trim());
        if (typeof result === 'number' && !isFinite(result)) {
          return fallback.trim();
        }
        return String(result);
      } catch {
        return fallback.trim();
      }
    }
  );

  // Handle built-in functions
  for (const [funcName, func] of Object.entries(FORMULA_FUNCTIONS)) {
    const regex = new RegExp(`${funcName}\\s*\\(([^)]*)\\)`, 'gi');
    expression = expression.replace(regex, (match, args: string) => {
      const parsedArgs = parseArguments(args);
      const result = func(...parsedArgs);
      // If result is a string, wrap it in quotes for safe eval
      if (typeof result === 'string') {
        return `"${result}"`;
      }
      return String(result);
    });
  }

  // Finally evaluate the expression
  try {
    return safeEval(expression);
  } catch (e) {
    throw new Error(`Formula evaluation error: ${(e as Error).message}`);
  }
}

/**
 * Safely try to evaluate a formula, returning defaultValue on error
 */
export function tryEvaluateFormula(
  formula: string,
  context: FormulaContext = {},
  defaultValue: FormulaResult = 0
): FormulaResult {
  try {
    return evaluateFormula(formula, context);
  } catch {
    return defaultValue;
  }
}

/**
 * Check if a string looks like a formula (starts with =)
 */
export function isFormula(value: string): boolean {
  return typeof value === 'string' && value.trim().startsWith('=');
}

/**
 * Extract formula content (remove leading =)
 */
export function extractFormula(value: string): string {
  if (!isFormula(value)) return value;
  return value.trim().slice(1).trim();
}

export default {
  evaluateFormula,
  tryEvaluateFormula,
  evaluateAggregation,
  FORMULA_FUNCTIONS,
  isFormula,
  extractFormula,
};
