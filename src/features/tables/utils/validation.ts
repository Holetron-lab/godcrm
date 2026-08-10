/**
import { logger } from '@/shared/utils/logger';
 * Cell Validation Utilities
 * Provides validation rules for table cells
 */

export interface ValidationRule {
  id: string;
  name: string;
  enabled: boolean;
  type: 'regex' | 'length' | 'range' | 'dateRange' | 'custom';
  config: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    customJs?: string;
    // Date range config
    minDate?: string; // ISO date or relative: 'today', 'today-7', 'today+30'
    maxDate?: string; // ISO date or relative
    allowWeekends?: boolean;
    allowPast?: boolean;
    allowFuture?: boolean;
  };
  errorMessage: string;
}

/**
 * Parse relative date expressions like 'today', 'today-7', 'today+30'
 */
const parseRelativeDate = (expr: string): Date | null => {
  if (!expr) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (expr === 'today') {
    return today;
  }
  
  // Match patterns like 'today-7', 'today+30', 'today-1y', 'today+1m'
  const match = expr.match(/^today([+-])(\d+)(d|w|m|y)?$/);
  if (match) {
    const sign = match[1] === '+' ? 1 : -1;
    const amount = parseInt(match[2]) * sign;
    const unit = match[3] || 'd';
    
    switch (unit) {
      case 'd': // days
        today.setDate(today.getDate() + amount);
        break;
      case 'w': // weeks
        today.setDate(today.getDate() + amount * 7);
        break;
      case 'm': // months
        today.setMonth(today.getMonth() + amount);
        break;
      case 'y': // years
        today.setFullYear(today.getFullYear() + amount);
        break;
    }
    return today;
  }
  
  // Try parsing as ISO date
  const date = new Date(expr);
  return isNaN(date.getTime()) ? null : date;
};

/**
 * Parse date from various formats
 */
const parseDateValue = (value: string): Date | null => {
  if (!value) return null;
  
  // Try Unix timestamp
  if (/^\d{10,13}$/.test(value)) {
    const ts = value.length === 10 ? parseInt(value) * 1000 : parseInt(value);
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  
  // Try ISO format
  const isoDate = new Date(value);
  if (!isNaN(isoDate.getTime())) return isoDate;
  
  // Try EU format DD.MM.YYYY
  const euMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (euMatch) {
    const d = new Date(parseInt(euMatch[3]), parseInt(euMatch[2]) - 1, parseInt(euMatch[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  
  // Try US format MM/DD/YYYY
  const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const d = new Date(parseInt(usMatch[3]), parseInt(usMatch[1]) - 1, parseInt(usMatch[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  
  return null;
};

/**
 * Format date for display in error messages
 */
const formatDateForError = (date: Date): string => {
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric'
  });
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a value against a single rule
 */
export const validateRule = (
  value: unknown,
  rule: ValidationRule,
  rowData?: Record<string, unknown>
): { valid: boolean; error?: string } => {
  if (!rule.enabled) {
    return { valid: true };
  }

  const stringValue = value !== null && value !== undefined ? String(value) : '';

  switch (rule.type) {
    case 'regex': {
      if (!rule.config.pattern) {
        return { valid: true };
      }
      try {
        const regex = new RegExp(rule.config.pattern);
        const valid = regex.test(stringValue);
        return valid ? { valid: true } : { valid: false, error: rule.errorMessage };
      } catch {
        logger.warn('Invalid regex pattern:', rule.config.pattern);
        return { valid: true };
      }
    }

    case 'length': {
      const len = stringValue.length;
      if (rule.config.minLength !== undefined && len < rule.config.minLength) {
        return { valid: false, error: rule.errorMessage || `Минимальная длина: ${rule.config.minLength}` };
      }
      if (rule.config.maxLength !== undefined && len > rule.config.maxLength) {
        return { valid: false, error: rule.errorMessage || `Максимальная длина: ${rule.config.maxLength}` };
      }
      return { valid: true };
    }

    case 'range': {
      const numValue = typeof value === 'number' ? value : parseFloat(stringValue);
      if (isNaN(numValue)) {
        return { valid: false, error: 'Значение должно быть числом' };
      }
      if (rule.config.min !== undefined && numValue < rule.config.min) {
        return { valid: false, error: rule.errorMessage || `Минимум: ${rule.config.min}` };
      }
      if (rule.config.max !== undefined && numValue > rule.config.max) {
        return { valid: false, error: rule.errorMessage || `Максимум: ${rule.config.max}` };
      }
      return { valid: true };
    }

    case 'dateRange': {
      const dateValue = parseDateValue(stringValue);
      if (!dateValue) {
        return { valid: false, error: 'Некорректный формат даты' };
      }
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dateValue.setHours(0, 0, 0, 0);
      
      // Check past/future restrictions
      if (rule.config.allowPast === false && dateValue < today) {
        return { valid: false, error: rule.errorMessage || 'Дата не может быть в прошлом' };
      }
      if (rule.config.allowFuture === false && dateValue > today) {
        return { valid: false, error: rule.errorMessage || 'Дата не может быть в будущем' };
      }
      
      // Check weekends
      if (rule.config.allowWeekends === false) {
        const dayOfWeek = dateValue.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return { valid: false, error: rule.errorMessage || 'Выходные дни не допускаются' };
        }
      }
      
      // Check min date
      if (rule.config.minDate) {
        const minDate = parseRelativeDate(rule.config.minDate);
        if (minDate && dateValue < minDate) {
          return { 
            valid: false, 
            error: rule.errorMessage || `Дата не может быть раньше ${formatDateForError(minDate)}` 
          };
        }
      }
      
      // Check max date
      if (rule.config.maxDate) {
        const maxDate = parseRelativeDate(rule.config.maxDate);
        if (maxDate && dateValue > maxDate) {
          return { 
            valid: false, 
            error: rule.errorMessage || `Дата не может быть позже ${formatDateForError(maxDate)}` 
          };
        }
      }
      
      return { valid: true };
    }

    case 'custom': {
      if (!rule.config.customJs) {
        return { valid: true };
      }
      try {
        // Create safe function with limited scope
        // eslint-disable-next-line no-new-func
        const fn = new Function('value', 'row', `
          "use strict";
          try {
            ${rule.config.customJs}
          } catch (e) {
            logger.warn('Validation error:', e);
            return true;
          }
        `);
        const result = fn(value, rowData || {});
        const valid = result === true || result === 'true';
        return valid ? { valid: true } : { valid: false, error: rule.errorMessage };
      } catch (e) {
        logger.warn('Custom validation error:', e);
        return { valid: true };
      }
    }

    default:
      return { valid: true };
  }
};

/**
 * Validate a value against all rules in a column config
 */
export const validateCell = (
  value: unknown,
  rules: ValidationRule[] = [],
  rowData?: Record<string, unknown>
): ValidationResult => {
  const errors: string[] = [];

  for (const rule of rules) {
    const result = validateRule(value, rule, rowData);
    if (!result.valid && result.error) {
      errors.push(result.error);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Get validation rules from column config
 */
export const getColumnValidationRules = (config: Record<string, unknown> | undefined): ValidationRule[] => {
  if (!config?.validation) {
    return [];
  }
  const validation = config.validation as { rules?: ValidationRule[] };
  return validation.rules || [];
};

/**
 * Preset validation rules for common use cases
 */
export const PRESET_RULES: Record<string, Omit<ValidationRule, 'id'>> = {
  email: {
    name: 'Email формат',
    enabled: true,
    type: 'regex',
    config: { pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$' },
    errorMessage: 'Введите корректный email'
  },
  phone: {
    name: 'Телефон',
    enabled: true,
    type: 'regex',
    config: { pattern: '^\\+?[0-9\\s\\-\\(\\)]{7,20}$' },
    errorMessage: 'Введите корректный номер телефона'
  },
  url: {
    name: 'URL',
    enabled: true,
    type: 'regex',
    config: { pattern: '^(https?:\\/\\/)?[\\w\\-]+(\\.[\\w\\-]+)+[\\/\\w\\-\\.\\?\\=\\&]*$' },
    errorMessage: 'Введите корректный URL'
  },
  alphanumeric: {
    name: 'Только буквы и цифры',
    enabled: true,
    type: 'regex',
    config: { pattern: '^[a-zA-Z0-9а-яА-ЯёЁ]+$' },
    errorMessage: 'Допускаются только буквы и цифры'
  },
  positive: {
    name: 'Положительное число',
    enabled: true,
    type: 'range',
    config: { min: 0 },
    errorMessage: 'Значение должно быть положительным'
  },
  percentage: {
    name: 'Процент (0-100)',
    enabled: true,
    type: 'range',
    config: { min: 0, max: 100 },
    errorMessage: 'Значение должно быть от 0 до 100'
  },
  // Date presets
  futureDate: {
    name: 'Только будущие даты',
    enabled: true,
    type: 'dateRange',
    config: { allowPast: false },
    errorMessage: 'Дата должна быть в будущем'
  },
  pastDate: {
    name: 'Только прошедшие даты',
    enabled: true,
    type: 'dateRange',
    config: { allowFuture: false },
    errorMessage: 'Дата должна быть в прошлом'
  },
  workdays: {
    name: 'Только рабочие дни',
    enabled: true,
    type: 'dateRange',
    config: { allowWeekends: false },
    errorMessage: 'Выберите рабочий день (Пн-Пт)'
  },
  thisYear: {
    name: 'В этом году',
    enabled: true,
    type: 'dateRange',
    config: { minDate: 'today-365d', maxDate: 'today+365d' },
    errorMessage: 'Дата должна быть в текущем году'
  },
  next30Days: {
    name: 'Ближайшие 30 дней',
    enabled: true,
    type: 'dateRange',
    config: { minDate: 'today', maxDate: 'today+30d' },
    errorMessage: 'Дата должна быть в ближайшие 30 дней'
  },
  birthDate: {
    name: 'Дата рождения',
    enabled: true,
    type: 'dateRange',
    config: { minDate: 'today-120y', maxDate: 'today', allowFuture: false },
    errorMessage: 'Введите корректную дату рождения'
  }
};
