import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocumentItem } from '../../../../../types/documents.types';
import type { SectionTreeNodeV4 } from '../../../../../utils/parseMarkdownToAtoms';

const mocks = vi.hoisted(() => ({
  openDocumentChat: vi.fn(), openTaskChat: vi.fn(), attach: vi.fn(), get: vi.fn(), toast: vi.fn(), updateRow: vi.fn(),
  ctx: {
    config: {}, registryTableId: 2197, dataSource: 'internal', isMobile: false, isReadOnly: false,
    setSelectedDocumentId: vi.fn(), setAtomsViewMode: vi.fn(), refresh: vi.fn(),
    resolveStatus: () => ({ id: 1, label: 'Draft', slug: 'draft' }),
    statusOptions: [{ id: 1, label: 'Draft', slug: 'draft' }, { id: 2, label: 'Review', slug: 'review' }],
    expandedNodes: new Set<number>(), atomSections: {}, activePreviewOrder: null,
    setExpandedNodes: vi.fn(), setImportTree: vi.fn(), setActivePreviewOrder: vi.fn(),
    selectedDocument: null, items: [] as DocumentItem[], showAllElements: true, selectedItemId: null,
    setSelectedItemId: vi.fn(), setShowDocumentsGrid: vi.fn(), setTicketsViewMode: vi.fn(),
    setMobileSidebarOpen: vi.fn(), setShowAllElements: vi.fn(),
  },
}));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => mocks.ctx }));
vi.mock('../../useDocumentChat', () => ({ useDocumentChat: () => ({ openDocumentChat: mocks.openDocumentChat }) }));
vi.mock('@/features/ai-chat', () => ({ useAIChat: () => ({ openTaskChat: mocks.openTaskChat, attachRowToMessage: mocks.attach }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: mocks.toast }));
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { updateRow: mocks.updateRow } }));
vi.mock('../../content/ticketUtils', async importOriginal => ({
  ...await importOriginal<typeof import('../../content/ticketUtils')>(),
  useTicketConfig: () => ({ config: { table_id: 1708, columns: { title: 'title' } } }),
  useTicketDictionaries: () => ({ types: [], states: [] }),
}));
import { SidebarDocRow } from '../SidebarDocRow';
import { InlineTicketRow } from '../InlineTicketRow';
import { ImportTreeNode } from '../ImportTreeNode';
import { SidebarItemsTree } from '../SidebarItemsTree';
import { TicketsDataContext } from '../DocumentTicketsProvider';

const doc = { id: 7, name: 'Guide', slug: 'guide', table_id: 42, status_id: 1 };
const node: SectionTreeNodeV4 = {
  section: { order: 1, level: 'h2', title: 'Introduction', content: 'Introduction', selected: true },
  children: [{ section: { order: 2, level: 'text', title: '', content: 'Child', selected: true }, children: [], selected: true, expanded: false }],
  selected: true, expanded: false,
};
beforeEach(() => {
    localStorage.setItem('god-crm-language', 'ru');
  vi.clearAllMocks(); mocks.ctx.dataSource = 'internal'; mocks.ctx.expandedNodes = new Set();
  mocks.ctx.items = [{ id: 9, order: 1, level: 'h2', content: 'Overview' }, { id: 10, order: 2, level: 'divider' }];
  mocks.get.mockResolvedValue({ data: { conversationId: 12 } });
});

it('opens a document with Enter/Space and keeps status, chat and attach independent inside a form', async () => {
  const user = userEvent.setup(), submit = vi.fn();
  const { container } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}><SidebarDocRow doc={doc}/></form>, { wrapper: LanguageProvider });
  const open = screen.getByRole('button', { name: 'Открыть документ Guide' });
  open.focus(); await user.keyboard('{Enter} ');
  expect(mocks.ctx.setSelectedDocumentId).toHaveBeenNthCalledWith(1, 7);
  expect(mocks.ctx.setSelectedDocumentId).toHaveBeenCalledTimes(2);
  expect(mocks.ctx.setAtomsViewMode).toHaveBeenCalledWith(false);
  await user.click(screen.getByRole('button', { name: 'Draft' }));
  await user.click(screen.getByRole('button', { name: 'Review' }));
  expect(mocks.updateRow).toHaveBeenCalledWith('2197', '7', { status_id: 2, status: 'review' });
  await user.click(screen.getByRole('button', { name: 'Open document chat' }));
  expect(mocks.openDocumentChat).toHaveBeenCalledWith(7, 'Guide');
  screen.getByRole('button', { name: 'Attach to message' }).focus(); await user.keyboard(' ');
  expect(mocks.attach).toHaveBeenCalledWith(expect.objectContaining({ table_id: 2197, row_id: 7 }));
  expect(mocks.ctx.setSelectedDocumentId).toHaveBeenCalledTimes(2);
  expect(submit).not.toHaveBeenCalled(); expect(container.querySelector('button button')).toBeNull();
});

it('keeps public document rows free of internal chat and attach actions', () => {
  mocks.ctx.dataSource = 'public'; render(<SidebarDocRow doc={doc}/>, { wrapper: LanguageProvider });
  expect(screen.queryByRole('button', { name: 'Open document chat' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Attach to message' })).not.toBeInTheDocument();
});

it('uses an English accessible name for opening a document', () => {
  localStorage.setItem('god-crm-language', 'en');
  render(<SidebarDocRow doc={doc}/>, { wrapper: LanguageProvider });
  expect(screen.getByRole('button', { name: 'Open document Guide' })).toBeInTheDocument();
});

it('opens ticket chat with the keyboard without coupling attach or form submission', async () => {
  const user = userEvent.setup(), submit = vi.fn();
  const { container } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}><TicketsDataContext.Provider value={[{ id: 3, title: 'Fix keyboard' }]}><InlineTicketRow ticketRef="3" indent={12}/></TicketsDataContext.Provider></form>);
  const open = screen.getByRole('button', { name: 'Открыть чат тикета Fix keyboard' });
  open.focus(); await user.keyboard('{Enter} ');
  await waitFor(() => expect(mocks.openTaskChat).toHaveBeenCalledTimes(2));
  expect(mocks.get).toHaveBeenCalledWith('/chat/tasks/1708/3?create=true');
  expect(mocks.openTaskChat).toHaveBeenCalledWith({ conversationId: 12, tableId: 1708, rowId: 3, rowTitle: 'Fix keyboard' });
  screen.getByRole('button', { name: 'Прикрепить к сообщению' }).focus(); await user.keyboard('{Enter}');
  expect(mocks.attach).toHaveBeenCalledWith(expect.objectContaining({ table_id: 1708, row_id: 3 }));
  expect(mocks.get).toHaveBeenCalledTimes(2); expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('button button')).toBeNull();
});

it('reports a failed ticket chat request and allows retry', async () => {
  mocks.get.mockRejectedValueOnce(new Error('Offline'));
  const user = userEvent.setup();
  render(<TicketsDataContext.Provider value={[{ id: 3, title: 'Fix keyboard' }]}><InlineTicketRow ticketRef={3} indent={0}/></TicketsDataContext.Provider>);
  const open = screen.getByRole('button', { name: 'Открыть чат тикета Fix keyboard' });
  await user.click(open); expect(mocks.toast).toHaveBeenCalledWith('Не удалось открыть чат', 'error');
  expect(mocks.openTaskChat).not.toHaveBeenCalled();
  await user.click(open); expect(mocks.openTaskChat).toHaveBeenCalledOnce();
});

it('separates import preview, disclosure and selection keyboard actions', async () => {
  const user = userEvent.setup(), submit = vi.fn(), scroll = vi.fn();
  const { container, rerender } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}><ImportTreeNode node={node}/><div id="preview-1"/></form>);
  container.querySelector('#preview-1')!.scrollIntoView = scroll;
  const preview = screen.getByRole('button', { name: 'Предпросмотр Introduction' });
  preview.focus(); await user.keyboard('{Enter} ');
  expect(mocks.ctx.setActivePreviewOrder).toHaveBeenCalledTimes(2);
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  const expand = screen.getByRole('button', { name: 'Развернуть Introduction' });
  expect(expand).toHaveAttribute('aria-expanded', 'false'); expand.focus(); await user.keyboard(' ');
  const updateExpanded = mocks.ctx.setExpandedNodes.mock.calls[0][0] as (prev: Set<number>) => Set<number>;
  mocks.ctx.expandedNodes = updateExpanded(new Set());
  rerender(<ImportTreeNode node={node}/>);
  expect(screen.getByRole('button', { name: 'Свернуть Introduction' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Предпросмотр Child' })).toBeInTheDocument();
  screen.getByRole('checkbox', { name: 'Импортировать Introduction' }).focus(); await user.keyboard(' ');
  const updateTree = mocks.ctx.setImportTree.mock.calls[0][0] as (prev: SectionTreeNodeV4[]) => SectionTreeNodeV4[];
  const updated = updateTree([node]);
  expect(updated[0].section.selected).toBe(false); expect(updated[0].children).toEqual(node.children);
  expect(mocks.ctx.setActivePreviewOrder).toHaveBeenCalledTimes(2); expect(submit).not.toHaveBeenCalled();
});

it('navigates document headings and dividers with Enter/Space without submitting a form', async () => {
  const user = userEvent.setup(), submit = vi.fn(), scroll = vi.fn();
  const { container } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}><SidebarItemsTree showInlineWidgets={false} setShowInlineWidgets={vi.fn()}/><div id="item-9"/></form>, { wrapper: LanguageProvider });
  container.querySelector('#item-9')!.scrollIntoView = scroll;
  screen.getByRole('button', { name: /^Overview/ }).focus(); await user.keyboard('{Enter} ');
  expect(mocks.ctx.setSelectedItemId).toHaveBeenCalledTimes(2); expect(mocks.ctx.setSelectedItemId).toHaveBeenLastCalledWith(9);
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  screen.getByRole('button', { name: 'Разделитель' }).focus(); await user.keyboard(' ');
  expect(mocks.ctx.setSelectedItemId).toHaveBeenLastCalledWith(10); expect(submit).not.toHaveBeenCalled();
});
