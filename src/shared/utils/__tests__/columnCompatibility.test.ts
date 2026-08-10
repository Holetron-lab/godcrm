/**
 * Tests for Column Compatibility utilities
 * ADR-031: Missing Column Resolution Dialog
 */
import { describe, it, expect } from 'vitest';
import {
  isTypeCompatible,
  isValueCompatible,
  calculateLevenshtein,
  SYNONYM_GROUPS
} from '../columnCompatibility';

describe('columnCompatibility', () => {
  describe('calculateLevenshtein', () => {
    it('should return 0 for identical strings', () => {
      expect(calculateLevenshtein('status', 'status')).toBe(0);
    });

    it('should return length for empty string comparison', () => {
      expect(calculateLevenshtein('test', '')).toBe(4);
      expect(calculateLevenshtein('', 'test')).toBe(4);
    });

    it('should calculate distance for similar strings', () => {
      expect(calculateLevenshtein('status', 'statuz')).toBe(1);
      expect(calculateLevenshtein('status', 'state')).toBe(2); // s-t-a-t-e vs s-t-a-t-u-s
      expect(calculateLevenshtein('hello', 'hallo')).toBe(1);
    });

    it('should be case-insensitive', () => {
      expect(calculateLevenshtein('Status', 'STATUS')).toBe(0);
    });
  });

  describe('isTypeCompatible', () => {
    it('should return true for same types', () => {
      expect(isTypeCompatible('text', 'text')).toBe(true);
      expect(isTypeCompatible('number', 'number')).toBe(true);
      expect(isTypeCompatible('select', 'select')).toBe(true);
    });

    it('should return true for text-compatible types', () => {
      // Text can accept most types
      expect(isTypeCompatible('number', 'text')).toBe(true);
      expect(isTypeCompatible('email', 'text')).toBe(true);
      expect(isTypeCompatible('url', 'text')).toBe(true);
    });

    it('should return true for number-compatible types', () => {
      // Number from text with number content
      expect(isTypeCompatible('text', 'number')).toBe(true);
    });

    it('should return true for select/multi-select compatibility', () => {
      expect(isTypeCompatible('select', 'multi-select')).toBe(true);
      expect(isTypeCompatible('multi-select', 'select')).toBe(true);
      expect(isTypeCompatible('text', 'select')).toBe(true);
    });

    it('should return false for clearly incompatible types', () => {
      expect(isTypeCompatible('checkbox', 'email')).toBe(false);
      expect(isTypeCompatible('file', 'number')).toBe(false);
      expect(isTypeCompatible('relation', 'text')).toBe(false);
    });
  });

  describe('isValueCompatible', () => {
    describe('number type', () => {
      it('should accept numeric values', () => {
        expect(isValueCompatible(42, 'number')).toBe(true);
        expect(isValueCompatible(3.14, 'number')).toBe(true);
        expect(isValueCompatible('123', 'number')).toBe(true);
        expect(isValueCompatible('45.67', 'number')).toBe(true);
      });

      it('should reject non-numeric values', () => {
        expect(isValueCompatible('hello', 'number')).toBe(false);
        expect(isValueCompatible('abc123', 'number')).toBe(false);
      });
    });

    describe('email type', () => {
      it('should accept valid emails', () => {
        expect(isValueCompatible('test@example.com', 'email')).toBe(true);
        expect(isValueCompatible('user.name@domain.org', 'email')).toBe(true);
      });

      it('should reject invalid emails', () => {
        expect(isValueCompatible('not-email', 'email')).toBe(false);
        expect(isValueCompatible('test@', 'email')).toBe(false);
      });
    });

    describe('url type', () => {
      it('should accept valid URLs', () => {
        expect(isValueCompatible('https://example.com', 'url')).toBe(true);
        expect(isValueCompatible('http://test.org/path', 'url')).toBe(true);
      });

      it('should reject invalid URLs', () => {
        expect(isValueCompatible('not-url', 'url')).toBe(false);
        expect(isValueCompatible('ftp://invalid', 'url')).toBe(false);
      });
    });

    describe('checkbox type', () => {
      it('should accept boolean values', () => {
        expect(isValueCompatible(true, 'checkbox')).toBe(true);
        expect(isValueCompatible(false, 'checkbox')).toBe(true);
        expect(isValueCompatible('true', 'checkbox')).toBe(true);
        expect(isValueCompatible('false', 'checkbox')).toBe(true);
        expect(isValueCompatible(1, 'checkbox')).toBe(true);
        expect(isValueCompatible(0, 'checkbox')).toBe(true);
      });
    });

    describe('datetime type', () => {
      it('should accept valid dates', () => {
        expect(isValueCompatible('2025-01-21', 'datetime')).toBe(true);
        expect(isValueCompatible('2025-01-21T10:30:00', 'datetime')).toBe(true);
        expect(isValueCompatible(new Date().toISOString(), 'datetime')).toBe(true);
      });

      it('should reject invalid dates', () => {
        expect(isValueCompatible('not-a-date', 'datetime')).toBe(false);
        expect(isValueCompatible('2025-99-99', 'datetime')).toBe(false);
      });
    });

    describe('text type', () => {
      it('should accept any value', () => {
        expect(isValueCompatible('hello', 'text')).toBe(true);
        expect(isValueCompatible(123, 'text')).toBe(true);
        expect(isValueCompatible(true, 'text')).toBe(true);
        expect(isValueCompatible(null, 'text')).toBe(true);
      });
    });
  });

  describe('SYNONYM_GROUPS', () => {
    it('should have common synonym groups', () => {
      expect(SYNONYM_GROUPS).toBeDefined();
      expect(SYNONYM_GROUPS.length).toBeGreaterThan(0);
      
      // Check for status synonyms
      const statusGroup = SYNONYM_GROUPS.find(g => g.includes('status'));
      expect(statusGroup).toContain('state');
      expect(statusGroup).toContain('статус');
      
      // Check for name synonyms
      const nameGroup = SYNONYM_GROUPS.find(g => g.includes('name'));
      expect(nameGroup).toContain('title');
      expect(nameGroup).toContain('название');
    });
  });
});
