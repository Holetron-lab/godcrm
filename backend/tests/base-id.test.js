// base_id Generator Tests (v0.002.006)
// Format: [A-Z0-9]{8}
import { describe, test, expect } from 'vitest';
import { generateBaseId, isValidBaseId } from '../utils/baseId.js';

describe('base_id Generator', () => {
  test('should generate correct format [A-Z0-9]{8}', () => {
    const baseId = generateBaseId();
    expect(baseId).toMatch(/^[A-Z0-9]{8}$/);
    expect(baseId).toHaveLength(8);
  });

  test('should generate unique base_ids', () => {
    const baseId1 = generateBaseId();
    const baseId2 = generateBaseId();
    expect(baseId1).not.toBe(baseId2);
  });

  test('should have low collision probability', () => {
    const generated = new Set();
    const count = 1000;
    for (let i = 0; i < count; i++) {
      generated.add(generateBaseId());
    }
    expect(generated.size).toBeGreaterThan(count * 0.99);
  });

  test('should validate correct base_ids', () => {
    expect(isValidBaseId('ABC12DEF')).toBe(true);
    expect(isValidBaseId('XYZ789QW')).toBe(true);
    expect(isValidBaseId('12345678')).toBe(true);
    expect(isValidBaseId('ABCDEFGH')).toBe(true);
  });

  test('should reject invalid base_ids', () => {
    expect(isValidBaseId('abc12def')).toBe(false);
    expect(isValidBaseId('ABC12DE')).toBe(false);
    expect(isValidBaseId('ABC12DEFG')).toBe(false);
    expect(isValidBaseId('ABC-12-DEF')).toBe(false);
    expect(isValidBaseId('')).toBe(false);
    expect(isValidBaseId(null)).toBe(false);
    expect(isValidBaseId(123)).toBe(false);
  });

  // ADR-0156 §Decision.3: stored base_ids include prefixed lineages that the
  // old strict regex wrongly rejected. isValidBaseId is now advisory and
  // tolerates these documented forms.
  test('should accept documented prefixed base_ids', () => {
    expect(isValidBaseId('doc-134298')).toBe(true);
    expect(isValidBaseId('skill-foo')).toBe(true);
    expect(isValidBaseId('ext_AB12')).toBe(true);
    expect(isValidBaseId('op-x1')).toBe(true);
    expect(isValidBaseId('ticket-test-123')).toBe(true);
    expect(isValidBaseId('conv-9f8a')).toBe(true);
  });

  test('should generate only uppercase and numbers', () => {
    for (let i = 0; i < 100; i++) {
      const baseId = generateBaseId();
      expect(baseId).toMatch(/^[A-Z0-9]+$/);
    }
  });
});
