import { describe, it, expect } from 'vitest';
import { detectLanguage, SUPPORTED_DETECT_LANGS } from '../detectLanguage.js';

describe('detectLanguage (ADR-185 — ported from DocumentsModals.tsx:36-47)', () => {
  it('classifies predominantly Russian text as ru', () => {
    expect(detectLanguage('Привет, как дела сегодня')).toBe('ru');
  });

  it('classifies English text as en', () => {
    expect(detectLanguage('Hello, how are you doing today')).toBe('en');
  });

  it('uses the >10% Cyrillic-word threshold (even a little Cyrillic ⇒ ru)', () => {
    // 1 Cyrillic word out of ~6 words ≈ 16% > 10% → ru
    expect(detectLanguage('please review файл before merging today okay')).toBe('ru');
  });

  it('stays en when Cyrillic is below the 10% threshold', () => {
    // 1 Cyrillic word among 12 words ≈ 8% < 10% → en
    expect(detectLanguage('one two three four five six seven eight nine ten файл okay')).toBe('en');
  });

  it('defaults empty / word-less input to en', () => {
    expect(detectLanguage('')).toBe('en');
    expect(detectLanguage('   ')).toBe('en');
    expect(detectLanguage('123 !!! ...')).toBe('en');
    expect(detectLanguage(null)).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
  });

  it('ignores short (<3 char) tokens like the original regex', () => {
    // 'ok', 'да' are 2 chars → excluded; only 3+ char words count
    expect(detectLanguage('ok да hi no')).toBe('en');
  });

  it('exposes the supported detection set (ru/en for MVP)', () => {
    expect(SUPPORTED_DETECT_LANGS).toEqual(['en', 'ru']);
  });
});
