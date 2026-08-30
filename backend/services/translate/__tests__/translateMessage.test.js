import { describe, it, expect } from 'vitest';
import { normalizeAiReturn, isSupportedTargetLang } from '../translateMessage.js';

describe('normalizeAiReturn (ADR-185 — collapse callAgentAI polymorphic output)', () => {
  it('accepts a plain string (openai/anthropic text path)', () => {
    expect(normalizeAiReturn('Bonjour le monde')).toEqual({ ok: true, text: 'Bonjour le monde' });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeAiReturn('  hola  ')).toEqual({ ok: true, text: 'hola' });
  });

  it('reads .text (anthropic thinking-enabled path returns { text, thinking })', () => {
    expect(normalizeAiReturn({ text: 'Hallo Welt', thinking: 'reasoning...' }))
      .toEqual({ ok: true, text: 'Hallo Welt' });
  });

  it('reads .content (claude-code local path returns { success, content })', () => {
    expect(normalizeAiReturn({ success: true, content: 'Ciao mondo' }))
      .toEqual({ ok: true, text: 'Ciao mondo' });
  });

  it('surfaces an error object as a clean failure', () => {
    expect(normalizeAiReturn({ success: false, error: 'no_api_key', message: 'no key' }))
      .toEqual({ ok: false, error: 'no_api_key', message: 'no key' });
  });

  it('treats null / empty / whitespace-only as empty_translation', () => {
    expect(normalizeAiReturn(null).ok).toBe(false);
    expect(normalizeAiReturn('').ok).toBe(false);
    expect(normalizeAiReturn('   ').ok).toBe(false);
    expect(normalizeAiReturn({ text: '' }).ok).toBe(false);
    expect(normalizeAiReturn(null).error).toBe('empty_translation');
  });
});

describe('isSupportedTargetLang (ADR-185 — target must be one of 15 LANGUAGE_NAMES)', () => {
  it('accepts known language codes', () => {
    for (const code of ['en', 'ru', 'de', 'fr', 'zh', 'he', 'nl']) {
      expect(isSupportedTargetLang(code)).toBe(true);
    }
  });

  it('rejects unknown / unsafe values (SQL-injection guard on the column name)', () => {
    expect(isSupportedTargetLang('xx')).toBe(false);
    expect(isSupportedTargetLang('en; DROP TABLE messages')).toBe(false);
    expect(isSupportedTargetLang('')).toBe(false);
    expect(isSupportedTargetLang(null)).toBe(false);
    expect(isSupportedTargetLang(undefined)).toBe(false);
    expect(isSupportedTargetLang(42)).toBe(false);
  });
});
