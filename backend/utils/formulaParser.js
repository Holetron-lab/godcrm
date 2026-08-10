/**
 * Formula Parser Utility - ADR-026
 * Extracts dependencies and provides formula functions
 * 
 * @module utils/formulaParser
 */

/**
 * Extract column references from formula ({{column_name}} syntax)
 * @param {string} formula - Formula string
 * @returns {string[]} Array of unique column names
 */
export function extractColumns(formula) {
  if (!formula || typeof formula !== 'string') {
    return [];
  }
  
  const columnPattern = /\{\{(\w+)\}\}/g;
  const matches = [...formula.matchAll(columnPattern)];
  const columns = matches.map(m => m[1]);
  
  // Return unique values
  return [...new Set(columns)];
}

/**
 * Extract variable references from formula ($variable_name syntax)
 * @param {string} formula - Formula string
 * @returns {string[]} Array of unique variable names with $ prefix
 */
export function extractVariables(formula) {
  if (!formula || typeof formula !== 'string') {
    return [];
  }
  
  // Match $word_with_underscores but not just numbers after $
  const variablePattern = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const matches = [...formula.matchAll(variablePattern)];
  const variables = matches.map(m => '$' + m[1]);
  
  // Return unique values
  return [...new Set(variables)];
}

/**
 * Extract function calls from formula (FUNCTION_NAME(...) syntax)
 * @param {string} formula - Formula string
 * @returns {string[]} Array of unique function names (uppercase)
 */
export function extractFunctions(formula) {
  if (!formula || typeof formula !== 'string') {
    return [];
  }
  
  // Match FUNCTION_NAME followed by (
  const functionPattern = /([A-Z][A-Z0-9_]*)\s*\(/g;
  const matches = [...formula.matchAll(functionPattern)];
  const functions = matches.map(m => m[1]);
  
  // Return unique values
  return [...new Set(functions)];
}

/**
 * Parse formula and extract all dependencies
 * @param {string} formula - Formula string
 * @returns {{columns: string[], variables: string[], functions: string[]}}
 */
export function parseFormulaDependencies(formula) {
  return {
    columns: extractColumns(formula),
    variables: extractVariables(formula),
    functions: extractFunctions(formula)
  };
}

/**
 * Registry of supported formula functions
 * @type {Object.<string, Function>}
 */
export const FORMULA_FUNCTIONS = {
  // ============================================================
  // Aggregation functions
  // ============================================================
  
  /**
   * Sum of all values
   * @param {number[]} values
   * @returns {number}
   */
  SUM: (values) => values.reduce((a, b) => a + b, 0),
  
  /**
   * Average of all values
   * @param {number[]} values
   * @returns {number}
   */
  AVG: (values) => values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length,
  
  /**
   * Minimum value
   * @param {number[]} values
   * @returns {number}
   */
  MIN: (values) => Math.min(...values),
  
  /**
   * Maximum value
   * @param {number[]} values
   * @returns {number}
   */
  MAX: (values) => Math.max(...values),
  
  /**
   * Count of values
   * @param {any[]} values
   * @returns {number}
   */
  COUNT: (values) => values.length,
  
  /**
   * Count values matching condition
   * @param {any[]} values
   * @param {string} condition
   * @returns {number}
   */
  COUNTIF: (values, condition) => {
    return values.filter(v => v === condition).length;
  },
  
  // ============================================================
  // Math functions
  // ============================================================
  
  /**
   * Absolute value
   * @param {number} value
   * @returns {number}
   */
  ABS: (value) => Math.abs(value),
  
  /**
   * Round to decimals
   * @param {number} value
   * @param {number} decimals
   * @returns {number}
   */
  ROUND: (value, decimals = 0) => {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },
  
  /**
   * Floor value
   * @param {number} value
   * @returns {number}
   */
  FLOOR: (value) => Math.floor(value),
  
  /**
   * Ceiling value
   * @param {number} value
   * @returns {number}
   */
  CEIL: (value) => Math.ceil(value),
  
  // ============================================================
  // Text functions
  // ============================================================
  
  /**
   * Concatenate strings
   * @param {...string} args
   * @returns {string}
   */
  CONCAT: (...args) => args.join(''),
  
  /**
   * Uppercase string
   * @param {string} value
   * @returns {string}
   */
  UPPER: (value) => String(value).toUpperCase(),
  
  /**
   * Lowercase string
   * @param {string} value
   * @returns {string}
   */
  LOWER: (value) => String(value).toLowerCase(),
  
  /**
   * String length
   * @param {string} value
   * @returns {number}
   */
  LEN: (value) => String(value).length,
  
  // ============================================================
  // Date functions
  // ============================================================
  
  /**
   * Current date/time
   * @returns {Date}
   */
  NOW: () => new Date(),
  
  /**
   * Today at midnight
   * @returns {Date}
   */
  TODAY: () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  },
  
  /**
   * Difference in days between two dates
   * @param {Date} date1
   * @param {Date} date2
   * @returns {number}
   */
  DATEDIFF: (date1, date2) => {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2 - d1);
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  },
  
  // ============================================================
  // Conditional functions
  // ============================================================
  
  /**
   * If condition
   * @param {boolean} condition
   * @param {any} trueValue
   * @param {any} falseValue
   * @returns {any}
   */
  IF: (condition, trueValue, falseValue) => condition ? trueValue : falseValue,
  
  /**
   * Switch statement
   * @param {any} value
   * @param {...any} cases - pairs of (match, result)
   * @returns {any}
   */
  SWITCH: (value, ...cases) => {
    for (let i = 0; i < cases.length - 1; i += 2) {
      if (value === cases[i]) {
        return cases[i + 1];
      }
    }
    // Return last value as default if odd number of cases
    if (cases.length % 2 === 1) {
      return cases[cases.length - 1];
    }
    return null;
  },
  
  /**
   * Handle errors gracefully
   * @param {any} expression
   * @param {any} fallback
   * @returns {any}
   */
  IFERROR: (expression, fallback) => {
    try {
      if (expression === null || expression === undefined || Number.isNaN(expression)) {
        return fallback;
      }
      return expression;
    } catch {
      return fallback;
    }
  }
};

/**
 * Check if a function name is supported
 * @param {string} functionName - Function name (uppercase)
 * @returns {boolean}
 */
export function isSupportedFunction(functionName) {
  return functionName in FORMULA_FUNCTIONS;
}

/**
 * Get list of all supported function names
 * @returns {string[]}
 */
export function getSupportedFunctions() {
  return Object.keys(FORMULA_FUNCTIONS);
}
