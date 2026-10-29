import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import type { DocumentsWidgetConfig } from '../../../../../types/documents.types';
import { useDocumentsState } from '../useDocumentsState';

vi.mock('@/shared/hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
  useBreakpoint: () => 'desktop',
}));

const en = { code: 'en', name: 'English', is_default: true };
const ru = { code: 'ru', name: 'Русский' };
const config: DocumentsWidgetConfig = { project_id: 1, languages: [en] };
const args = { storageKey: 'language-test', config, documents: [], isInitialized: true };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.setItem('god-crm-language', 'ru');
  window.history.replaceState({}, '', '/');
});
afterEach(cleanup);

describe('document language availability', () => {
  it('resolves English on the first render and remount without storing a fallback override', () => {
    const first = renderHook(() => useDocumentsState(args), { wrapper: LanguageProvider });
    expect(first.result.current.currentLanguage).toBe('en');
    expect(sessionStorage.getItem('language-test-lang-override')).toBeNull();
    first.unmount();
    const next = renderHook(() => useDocumentsState(args), { wrapper: LanguageProvider });
    expect(next.result.current.currentLanguage).toBe('en');
  });

  it('ignores unavailable stored overrides and follows a supported global language', () => {
    sessionStorage.setItem('language-test-lang-override', 'de');
    const { result } = renderHook(() => useDocumentsState({ ...args, config: { ...config, languages: [en, ru] } }),
      { wrapper: LanguageProvider });
    expect(result.current.currentLanguage).toBe('ru');
  });

  it('uses the configured default then the first language if the preference is unavailable', () => {
    const de = { code: 'de', name: 'Deutsch', is_default: false };
    const { result, rerender } = renderHook(props => useDocumentsState(props), {
      wrapper: LanguageProvider, initialProps: { ...args, config: { ...config, languages: [de, en] } },
    });
    expect(result.current.currentLanguage).toBe('en');
    rerender({ ...args, config: { ...config, languages: [de, { ...en, is_default: false }] } });
    expect(result.current.currentLanguage).toBe('de');
  });

  it('reconciles asynchronously loaded or narrowed configuration immediately', () => {
    const { result, rerender } = renderHook(props => useDocumentsState(props), {
      wrapper: LanguageProvider, initialProps: { ...args, config: undefined as DocumentsWidgetConfig | undefined },
    });
    expect(result.current.currentLanguage).toBe('ru');
    rerender(args);
    expect(result.current.currentLanguage).toBe('en');
    rerender({ ...args, config: { ...config, languages: [en, ru] } });
    expect(result.current.currentLanguage).toBe('ru');
  });

  it('keeps explicit choices scoped to each widget and resumes following the global language', () => {
    const { result } = renderHook(() => ({
      english: useDocumentsState(args),
      bilingual: useDocumentsState({ ...args, storageKey: 'neighbor', config: { ...config, languages: [en, ru] } }),
      global: useLanguage(),
    }), { wrapper: LanguageProvider });
    expect(result.current.english.currentLanguage).toBe('en');
    expect(result.current.bilingual.currentLanguage).toBe('ru');
    act(() => result.current.bilingual.setCurrentLanguage('en'));
    expect(sessionStorage.getItem('neighbor-lang-override')).toBe('en');
    expect(result.current.global.language).toBe('ru');
    act(() => result.current.bilingual.setCurrentLanguage('ru'));
    expect(sessionStorage.getItem('neighbor-lang-override')).toBeNull();
    act(() => result.current.global.setLanguage('en'));
    expect(result.current.bilingual.currentLanguage).toBe('en');
    expect(result.current.english.currentLanguage).toBe('en');
  });
});
