// @vitest-environment node
/**
 * ADR-158 §P1 — recipient normalization for multi-address send (to/cc/bcc).
 *
 * Pure unit test (no network/DB): back-compat single string, arrays, comma /
 * semicolon splitting, validation, dedup, and the required-empty guard.
 * Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import { describe, it, expect } from 'vitest';
import { normalizeRecipients, RecipientError } from '../../services/mail/recipients.js';

describe('normalizeRecipients', () => {
  it('wraps a single valid string into a one-element array (back-compat)', () => {
    expect(normalizeRecipients('a@b.com')).toEqual(['a@b.com']);
  });

  it('trims and keeps a valid array', () => {
    expect(normalizeRecipients([' a@b.com ', 'c@d.com'])).toEqual(['a@b.com', 'c@d.com']);
  });

  it('splits a comma/semicolon-separated string', () => {
    expect(normalizeRecipients('a@b.com, c@d.com; e@f.com')).toEqual([
      'a@b.com',
      'c@d.com',
      'e@f.com',
    ]);
  });

  it('dedupes case-insensitively, preserving first-seen order/casing', () => {
    expect(normalizeRecipients(['A@B.com', 'a@b.com', 'c@d.com'])).toEqual([
      'A@B.com',
      'c@d.com',
    ]);
  });

  it('returns [] for null/undefined/empty when not required', () => {
    expect(normalizeRecipients(null)).toEqual([]);
    expect(normalizeRecipients(undefined)).toEqual([]);
    expect(normalizeRecipients('')).toEqual([]);
    expect(normalizeRecipients([])).toEqual([]);
    expect(normalizeRecipients('  ,  ; ')).toEqual([]);
  });

  it('throws RecipientError on an invalid address, naming the field', () => {
    expect(() => normalizeRecipients('not-an-email', { field: 'cc' })).toThrow(RecipientError);
    try {
      normalizeRecipients(['ok@x.com', 'bad'], { field: 'bcc' });
    } catch (e) {
      expect(e).toBeInstanceOf(RecipientError);
      expect(e.message).toMatch(/bcc/);
      expect(e.message).toMatch(/bad/);
    }
  });

  it('throws when required and no valid address is present', () => {
    expect(() => normalizeRecipients('', { field: 'to', required: true })).toThrow(RecipientError);
    expect(() => normalizeRecipients([], { field: 'to', required: true })).toThrow(RecipientError);
  });

  it('does not throw when required and at least one address is present', () => {
    expect(normalizeRecipients('a@b.com', { field: 'to', required: true })).toEqual(['a@b.com']);
  });
});
