/**
 * ADR-0035-A §Amendment 1 — `resolveRowTemplate` is TextCell's former
 * `replaceVariables`, extracted. These cases pin the pre-extraction behaviour.
 */
import { describe, expect, it } from 'vitest';
import { hasRowTemplate, resolveRowTemplate } from '../resolveRowTemplate';

describe('resolveRowTemplate (parity with TextCell.replaceVariables)', () => {
  const row = { id: 'r1', title: 'Склад №2', city: 'Москва', count: 3, empty: '', nothing: null };

  it('substitutes column keys and leaves plain text alone', () => {
    expect(resolveRowTemplate('Офис {{city}}', row)).toBe('Офис Москва');
    expect(resolveRowTemplate('{{title}} / {{count}}', row)).toBe('Склад №2 / 3');
    expect(resolveRowTemplate('no vars', row)).toBe('no vars');
  });

  it('renders null/undefined/unknown keys as empty strings', () => {
    expect(resolveRowTemplate('[{{nothing}}]', row)).toBe('[]');
    expect(resolveRowTemplate('[{{missing}}]', row)).toBe('[]');
    expect(resolveRowTemplate('[{{empty}}]', row)).toBe('[]');
  });

  it('supports the {{row_id}} system variable with the id / row_id / _id fallbacks', () => {
    expect(resolveRowTemplate('#{{row_id}}', row)).toBe('#r1');
    expect(resolveRowTemplate('#{{row_id}}', { row_id: 7 })).toBe('#7');
    expect(resolveRowTemplate('#{{row_id}}', { _id: 'x' })).toBe('#x');
    expect(resolveRowTemplate('#{{row_id}}', {})).toBe('#');
  });

  it('returns "" for an empty template and does not touch non-\\w placeholders', () => {
    expect(resolveRowTemplate('', row)).toBe('');
    expect(resolveRowTemplate('{{a-b}}', row)).toBe('{{a-b}}');
  });

  it('hasRowTemplate detects placeholders', () => {
    expect(hasRowTemplate('{{title}}')).toBe(true);
    expect(hasRowTemplate('plain')).toBe(false);
    expect(hasRowTemplate(null)).toBe(false);
    expect(hasRowTemplate(undefined)).toBe(false);
  });
});
