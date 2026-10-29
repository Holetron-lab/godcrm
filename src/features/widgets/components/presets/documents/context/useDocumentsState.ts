import { useState, useEffect, useMemo, useCallback } from 'react';
import { useIsMobile, useIsTablet, useBreakpoint } from '@/shared/hooks/useMediaQuery';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { DocumentsWidgetConfig, DocumentRegistryItem } from '../../../../types/documents.types';

interface UseDocumentsStateArgs {
  storageKey: string;
  config: DocumentsWidgetConfig | undefined;
  documents: DocumentRegistryItem[];
  isInitialized: boolean;
  /** Dashboard-embedded render — start with the doc-list sidebar collapsed. */
  compact?: boolean;
}

export function useDocumentsState({ storageKey, config, documents, isInitialized, compact = false }: UseDocumentsStateArgs) {
  // Resolve the incoming link before syncing selection back to the URL.
  const [pendingDocSlug, setPendingDocSlug] = useState(() =>
    typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('doc'),
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(() => {
    if (typeof window !== 'undefined' && !pendingDocSlug) {
      const saved = sessionStorage.getItem(`${storageKey}-doc`);
      return saved ? parseInt(saved, 10) : null;
    }
    return null;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [contentSearchQuery, setContentSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sidebarWidth, setSidebarWidth] = useState(280);
  // Dashboard-embedded widgets start with the doc-list sidebar collapsed
  // (Task #2); the standalone module page passes compact=false and keeps it open.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(compact);
  const [showAllElements, setShowAllElements] = useState(false);
  const [showDocumentsGrid, setShowDocumentsGrid] = useState(false);

  // Content language: global useLanguage() is the default. Per-widget override
  // is sticky in sessionStorage so the user's local choice only affects this
  // widget, but a global switch cascades to widgets that have no override.
  const { language: globalLanguage } = useLanguage();
  const langOverrideKey = `${storageKey}-lang-override`;
  const [langOverride, setLangOverride] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(langOverrideKey);
  });
  const setCurrentLanguage = useCallback((lang: string) => {
    if (typeof window === 'undefined') return;
    if (lang === globalLanguage) {
      sessionStorage.removeItem(langOverrideKey);
      setLangOverride(null);
    } else {
      sessionStorage.setItem(langOverrideKey, lang);
      setLangOverride(lang);
    }
  }, [globalLanguage, langOverrideKey]);
  const availableLanguages = config?.languages || [
    { code: 'en', name: 'English', is_default: true },
    { code: 'ru', name: 'Русский' },
  ];
  // Resolve during render so the selector, content reads and writes agree even
  // before effects run or when asynchronously loaded widget languages change.
  const currentLanguage = [langOverride, globalLanguage].find(
    code => availableLanguages.some(language => language.code === code),
  ) ?? availableLanguages.find(language => language.is_default)?.code
    ?? availableLanguages[0]?.code
    ?? globalLanguage;

  const [showTranslationMissingModal, setShowTranslationMissingModal] = useState(false);
  const [translationMissingLang, setTranslationMissingLang] = useState<string | null>(null);

  const [ticketsViewMode, setTicketsViewMode] = useState(false);
  const [ticketsStateFilter, setTicketsStateFilter] = useState<number[]>([]);
  const [ticketsSortBy, setTicketsSortBy] = useState<'created' | 'updated' | 'state' | 'priority'>('updated');
  const [ticketsSortOrder, setTicketsSortOrder] = useState<'asc' | 'desc'>('desc');
  const [ticketsDisplayMode, setTicketsDisplayMode] = useState<'list' | 'cards'>('cards');

  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const breakpoint = useBreakpoint();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);

  useEffect(() => {
    if (isMobile && selectedDocumentId) {
      setMobileSidebarOpen(false);
    }
  }, [selectedDocumentId, isMobile]);

  useEffect(() => {
    if (isMobile) {
      setSidebarCollapsed(true);
    }
  }, [isMobile]);

  const selectedDocument = useMemo(
    () => documents.find(d => d.id === selectedDocumentId),
    [documents, selectedDocumentId],
  );

  useEffect(() => {
    if (pendingDocSlug) {
      if (!isInitialized || documents.length === 0) return;
      const target = documents.find(d => d.slug === pendingDocSlug);
      setSelectedDocumentId(target?.id ?? null);
      setPendingDocSlug(null);
      return;
    }

    if (selectedDocument?.slug) {
      const url = new URL(window.location.href);
      url.searchParams.set('doc', selectedDocument.slug);
      window.history.replaceState({}, '', url.toString());
    } else if (selectedDocumentId === null) {
      const url = new URL(window.location.href);
      url.searchParams.delete('doc');
      window.history.replaceState({}, '', url.toString());
    }
  }, [pendingDocSlug, isInitialized, documents, selectedDocument?.slug, selectedDocumentId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (ticketsViewMode) {
      url.searchParams.set('view', 'tickets');
      if (searchQuery.trim()) {
        url.searchParams.set('search', searchQuery.trim());
      } else {
        url.searchParams.delete('search');
      }
      // Preserve pre-refactor behavior: always set when tickets view is on
      // (original condition `ticketsStateFilter !== 0` was always true on a number[]).
      url.searchParams.set('state', String(ticketsStateFilter));
      url.searchParams.delete('doc');
    } else {
      url.searchParams.delete('view');
      url.searchParams.delete('search');
      url.searchParams.delete('state');
    }
    window.history.replaceState({}, '', url.toString());
  }, [ticketsViewMode, searchQuery, ticketsStateFilter]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const view = url.searchParams.get('view');
    const search = url.searchParams.get('search');
    const state = url.searchParams.get('state');
    const sort = url.searchParams.get('sort');

    if (view === 'tickets') {
      setTicketsViewMode(true);
      if (search) {
        setSearchQuery(search);
      }
      if (state) {
        const stateIds = state.split(',').map(s => Number(s)).filter(n => n > 0);
        setTicketsStateFilter(stateIds);
      }
      if (sort && ['created', 'updated', 'state', 'priority'].includes(sort)) {
        setTicketsSortBy(sort as 'created' | 'updated' | 'state' | 'priority');
      }
    }
  }, []);

  return {
    selectedDocumentId,
    setSelectedDocumentId,
    selectedDocument,
    searchQuery,
    setSearchQuery,
    contentSearchQuery,
    setContentSearchQuery,
    statusFilter,
    setStatusFilter,
    sidebarWidth,
    setSidebarWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    showAllElements,
    setShowAllElements,
    showDocumentsGrid,
    setShowDocumentsGrid,
    currentLanguage,
    setCurrentLanguage,
    availableLanguages,
    showTranslationMissingModal,
    setShowTranslationMissingModal,
    translationMissingLang,
    setTranslationMissingLang,
    ticketsViewMode,
    setTicketsViewMode,
    ticketsStateFilter,
    setTicketsStateFilter,
    ticketsSortBy,
    setTicketsSortBy,
    ticketsSortOrder,
    setTicketsSortOrder,
    ticketsDisplayMode,
    setTicketsDisplayMode,
    isMobile,
    isTablet,
    breakpoint,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    mobileTocOpen,
    setMobileTocOpen,
  };
}
