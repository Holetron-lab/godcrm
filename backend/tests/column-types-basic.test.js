// Column Types Validation Tests - Basic Types (1-10)

process.env.TEST_MODE = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test_master_key_32_characters_long!';

import { describe, test, expect } from 'vitest';
import { validateColumnValue, formatColumnValue } from '../services/ColumnService.js';

describe('Column Type 1: Text', () => {
  test('should validate text column', () => {
    const column = { type: 'text', config: { max_length: 100 } };
    
    expect(validateColumnValue(column, 'Hello World')).toBe(true);
    expect(validateColumnValue(column, 'A'.repeat(100))).toBe(true);
    expect(validateColumnValue(column, 'A'.repeat(101))).toBe(false); // Too long
  });

  test('should handle multiline text', () => {
    const column = { type: 'text', config: { multiline: true } };
    expect(validateColumnValue(column, 'Line 1\nLine 2\nLine 3')).toBe(true);
  });
});

describe('Column Type 2: Number', () => {
  test('should validate integer', () => {
    const column = { type: 'number', config: { format: 'integer' } };
    
    expect(validateColumnValue(column, 42)).toBe(true);
    expect(validateColumnValue(column, 0)).toBe(true);
    expect(validateColumnValue(column, -10)).toBe(true);
    expect(validateColumnValue(column, 3.14)).toBe(false); // Not integer
    expect(validateColumnValue(column, 'text')).toBe(false);
  });

  test('should validate decimal with precision', () => {
    const column = { type: 'number', config: { format: 'decimal', decimal_places: 2 } };
    
    expect(validateColumnValue(column, 3.14)).toBe(true);
    expect(validateColumnValue(column, 10.99)).toBe(true);
    expect(validateColumnValue(column, 5.123)).toBe(false); // Too many decimals
  });

  test('should validate min/max range', () => {
    const column = { type: 'number', config: { min: 0, max: 100 } };
    
    expect(validateColumnValue(column, 50)).toBe(true);
    expect(validateColumnValue(column, 0)).toBe(true);
    expect(validateColumnValue(column, 100)).toBe(true);
    expect(validateColumnValue(column, -1)).toBe(false);
    expect(validateColumnValue(column, 101)).toBe(false);
  });

  test('should format currency', () => {
    const column = { type: 'number', config: { format: 'currency', currency: 'USD' } };
    
    expect(formatColumnValue(column, 1234.56)).toBe('$1,234.56');
  });
});

describe('Column Type 3: Email', () => {
  test('should validate email format', () => {
    const column = { type: 'email', config: { validate: true } };
    
    expect(validateColumnValue(column, 'test@example.com')).toBe(true);
    expect(validateColumnValue(column, 'user.name+tag@example.co.uk')).toBe(true);
    expect(validateColumnValue(column, 'invalid-email')).toBe(false);
    expect(validateColumnValue(column, '@example.com')).toBe(false);
    expect(validateColumnValue(column, 'test@')).toBe(false);
  });
});

describe('Column Type 4: URL', () => {
  test('should validate URL format', () => {
    const column = { type: 'url', config: { validate: true } };
    
    expect(validateColumnValue(column, 'https://example.com')).toBe(true);
    expect(validateColumnValue(column, 'http://localhost:3000')).toBe(true);
    expect(validateColumnValue(column, 'ftp://files.example.com')).toBe(true);
    expect(validateColumnValue(column, 'not-a-url')).toBe(false);
    expect(validateColumnValue(column, 'http://')).toBe(false);
  });
});

describe('Column Type 5: Phone', () => {
  test('should validate phone format', () => {
    const column = { type: 'phone', config: { format: 'international' } };
    
    expect(validateColumnValue(column, '+1234567890')).toBe(true);
    expect(validateColumnValue(column, '+44 20 1234 5678')).toBe(true);
    expect(validateColumnValue(column, 'abc123')).toBe(false);
  });

  test('should format phone number', () => {
    const column = { type: 'phone', config: { format: 'national', country_code: 'US' } };
    
    expect(formatColumnValue(column, '1234567890')).toBe('(123) 456-7890');
  });
});

describe('Column Type 6: Date', () => {
  test('should validate date format', () => {
    const column = { type: 'date', config: { format: 'YYYY-MM-DD' } };
    
    expect(validateColumnValue(column, '2025-11-13')).toBe(true);
    expect(validateColumnValue(column, '2025-13-01')).toBe(false); // Invalid month
    expect(validateColumnValue(column, 'invalid-date')).toBe(false);
  });

  test('should format date', () => {
    const column = { type: 'date', config: { format: 'DD/MM/YYYY' } };
    
    expect(formatColumnValue(column, '2025-11-13')).toBe('13/11/2025');
  });
});

describe('Column Type 7: Datetime', () => {
  test('should validate datetime format', () => {
    const column = { type: 'datetime', config: { format: 'YYYY-MM-DD HH:mm' } };
    
    expect(validateColumnValue(column, '2025-11-13 14:30')).toBe(true);
    expect(validateColumnValue(column, '2025-11-13')).toBe(false); // Missing time
  });
});

describe('Column Type 8: Checkbox', () => {
  test('should validate boolean', () => {
    const column = { type: 'checkbox' };
    
    expect(validateColumnValue(column, true)).toBe(true);
    expect(validateColumnValue(column, false)).toBe(true);
    expect(validateColumnValue(column, 1)).toBe(true); // Truthy
    expect(validateColumnValue(column, 0)).toBe(true); // Falsy
    expect(validateColumnValue(column, 'text')).toBe(false);
  });

  test('should format as boolean', () => {
    const column = { type: 'checkbox' };
    
    expect(formatColumnValue(column, 1)).toBe(true);
    expect(formatColumnValue(column, 0)).toBe(false);
    expect(formatColumnValue(column, 'yes')).toBe(true);
    expect(formatColumnValue(column, 'no')).toBe(false);
  });
});

describe('Column Type 9: Select', () => {
  test('should validate option exists', () => {
    const column = { 
      type: 'select',
      config: {
        options: [
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' }
        ]
      }
    };
    
    expect(validateColumnValue(column, 'active')).toBe(true);
    expect(validateColumnValue(column, 'inactive')).toBe(true);
    expect(validateColumnValue(column, 'unknown')).toBe(false);
  });

  test('should allow custom value if enabled', () => {
    const column = { 
      type: 'select',
      config: {
        options: [{ label: 'Option 1', value: 'opt1' }],
        allow_custom: true
      }
    };
    
    expect(validateColumnValue(column, 'opt1')).toBe(true);
    expect(validateColumnValue(column, 'custom_value')).toBe(true);
  });
});

describe('Column Type 10: Multi Select', () => {
  test('should validate array of options', () => {
    const column = { 
      type: 'multi_select',
      config: {
        options: [
          { label: 'Tag 1', value: 'tag1' },
          { label: 'Tag 2', value: 'tag2' },
          { label: 'Tag 3', value: 'tag3' }
        ]
      }
    };
    
    expect(validateColumnValue(column, ['tag1', 'tag2'])).toBe(true);
    expect(validateColumnValue(column, ['tag1'])).toBe(true);
    expect(validateColumnValue(column, [])).toBe(true);
    expect(validateColumnValue(column, ['tag1', 'unknown'])).toBe(false);
  });

  test('should enforce max selections', () => {
    const column = { 
      type: 'multi_select',
      config: {
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
          { label: 'C', value: 'c' }
        ],
        max_selections: 2
      }
    };
    
    expect(validateColumnValue(column, ['a', 'b'])).toBe(true);
    expect(validateColumnValue(column, ['a', 'b', 'c'])).toBe(false); // Too many
  });
});
