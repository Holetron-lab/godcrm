/**
 * Regression test for BUG-MCP-001: update_table_row contamination.
 *
 * MCP/agent callers occasionally pass `data` as a JSON-encoded string
 * instead of a parsed object. Without normalization, downstream
 * `JSON.stringify(data)` writes a quoted string into JSONB
 * (jsonb_typeof = 'string'). coerceDataObject is the entry guard.
 */

import { describe, it, expect } from 'vitest';
import { coerceDataObject } from '../services/agent-tools/coerceDataInput.js';

describe('coerceDataObject (BUG-MCP-001)', () => {
  it('passes through plain objects unchanged', () => {
    const input = { content_en: 'x', comment: 'y' };
    expect(coerceDataObject(input)).toBe(input);
  });

  it('parses a JSON-encoded string into an object', () => {
    const json = '{"content_en":"x","comment":"y","order":540}';
    expect(coerceDataObject(json)).toEqual({
      content_en: 'x',
      comment: 'y',
      order: 540,
    });
  });

  it('rejects strings that are not valid JSON', () => {
    expect(() => coerceDataObject('not json')).toThrow(/must be a JSON object/);
  });

  it('rejects strings that decode to a primitive', () => {
    expect(() => coerceDataObject('"just a string"')).toThrow(
      /must decode to a JSON object/
    );
    expect(() => coerceDataObject('42')).toThrow(/must decode to a JSON object/);
    expect(() => coerceDataObject('true')).toThrow(/must decode to a JSON object/);
    expect(() => coerceDataObject('null')).toThrow(/must decode to a JSON object; got null/);
  });

  it('rejects strings that decode to an array', () => {
    expect(() => coerceDataObject('[1,2,3]')).toThrow(
      /must decode to a JSON object/
    );
  });

  it('rejects arrays passed directly', () => {
    expect(() => coerceDataObject([1, 2, 3])).toThrow(/got array/);
  });

  it('rejects primitives passed directly', () => {
    expect(() => coerceDataObject(42)).toThrow(/got number/);
    expect(() => coerceDataObject(true)).toThrow(/got boolean/);
  });

  it('returns null for null/undefined (caller decides whether required)', () => {
    expect(coerceDataObject(null)).toBeNull();
    expect(coerceDataObject(undefined)).toBeNull();
  });

  it('uses the fieldName label in error messages', () => {
    expect(() => coerceDataObject(42, 'updates[].data')).toThrow(
      /updates\[\]\.data must/
    );
  });

  // Direct repro of the BUG-MCP-001 corruption path:
  // before the fix, `JSON.stringify(stringInput)` would yield a quoted
  // double-encoded string like `"{\"a\":1}"`, which Postgres stored as
  // jsonb_typeof = 'string'. After coercion the payload round-trips cleanly.
  it('round-trips through JSON.stringify without double-encoding', () => {
    const stringInput = '{"a":1,"b":"hello"}';
    const coerced = coerceDataObject(stringInput);
    const stored = JSON.stringify(coerced);
    expect(stored).toBe('{"a":1,"b":"hello"}');
    expect(stored.startsWith('"')).toBe(false);
  });
});
