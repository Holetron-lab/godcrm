import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

const ctx = vi.hoisted(() => ({
  config: {}, projectId: null, registryTableId: null,
  isMobile: false, isTablet: false, sidebarCollapsed: false, mobileSidebarOpen: false,
  isCreatingMode: false, selectedDocumentId: null, items: [], allAtoms: [],
  sidebarWidth: 300, setSidebarWidth: vi.fn(),
}));

vi.mock('../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('../content/ticketUtils', () => ({ useTicketConfig: () => ({ config: {} }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getColumns: vi.fn() } }));
vi.mock('../sidebar', () => ({
  CATEGORIES_VISIBLE_KEY: 'documents-categories-visible',
  SidebarDocList: () => null,
  SidebarFooterButtons: () => null,
  SidebarFooterStats: () => null,
  SidebarHeader: () => null,
  SidebarImportView: () => null,
  SidebarItemsTree: () => null,
  useSidebarFilter: () => [],
  useSidebarResize: () => ({ handleResizeStart: vi.fn() }),
}));

import { DocumentsSidebar } from '../DocumentsSidebar';

it.each([
  { language: 'en', label: 'Document list width' },
  { language: 'ru', label: 'Ширина списка документов' },
])('localizes the document list width slider in $language', ({ language, label }) => {
  localStorage.setItem('god-crm-language', language);
  render(<LanguageProvider><DocumentsSidebar /></LanguageProvider>);
  expect(screen.getByRole('slider', { name: label })).toHaveAttribute('aria-valuenow', '300');
});
