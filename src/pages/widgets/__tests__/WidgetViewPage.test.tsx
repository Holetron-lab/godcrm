import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { TicketRowData } from '@/features/widgets/hooks/useTicketData';
import type { CardDetailModalProps } from '@/features/widgets/components/modals/card-detail-types';
import { WidgetViewPage } from '@/pages/widgets/WidgetViewPage';
import { WidgetViewPage as PresetPage } from '@/features/widgets/components/presets/WidgetViewPage';

const state = vi.hoisted(() => ({
  widget: { id: 17, title: 'Tickets', preset_name: 'table_view', project_id: 11, config: { table_id: 1708 } },
  rows: [] as TicketRowData[],
  get: vi.fn(),
}));
vi.mock('@/features/widgets/hooks/useTicketData', () => ({ useTicketData: () => ({
  widget: state.widget, widgetData: state.rows, tableColumns: [], columnsInfo: [],
  relationData: new Map(), kanbanColumnOptions: [], refetchData: vi.fn(),
}) }));
vi.mock('@/features/ai-chat', () => ({ useAIChat: () => ({ openTaskChat: vi.fn(), openChat: vi.fn(), attachRowToChat: vi.fn(), attachRowToMessage: vi.fn() }) }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'ru' }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: state.get } }));
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: {} }));
vi.mock('@/features/widgets/components/presets/TableViewWidget', () => ({
  TableViewWidget: ({ onRowDoubleClick }: { onRowDoubleClick: (row: TicketRowData) => void }) =>
    <button onClick={() => onRowDoubleClick(state.rows[0])}>Open row</button>,
}));
vi.mock('@/features/widgets/components/modals/CardDetailModal', () => ({
  CardDetailModal: ({ isOpen, card }: CardDetailModalProps) => isOpen && card
    ? <output aria-label="Card">{JSON.stringify(card)}</output> : null,
}));
vi.mock('@/features/tables/components/TableFilters/TableFilters', () => ({
  TableFilters: () => <span>Table filters</span>,
}));
vi.mock('@/features/tables/components/PrintModal', () => ({
  PrintModal: ({ tableName, viewType }: { tableName: string; viewType: string }) => <output aria-label="Print">{tableName}:{viewType}</output>,
}));
vi.mock('@/features/widgets/components/presets/KanbanWidget', () => ({ KanbanWidget: () => null }));
vi.mock('@/features/widgets/components/presets/CalendarWidget', () => ({ CalendarWidget: () => null }));
vi.mock('@/features/widgets/components/presets/TimelineWidget', () => ({ TimelineWidget: () => null }));
vi.mock('@/features/widgets/components/presets/ChartWidget', () => ({ ChartWidget: () => null }));
vi.mock('@/features/widgets/components/presets/GalleryWidget', () => ({ GalleryWidget: () => null }));
vi.mock('@/features/widgets/components/presets/NumberWidget', () => ({ NumberWidget: () => null }));
vi.mock('@/features/widgets/components/presets/TaskListWidget', () => ({ TaskListWidget: () => null }));
vi.mock('@/features/widgets/components/presets/AIAgentsWidget', () => ({ AIAgentsWidget: () => null }));
vi.mock('@/features/widgets/components/presets/DocumentsWidget', () => ({
  DocumentsWidget: ({ spaceId }: { spaceId?: number }) => <output aria-label="Documents space">{spaceId ?? 'widget metadata'}</output>,
}));
vi.mock('@/features/widgets/components/presets/FitnessWidget', () => ({ FitnessWidget: () => null }));
vi.mock('@/features/widgets/components/presets/LabsWidget', () => ({ LabsWidget: () => null }));
vi.mock('@/features/widgets/components/presets/TerminalWidget', () => ({ TerminalWidget: () => null }));
vi.mock('@/features/widgets/components/presets/virtual-office', () => ({ VirtualOfficeWidget: () => null }));
vi.mock('@/features/widgets/components/modals/AddColumnOptionModal', () => ({ AddColumnOptionModal: () => null }));
vi.mock('@/features/widgets/components/modals/GalleryCardDetailModal', () => ({ GalleryCardDetailModal: () => null }));
vi.mock('@/features/tables/components/modals/AddRowModal', () => ({ AddRowModal: () => null }));

afterEach(cleanup);
beforeEach(() => {
  state.widget.preset_name = 'table_view';
  state.rows = [{ id: 42, data: { title: 'Row' } }];
  state.get.mockReset();
});

describe.each([['page', WidgetViewPage], ['preset', PresetPage]] as const)('%s row contract', (_name, Page) => {
  function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
  }

  it.each([
    { id: 42, data: { title: 'Row' } },
    { data: { id: 42, title: 'Row' } },
    { id: 42, title: 'Row' },
  ])('opens wrapped and flat rows with a string ID', row => {
    state.rows = [row];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open row' }));
    const card = JSON.parse(screen.getByLabelText('Card').textContent!);
    expect(card.id).toBe('42');
    expect(card.data.title).toBe('Row');
  });

  it('does not open an editable card without a row ID', () => {
    state.rows = [{ data: { title: 'Missing ID' } }];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open row' }));
    expect(screen.queryByLabelText('Card')).not.toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });

  it.each([['timeline_widget', 'timeline'], ['calendar_widget', 'calendar'], ['table_view', 'table']])('passes the %s print mode and widget title', (preset, mode) => {
    state.widget.preset_name = preset;
    mount();
    expect(screen.getByLabelText('Print')).toHaveTextContent(`Tickets:${mode}`);
  });
});

it('shows filters for the canonical table_view preset', () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><WidgetViewPage /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByText('Table filters')).toBeInTheDocument();
});

it('does not pass a project ID as the documents space', () => {
  state.widget.preset_name = 'documents';
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><WidgetViewPage /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByLabelText('Documents space')).toHaveTextContent('widget metadata');
});
