// src/shared/utils/__tests__/errorUtils.test.ts
// TDD: RED → GREEN → REFACTOR
// ADR-030: DRY Refactoring

import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../errorUtils';

describe('getErrorMessage', () => {
  describe('Given an Error instance', () => {
    it('When called, then returns the error message', () => {
      const error = new Error('Something went wrong');
      expect(getErrorMessage(error)).toBe('Something went wrong');
    });
  });

  describe('Given a string', () => {
    it('When called, then returns the string as-is', () => {
      expect(getErrorMessage('Custom error message')).toBe('Custom error message');
    });

    it('When empty string, then returns empty string', () => {
      expect(getErrorMessage('')).toBe('');
    });
  });

  describe('Given null or undefined', () => {
    it('When called with null, then returns default fallback', () => {
      expect(getErrorMessage(null)).toBe('Unknown error');
    });

    it('When called with undefined, then returns default fallback', () => {
      expect(getErrorMessage(undefined)).toBe('Unknown error');
    });

    it('When called with custom fallback, then returns custom fallback', () => {
      expect(getErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
      expect(getErrorMessage(undefined, 'Another fallback')).toBe('Another fallback');
    });
  });

  describe('Given other types', () => {
    it('When called with number, then returns fallback', () => {
      expect(getErrorMessage(42)).toBe('Unknown error');
    });

    it('When called with object, then returns fallback', () => {
      expect(getErrorMessage({ foo: 'bar' })).toBe('Unknown error');
    });

    it('When called with array, then returns fallback', () => {
      expect(getErrorMessage(['a', 'b'])).toBe('Unknown error');
    });
  });

  describe('Given object with message property', () => {
    it('When object has message string, then returns that message', () => {
      expect(getErrorMessage({ message: 'Object error' })).toBe('Object error');
    });

    it('When object has non-string message, then returns fallback', () => {
      expect(getErrorMessage({ message: 123 })).toBe('Unknown error');
    });
  });
});
