// Column Service - Validation & Formatting for All Column Types
//
// ADR-0041R Phase 2: the column-type enum has a single owner. The set itself
// lives in shared/column-types.js — one file both trees read, so the frontend
// derives `ColumnType` instead of re-declaring it. This module owns the
// backend-side policy built on top of it: what the API accepts
// (VALID_COLUMN_TYPES) and what may be written (persistColumnType).
//
// The manifest is a `.js` module rather than `shared/*.json` (the repo's usual
// cross-tree pattern) because `resolveJsonModule` widens a JSON array to
// `string[]`, which would silently degrade the frontend's derived union to
// `string` while still compiling. See the header of shared/column-types.js.

import {
  COLUMN_TYPES,
  COLUMN_TYPE_ALIASES,
  PROVISIONAL_COLUMN_TYPES,
  canonicalizeColumnType
} from '../../shared/column-types.js';

// Re-exported so backend callers keep importing the enum from ColumnService.
// `canonicalizeColumnType`'s contract is unchanged (ADR-0041R Phase 2); only
// its `textarea`/`markdown` and `person` mappings are corrected, in the manifest.
export {
  COLUMN_TYPES,
  COLUMN_TYPE_ALIASES,
  PROVISIONAL_COLUMN_TYPES,
  canonicalizeColumnType
};

/**
 * Everything accepted on input: canon ∪ Tier D ∪ aliases. Derived, never
 * re-typed. ADR-0041R repairs two live 400s here — `json` (360 columns) and
 * `color` (19) exist in production and in the frontend union but were absent
 * from this list, so creating one through POST /tables/:id/columns failed.
 */
export const VALID_COLUMN_TYPES = Object.freeze([
  ...COLUMN_TYPES,
  ...PROVISIONAL_COLUMN_TYPES,
  ...Object.keys(COLUMN_TYPE_ALIASES)
]);

/**
 * ADR-0041R Phase 2/3: the ONLY value allowed to reach an INSERT/UPDATE of
 * `table_columns.type`. Canonicalize, then reject anything the enum does not
 * own — this is what stops 35 distinct spellings from becoming 36.
 * @param {string} type
 * @returns {string} canonical type, safe to persist
 * @throws {Error} when the type is unknown
 */
export function persistColumnType(type) {
  const canonical = canonicalizeColumnType(type);
  if (
    !COLUMN_TYPES.includes(canonical) &&
    !PROVISIONAL_COLUMN_TYPES.includes(canonical)
  ) {
    throw new Error(
      `Unknown column type '${type}'. Must be one of: ${VALID_COLUMN_TYPES.join(', ')}`
    );
  }
  return canonical;
}

/**
 * Validate value based on column type and config
 * @param {object} column - Column definition { type, config }
 * @param {any} value - Value to validate
 * @returns {boolean} True if valid
 */
export function validateColumnValue(column, value) {
  const { config = {} } = column;
  const type = canonicalizeColumnType(column.type);

  switch (type) {
    case 'text':
      return validateText(value, config);
    case 'number':
      return validateNumber(value, config);
    case 'email':
      return validateEmail(value, config);
    case 'url':
      return validateUrl(value, config);
    case 'phone':
      return validatePhone(value, config);
    case 'date':
      if (column.config?.date?.mode) return validateDateByMode(value, column.config);
      return validateDate(value, config);
    case 'datetime':
      if (column.config?.date?.mode) return validateDateByMode(value, column.config);
      return validateDatetime(value, config);
    case 'checkbox':
      return validateCheckbox(value);
    case 'select':
      return validateSelect(value, config);
    case 'multi-select':
      return validateMultiSelect(value, config);
    case 'verification':
      return validateVerification(value);
    case 'order':
      return validateOrder(value);
    case 'actor':
      return validateActor(value);
    default:
      return true; // Other types validated separately
  }
}

// ADR-151: source enum for the `actor` type. `ai` is distinct from `api`
// (decision 2026-06-03) so the agent write-path stays queryable on its own.
export const ACTOR_SOURCES = ['manual', 'import', 'api', 'workflow', 'system', 'ai'];

/**
 * Format value for display
 * @param {object} column - Column definition
 * @param {any} value - Value to format
 * @returns {any} Formatted value
 */
export function formatColumnValue(column, value) {
  const { config = {} } = column;
  const type = canonicalizeColumnType(column.type);

  switch (type) {
    case 'number':
      return formatNumber(value, config);
    case 'phone':
      return formatPhone(value, config);
    case 'date':
      return formatDate(value, config);
    case 'checkbox':
      return formatCheckbox(value);
    default:
      return value;
  }
}

// ===================================================================
// Type 1: Text
// ===================================================================
function validateText(value, config) {
  if (typeof value !== 'string') return false;
  
  if (config.max_length && value.length > config.max_length) {
    return false;
  }
  
  return true;
}

// ===================================================================
// Type 2: Number
// ===================================================================
function validateNumber(value, config) {
  const num = Number(value);
  
  if (isNaN(num)) return false;
  
  // Check format
  if (config.format === 'integer' && !Number.isInteger(num)) {
    return false;
  }
  
  if (config.format === 'decimal' && config.decimal_places !== undefined) {
    const decimals = (num.toString().split('.')[1] || '').length;
    if (decimals > config.decimal_places) {
      return false;
    }
  }
  
  // Check range
  if (config.min !== undefined && num < config.min) {
    return false;
  }
  
  if (config.max !== undefined && num > config.max) {
    return false;
  }
  
  return true;
}

function formatNumber(value, config) {
  const num = Number(value);
  
  if (config.format === 'currency') {
    const symbol = config.currency === 'USD' ? '$' : 
                   config.currency === 'EUR' ? '€' : 
                   config.currency === 'RUB' ? '₽' : '$';
    
    return `${symbol}${num.toLocaleString('en-US', { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  
  if (config.format === 'percent') {
    return `${num}%`;
  }
  
  return num;
}

// ===================================================================
// Type 3: Email
// ===================================================================
function validateEmail(value, config) {
  if (typeof value !== 'string') return false;
  
  // Always validate email format (RFC 5322 simplified)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
}

// ===================================================================
// Type 4: URL
// ===================================================================
function validateUrl(value, config) {
  if (typeof value !== 'string') return false;
  
  if (!config.validate) return true;
  
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// ===================================================================
// Type 5: Phone
// ===================================================================
function validatePhone(value, config) {
  if (typeof value !== 'string') return false;
  
  // Basic validation: digits, spaces, +, -, ()
  const phoneRegex = /^[\d\s+\-()]+$/;
  return phoneRegex.test(value);
}

function formatPhone(value, config) {
  if (config.format === 'national' && config.country_code === 'US') {
    // Format as (XXX) XXX-XXXX
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
  }
  
  return value;
}

// ===================================================================
// Type 6: Date
// ===================================================================
function validateDate(value, config) {
  if (typeof value !== 'string') return false;
  
  // Check YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(value)) return false;
  
  // Check valid date
  const date = new Date(value);
  return !isNaN(date.getTime());
}

function formatDate(value, config) {
  const date = new Date(value);
  
  if (config.format === 'DD/MM/YYYY') {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  
  if (config.format === 'MM/DD/YYYY') {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }
  
  return value;
}

// ===================================================================
// Type 7: Datetime
// ===================================================================
function validateDatetime(value, config) {
  if (typeof value !== 'string') return false;
  
  // Check YYYY-MM-DD HH:mm format
  const datetimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
  return datetimeRegex.test(value);
}

// ===================================================================
// Type 6+7 unified: Date with modes (ADR-070)
// ===================================================================
/**
 * Validate date parts (day, month) are calendar-valid
 * @param {number} day
 * @param {number} month - 1-12
 * @param {number} year
 * @returns {boolean}
 */
function isValidDateParts(day, month, year) {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Parse EU format DD.MM.YYYY and validate calendar
 * @param {string} str
 * @returns {boolean}
 */
function isValidEuDate(str) {
  const match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return false;
  return isValidDateParts(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
}

/**
 * Parse US format MM/DD/YYYY and validate calendar
 * @param {string} str
 * @returns {boolean}
 */
function isValidUsDate(str) {
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return false;
  return isValidDateParts(parseInt(match[2]), parseInt(match[1]), parseInt(match[3]));
}

function validateDateByMode(value, config) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const str = String(value);
  const mode = config?.date?.mode || config?.mode || 'datetime';
  const storageFormat = config?.date?.storageFormat || config?.date?.dateFormat || 'iso';

  switch (mode) {
    case 'date':
      if (storageFormat === 'eu') return isValidEuDate(str);
      if (storageFormat === 'us') return isValidUsDate(str);
      return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());
    case 'datetime':
      if (storageFormat === 'eu') {
        return /^\d{1,2}\.\d{1,2}\.\d{4}\s\d{2}:\d{2}/.test(str);
      }
      if (storageFormat === 'us') {
        return /^\d{1,2}\/\d{1,2}\/\d{4}\s\d{2}:\d{2}/.test(str);
      }
      return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str) || /^\d{10,13}$/.test(str);
    case 'month':
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(str);
    case 'year':
      return /^\d{4}$/.test(str) && parseInt(str) >= 1900 && parseInt(str) <= 2200;
    case 'week':
      return /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(str);
    case 'quarter':
      return /^\d{4}-Q[1-4]$/.test(str);
    default:
      return true;
  }
}

// ===================================================================
// Type 8: Checkbox
// ===================================================================
function validateCheckbox(value) {
  return typeof value === 'boolean' || 
         typeof value === 'number' || 
         value === 0 || 
         value === 1;
}

function formatCheckbox(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 'yes' || value === 'true') return true;
  return false;
}

// ===================================================================
// Type 9: Select
// ===================================================================
function validateSelect(value, config) {
  const { options = [], allow_custom = false } = config;
  
  if (allow_custom) return true;
  
  return options.some(opt => opt.value === value);
}

// ===================================================================
// Type 11: Verification (ADR-0011)
// Cell shape: null | {
//   verified: bool,
//   verified_at?: iso,
//   verified_by?: number,
//   method?: string,
//   audit?: Array<{ event: string, reason?: string, at?: string, by?: number }>
// }
// ===================================================================
function validateVerification(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.verified !== 'boolean') return false;
  if (value.verified_at !== undefined && value.verified_at !== null && typeof value.verified_at !== 'string') return false;
  if (value.verified_by !== undefined && value.verified_by !== null && typeof value.verified_by !== 'number') return false;
  if (value.method !== undefined && value.method !== null && typeof value.method !== 'string') return false;
  if (value.audit !== undefined && value.audit !== null) {
    if (!Array.isArray(value.audit)) return false;
    for (const entry of value.audit) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      if (typeof entry.event !== 'string') return false;
    }
  }
  return true;
}

// ===================================================================
// Type 10: Multi Select
// ===================================================================
function validateMultiSelect(value, config) {
  if (!Array.isArray(value)) return false;
  
  const { options = [], max_selections } = config;
  
  // Check max selections
  if (max_selections && value.length > max_selections) {
    return false;
  }
  
  // Check all values exist in options
  return value.every(val => options.some(opt => opt.value === val));
}

// ===================================================================
// ADR-151 Type: Order (typed sort position)
// P0 = integer position, ascending. P1 will relax to numeric for
// fractional indexing — gated to type='order' only, never the legacy
// `doc_*` `data->>'order'` path (which keeps its floor guard).
// Empty/null is allowed (unset position).
// ===================================================================
function validateOrder(value) {
  if (value === null || value === undefined || value === '') return true;
  // Booleans coerce to 1/0 via Number() — reject them; a position is not a flag.
  if (typeof value === 'boolean') return false;
  const num = Number(value);
  if (!Number.isFinite(num)) return false;
  return Number.isInteger(num); // P0: integer only (fractional indexing is P1)
}

// ===================================================================
// ADR-151 Type: Actor (typed provenance)
// Cell shape: null | {
//   source: 'manual'|'import'|'api'|'workflow'|'system'|'ai',
//   actor_ref?: number|string|null,  // reuses the `person` resolver
//   at?: string                      // ISO-8601
// }
// ===================================================================
function validateActor(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  // `source` is required and must be a known origin
  if (!ACTOR_SOURCES.includes(value.source)) return false;
  // `actor_ref` is optional: a person id (number) or slug (string), or null
  if (
    value.actor_ref !== undefined &&
    value.actor_ref !== null &&
    typeof value.actor_ref !== 'number' &&
    typeof value.actor_ref !== 'string'
  ) {
    return false;
  }
  // `at` is optional but, if present, must be a string (ISO-8601)
  if (value.at !== undefined && value.at !== null && typeof value.at !== 'string') {
    return false;
  }
  return true;
}
