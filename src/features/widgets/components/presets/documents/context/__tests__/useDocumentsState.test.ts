import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentRegistryItem } from '../../../../../types/documents.types';
import { useDocumentsState } from '../useDocumentsState';

vi.mock('@/shared/hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
  useBreakpoint: () => 'desktop',
}));
vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

const storageKey = 'documents-widget-v4-218';
const slug = 'adr-190-blog-seo-crawler-readable-html-for-blog-via-request-time-ssr-lite-sitemaprobots';
const documents: DocumentRegistryItem[] = [
  { id: 190, name: 'ADR-190', slug, table_id: 100190 },
  { id: 203, name: 'ADR-203', slug: 'adr-203', table_id: 100203 },
];
const args = { storageKey, config: undefined, documents, isInitialized: true };
const docParam = () => new URL(window.location.href).searchParams.get('doc');

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({ idx: 4 }, '', `/widgets/218?doc=${slug}&keep=yes#section`);
});
afterEach(cleanup);

describe('document deep links', () => {
  it('opens the linked document with an already loaded registry', () => {
    const { result } = renderHook(() => useDocumentsState(args));
    expect(result.current.selectedDocument?.id).toBe(190);
    expect(docParam()).toBe(slug);
  });

  it('preserves the link while the registry loads, then opens the document', () => {
    const { result, rerender } = renderHook(props => useDocumentsState(props), {
      initialProps: { ...args, documents: [] as DocumentRegistryItem[], isInitialized: false },
    });
    expect(docParam()).toBe(slug);
    rerender(args);
    expect(result.current.selectedDocument?.id).toBe(190);
    expect(docParam()).toBe(slug);
  });

  it('gives the link priority over the remembered document', () => {
    sessionStorage.setItem(`${storageKey}-doc`, '203');
    const { result } = renderHook(() => useDocumentsState(args));
    expect(result.current.selectedDocument?.id).toBe(190);
    expect(docParam()).toBe(slug);
  });

  it('keeps remembered selection when there is no document link', () => {
    window.history.replaceState({}, '', '/widgets/218');
    sessionStorage.setItem(`${storageKey}-doc`, '203');
    const { result } = renderHook(() => useDocumentsState(args));
    expect(result.current.selectedDocument?.id).toBe(203);
  });

  it('allows selecting another document and returning to the module list', () => {
    const { result } = renderHook(() => useDocumentsState(args));
    act(() => result.current.setSelectedDocumentId(203));
    expect(docParam()).toBe('adr-203');
    act(() => result.current.setSelectedDocumentId(null));
    expect(docParam()).toBeNull();
    expect(window.location.search).toBe('?keep=yes');
    expect(window.location.hash).toBe('#section');
  });
});
