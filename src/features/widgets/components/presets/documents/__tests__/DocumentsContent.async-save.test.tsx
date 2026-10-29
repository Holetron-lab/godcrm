import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { DocumentsProvider } from '../context/DocumentsProvider';
import { DocumentsContent } from '../DocumentsContent';
import { ToolbarLanguageSelector } from '../toolbar/ToolbarLanguageSelector';
import type { DocumentItem } from '../../../../types/documents.types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn(), get: vi.fn() } }));
vi.mock('@/shared/hooks/useMediaQuery', () => ({ useIsMobile: () => false, useIsTablet: () => false, useBreakpoint: () => 'desktop' }));
vi.mock('@/shared/hooks/useSystemVariables', () => ({ useSystemVariables: () => ({}) }));
vi.mock('../useDocumentChat', () => ({ useDocumentChat: () => ({ openDocumentChat: vi.fn() }) }));
vi.mock('@/features/ai-chat', () => ({ useAIChat: () => ({ attachRowToMessage: vi.fn() }) }));
vi.mock('../atoms/TicketRefAtom', () => ({ useAtomRow: () => ({}), isTicketRefAtomPayload: () => false, TicketRefAtom: () => null }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('keeps focus after a first save and delayed content refetch in the real document composition', async () => {
  sessionStorage.clear();
  localStorage.setItem('god-crm-language', 'ru');
  window.history.replaceState({}, '', '/?doc=async-save');
  let row: DocumentItem = { id: 7, level: 'text', order: 10, content_en: '' };
  let releaseRefetch: (() => void) | undefined;
  let contentReads = 0;
  const writes: Partial<DocumentItem>[] = [];
  vi.mocked(apiClient.get).mockImplementation(async path => {
    if (path === '/access/project/1/my-level') return { data: { access_level: 'owner' } };
    if (path === '/tables/41/columns') return { data: [] };
    throw new Error(`Unexpected GET ${path}`);
  });
  vi.mocked(apiClient.request).mockImplementation(async (path, options) => {
    if (path === '/tables/41/rows?limit=5000') return { data: { rows: [
      { id: 1, data: { name: 'Async save', slug: 'async-save', table_id: 42 } },
    ] } };
    if (path === '/documents/1/content?registry_table_id=41') {
      contentReads += 1;
      if (contentReads === 2) await new Promise<void>(resolve => { releaseRefetch = resolve; });
      return { data: { table_id: 42, items: [{ ...row }] } };
    }
    if (path === '/tables/42/rows/7' && options?.method === 'PUT') {
      const { data } = JSON.parse(String(options.body)) as { data: Partial<DocumentItem> };
      writes.push(data);
      row = { ...row, ...data };
      return { success: true };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  const mount = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><LanguageProvider>
      <DocumentsProvider spaceId={0} config={{ project_id: 1, registry_table_id: 41, languages: [{ code: 'en', name: 'English', is_default: true }] }} widgetId={99}>
        <ToolbarLanguageSelector /><DocumentsContent />
      </DocumentsProvider>
    </LanguageProvider></QueryClientProvider>);
    return { ...view, client };
  };
  const user = userEvent.setup();
  const mounted = mount();
  const trigger = await screen.findByRole('button', { name: 'Нажмите чтобы редактировать...' });
  expect(screen.getByRole('combobox', { name: 'Язык документа' })).toHaveValue('en');
  trigger.focus();
  await user.keyboard('{Enter}');
  await user.type(screen.getByRole('textbox', { name: 'Текст блока (Markdown)' }), 'English persisted');
  await user.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(releaseRefetch).toBeTypeOf('function'));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ content_en: 'English persisted' });
  expect(writes[0]).not.toHaveProperty('content_ru');
  expect(writes[0]).not.toHaveProperty('content');
  await act(async () => { releaseRefetch?.(); });
  await screen.findByText('English persisted');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Редактировать текст' })).toHaveFocus());
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  mounted.unmount();
  mounted.client.clear();
  const reloaded = mount();
  expect(await screen.findByText('English persisted')).toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveValue('en');
  expect(writes).toHaveLength(1);
  reloaded.unmount();
  reloaded.client.clear();
});
