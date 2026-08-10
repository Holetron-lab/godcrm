/**
 * Formula Evaluator (ADR-026)
 * 
 * Evaluates formulas with support for:
 * - Basic arithmetic (+, -, *, /, parentheses)
 * - Variable substitution ($variable_name)
 * - Column references ({{column_name}})
 * - Aggregation functions (SUM, AVG, MIN, MAX, COUNT, etc.)
 * - Built-in functions (IF, ROUND, FLOOR, CEIL, ABS, IFERROR)
 */

import { parseFormulaDependencies } from './formulaParser.js';

// ============================================================
// Aggregation Functions
// ============================================================

/**
 * Evaluate aggregation function on array of values
 * @param {string} functionName - SUM, AVG, MIN, MAX, COUNT, etc.
 * @param {Array} values - Array of numeric values
 * @returns {number} Result of aggregation
 */
export function evaluateAggregation(functionName, values) {
  // Filter out non-numeric values for numeric aggregations
  const numericValues = values
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(v => typeof v === 'number' ? v : parseFloat(v))
    .filter(v => !isNaN(v));

  switch (functionName.toUpperCase()) {
    case 'SUM':
      return numericValues.reduce((acc, val) => acc + val, 0);
    
    case 'AVG':
      return numericValues.length > 0 
        ? numericValues.reduce((acc, val) => acc + val, 0) / numericValues.length 
        : 0;
    
    case 'MIN':
      return numericValues.length > 0 
        ? Math.min(...numericValues) 
        : 0;
    
    case 'MAX':
      return numericValues.length > 0 
        ? Math.max(...numericValues) 
        : 0;
    
    case 'COUNT':
      return values.length;
    
    case 'COUNT_EMPTY':
      return values.filter(v => v === null || v === undefined || v === '').length;
    
    case 'COUNT_NOT_EMPTY':
      return values.filter(v => v !== null && v !== undefined && v !== '').length;
    
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

/**
 * Available formula functions
 */
export const FORMULA_FUNCTIONS = {
  // Math functions
  ROUND: (value, decimals = 0) => {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },
  FLOOR: (value) => Math.floor(value),
  CEIL: (value) => Math.ceil(value),
  ABS: (value) => Math.abs(value),
  SQRT: (value) => Math.sqrt(value),
  POW: (base, exp) => Math.pow(base, exp),
  
  // Date functions
  NOW: () => new Date().toISOString(),
  TODAY: () => new Date().toISOString().split('T')[0],
  YEAR: (date) => new Date(date).getFullYear(),
  MONTH: (date) => new Date(date).getMonth() + 1,
  DAY: (date) => new Date(date).getDate(),
  
  // String functions
  LEN: (str) => String(str).length,
  UPPER: (str) => String(str).toUpperCase(),
  LOWER: (str) => String(str).toLowerCase(),
  CONCAT: (...args) => args.join(''),
  TRIM: (str) => String(str).trim(),
};

// ============================================================
// Formula Evaluator
// ============================================================

/**
 * Evaluate a formula with context
 * @param {string} formula - Formula string
 * @param {Object} context - Evaluation context
 * @param {Object} context.variables - Map of $variable_name to value
 * @param {Object} context.row - Current row data (for {{column}} references)
 * @param {Array} context.rows - All rows (for aggregations)
 * @returns {number|string|boolean} Evaluated result
 */
export function evaluateFormula(formula, context = {}) {
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
  const { variables = {}, row = {}, rows = [] } = context;
  
  // Replace $variable references
  expression = expression.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, varName) => {
    const fullName = '$' + varName;
    if (!(fullName in variables)) {
      throw new Error(`Undefined variable: ${fullName}`);
    }
    const value = variables[fullName];
    return typeof value === 'string' ? `"${value}"` : String(value);
  });
  
  // Replace {{column}} references with row values
  expression = expression.replace(/\{\{([^}]+)\}\}/g, (match, columnName) => {
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
    (match, condition, trueVal, falseVal) => {
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
    (match, expr, fallback) => {
      try {
        const result = safeEval(expr.trim());
        if (!isFinite(result)) {
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
    expression = expression.replace(regex, (match, args) => {
      const parsedArgs = parseArguments(args);
      const result = func(...parsedArgs);
      return String(result);
    });
  }
  
  // Finally evaluate the expression
  try {
    return safeEval(expression);
  } catch (e) {
    throw new Error(`Formula evaluation error: ${e.message}`);
  }
}

/**
 * Parse function arguments string into array
 * @param {string} argsString - Comma-separated arguments
 * @returns {Array} Parsed arguments
 */
function parseArguments(argsString) {
  if (!argsString.trim()) return [];
  
  const args = [];
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
 * @param {string} value - Argument string
 * @returns {*} Parsed value
 */
function parseArgValue(value) {
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
 * @param {string} expression - Expression to evaluate
 * @returns {*} Result
 */
function safeEval(expression) {
  // Security: Only allow safe characters
  const sanitized = expression.trim();
  
  // Allow: numbers, operators, parentheses, comparison, strings
  if (!/^[\d\s+\-*/().=<>!&|"'a-zA-Z_]+$/.test(sanitized)) {
    throw new Error('Invalid characters in expression');
  }
  
  // Create a limited scope for evaluation
  const func = new Function(`
    "use strict";
    return (${sanitized});
  `);
  
  return func();
}

export default {
  evaluateFormula,
  evaluateAggregation,
  FORMULA_FUNCTIONS
};
