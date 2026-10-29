import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TableNode } from '../components/nodes/TableNode';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { useSchemaEditorStore } from '../store/schemaEditorStore';
import type { ColumnData, TableNodeData } from '../types/schema-editor.types';

vi.mock('@xyflow/react', () => ({ Handle: () => null, Position: {}, useStore: () => 1 }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }));
vi.mock('@/features/tables/components/EditTableModal', () => ({ EditTableModal: () => null }));
vi.mock('@/features/tables/components/modals/CreateColumnModal', () => ({
  CreateColumnModal: ({ open, onSubmit }: { open: boolean; onSubmit: (data: { name: string; displayName: string; type: string }) => void }) =>
    open ? <button onClick={() => onSubmit({ name: 'd', displayName: 'D', type: 'text' })}>submit-column</button> : null,
}));
vi.mock('@/features/tables/components/UniversalTable/ColumnSettingsDrawer', () => ({ ColumnSettingsDrawer: () => null }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@/features/tables/api/tablesApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/tables/api/tablesApi')>();
  return { tablesApi: { ...actual.tablesApi, updateColumn: vi.fn().mockResolvedValue({}), createColumn: vi.fn().mockResolvedValue({ id: 99 }) } };
});

const data: TableNodeData = { tableId: 7, name: 'tickets', displayName: 'Tickets', key: 'tickets',
  icon: '📋', projectId: 1, isExternal: false, columns: [] };
let client: QueryClient;
beforeEach(() => {
  useSchemaEditorStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

const column = (id: string, name: string, orderIndex: number): ColumnData =>
  ({ id, name, displayName: name.toUpperCase(), type: 'text', isPrimaryKey: false, isForeignKey: false, isRequired: false, orderIndex });

it('shows the row count and persists "move down" from the column menu as order_index patches', async () => {
  const user = userEvent.setup();
  const columns: ColumnData[] = [
    { id: '0', name: 'id', displayName: 'ID', type: 'number', isPrimaryKey: true, isForeignKey: false, isRequired: true },
    column('11', 'a', 0), column('12', 'b', 1), column('13', 'c', 2),
  ];
  const nodeData = { ...data, columns, rowCount: 1234 };
  useSchemaEditorStore.setState({ nodes: [{ id: 'table-7', type: 'tableNode', position: { x: 0, y: 0 }, data: nodeData }] });
  render(<QueryClientProvider client={client}><MemoryRouter><TableNode data={nodeData} /></MemoryRouter></QueryClientProvider>);

  expect(screen.getByText('schemaEditor.rowsCount')).toBeInTheDocument();
  expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual(['Select ID', 'Select A', 'Select B', 'Select C']);

  // The virtual id row only previews; "a" is first among real columns so it can only move down.
  await user.click(screen.getAllByRole('button', { name: 'columnHeader.actions' })[1]);
  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}');
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toContain('schemaEditor.columnMenu.moveDown');
  expect(screen.queryByText('schemaEditor.columnMenu.moveUp')).not.toBeInTheDocument();
  await user.keyboard('{Enter}');

  await waitFor(() => expect(tablesApi.updateColumn).toHaveBeenCalledTimes(2));
  expect(tablesApi.updateColumn).toHaveBeenCalledWith('7', '12', { orderIndex: 0 });
  expect(tablesApi.updateColumn).toHaveBeenCalledWith('7', '11', { orderIndex: 1 });
  const stored = useSchemaEditorStore.getState().nodes[0].data.columns as ColumnData[];
  expect(stored.map((c) => `${c.name}:${c.orderIndex ?? '-'}`)).toEqual(['id:-', 'b:0', 'a:1', 'c:2']);
});

it('"add column above" creates the column and renumbers the real columns around the anchor', async () => {
  const user = userEvent.setup();
  const columns: ColumnData[] = [
    { id: '0', name: 'id', displayName: 'ID', type: 'number', isPrimaryKey: true, isForeignKey: false, isRequired: true },
    column('11', 'a', 0), column('12', 'b', 1), column('13', 'c', 2),
  ];
  const nodeData = { ...data, columns };
  render(<QueryClientProvider client={client}><MemoryRouter><TableNode data={nodeData} /></MemoryRouter></QueryClientProvider>);

  // The pinned id row cannot anchor an insert; real columns offer both directions.
  await user.click(screen.getAllByRole('button', { name: 'columnHeader.actions' })[0]);
  expect(screen.queryByRole('menuitem', { name: 'schemaEditor.columnMenu.addAbove' })).not.toBeInTheDocument();
  await user.keyboard('{Escape}');

  await user.click(screen.getAllByRole('button', { name: 'columnHeader.actions' })[2]);
  await user.click(screen.getByRole('menuitem', { name: 'schemaEditor.columnMenu.addAbove' }));
  await user.click(screen.getByText('submit-column'));

  await waitFor(() => expect(tablesApi.updateColumn).toHaveBeenCalledTimes(3));
  expect(tablesApi.createColumn).toHaveBeenCalledExactlyOnceWith('7', { name: 'd', displayName: 'D', type: 'text', config: {} });
  expect(tablesApi.updateColumn).toHaveBeenCalledWith('7', '99', { orderIndex: 1 });
  expect(tablesApi.updateColumn).toHaveBeenCalledWith('7', '12', { orderIndex: 2 });
  expect(tablesApi.updateColumn).toHaveBeenCalledWith('7', '13', { orderIndex: 3 });
  expect(screen.queryByText('submit-column')).not.toBeInTheDocument();
});

it('does not load hidden add-row forms across a large schema; loads only the opened table', async () => {
  render(<QueryClientProvider client={client}><MemoryRouter>
    {Array.from({ length: 60 }, (_, index) => <TableNode key={index} data={{ ...data, tableId: index + 7 }} />)}
  </MemoryRouter></QueryClientProvider>);
  expect(apiClient.get).not.toHaveBeenCalled();

  fireEvent.click(screen.getAllByTitle('Table options')[0]);
  fireEvent.click(screen.getByText('schemaEditor.tableMenu.addRow'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(apiClient.get).toHaveBeenCalledExactlyOnceWith('/form-configs/7?formType=add_row');

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getAllByTitle('Table options')[0]);
  fireEvent.click(screen.getByText('schemaEditor.tableMenu.addRow'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

it('"Lock position" in the header menu pins the store node and shows the unlock pin in the header', () => {
  useSchemaEditorStore.setState({
    nodes: [{ id: 'table-7', type: 'tableNode', position: { x: 1, y: 2 }, data }],
  });
  const { rerender } = render(<QueryClientProvider client={client}><MemoryRouter>
    <TableNode data={data} />
  </MemoryRouter></QueryClientProvider>);
  expect(screen.queryByTitle('schemaEditor.tableMenu.unpin')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Table options'));
  fireEvent.click(screen.getByText('schemaEditor.tableMenu.pin'));
  const node = useSchemaEditorStore.getState().nodes[0];
  expect(node.draggable).toBe(false);
  expect(node.data.isPinned).toBe(true);

  rerender(<QueryClientProvider client={client}><MemoryRouter>
    <TableNode data={node.data as TableNodeData} />
  </MemoryRouter></QueryClientProvider>);
  expect(screen.getByTitle('schemaEditor.tableMenu.unpin')).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Table options'));
  expect(screen.getByText('schemaEditor.tableMenu.unpin', { selector: 'span' })).toBeInTheDocument();
});

it('draws the modules built on the table as strips above the card and hides them with the toolbar toggle', () => {
  const nodeData: TableNodeData = { ...data, widgets: [
    { widgetId: 9, name: 'Board', icon: '📋', presetName: 'kanban_board' },
    { widgetId: 10, name: 'Grid', icon: '', presetName: 'table_view' },
  ] };
  const { rerender } = render(<QueryClientProvider client={client}><MemoryRouter>
    <TableNode data={nodeData} />
  </MemoryRouter></QueryClientProvider>);
  const strips = screen.getByTestId('table-widget-strips');
  expect(strips.querySelectorAll('[data-testid^="table-widget-"]')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'schemaEditor.navMenu.openWidget: Board' })).toBeInTheDocument();
  // the card paints over the strips: strips first in DOM, card on top via z-index
  expect(strips.nextElementSibling).toBe(screen.getByTestId('schema-node-7'));

  useSchemaEditorStore.getState().toggleWidgets();
  rerender(<QueryClientProvider client={client}><MemoryRouter>
    <TableNode data={nodeData} />
  </MemoryRouter></QueryClientProvider>);
  expect(screen.queryByTestId('table-widget-strips')).not.toBeInTheDocument();
});
