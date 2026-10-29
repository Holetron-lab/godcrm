import { afterEach, describe, test, expect, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkReplaceModal } from '../BulkReplaceModal';
import type { ColumnModel, RowModel } from '../../../types/table.types';
import type { BulkReplaceResult } from '../../../types/selection.types';

vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const columns: ColumnModel[] = [
  { id: 'col1', name: 'status', displayName: 'Status', isReadonly: false },
  { id: 'col2', name: 'priority', displayName: 'Priority', isReadonly: false },
  { id: 'col3', name: 'id', displayName: 'ID', isReadonly: true },
].map((column, orderIndex) => ({
  ...column, tableId: 'table1', type: 'text', config: {}, isRequired: false,
  orderIndex, width: 150, isVisible: true,
}));
const rows: RowModel[] = ['Draft', 'Active', 'Draft'].map((status, index) => ({
  id: String(index + 1), tableId: 'table1', data: { status, priority: 'High' },
  createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z', createdBy: '1',
}));
const success: BulkReplaceResult = { success: true, totalProcessed: 2, totalChanged: 2 };

function setup(overrides: Partial<ComponentProps<typeof BulkReplaceModal>> = {}) {
  const props = {
    open: true, onOpenChange: vi.fn(), columns, rows,
    selectedRowIds: new Set<string | number>(['1', '3']),
    filteredRowIds: ['1', '2'], allRowIds: ['1', '2', '3'],
    totalRows: 3,
    fetchAllRows: vi.fn<ComponentProps<typeof BulkReplaceModal>['fetchAllRows']>().mockResolvedValue(rows),
    onReplace: vi.fn<ComponentProps<typeof BulkReplaceModal>['onReplace']>().mockResolvedValue(success),
    ...overrides,
  };
  renderModal(props);
  return props;
}

function renderModal(props: ComponentProps<typeof BulkReplaceModal>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BulkReplaceModal {...props} /></QueryClientProvider>);
}

function configureReplacement(find = 'Draft', replace = 'Published') {
  fireEvent.change(screen.getByTestId('find-input'), { target: { value: find } });
  fireEvent.change(screen.getByTestId('replace-input'), { target: { value: replace } });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BulkReplaceModal', () => {
  test('renders an accessible dialog when open and nothing when closed', () => {
    const props = setup({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    renderModal({ ...props, open: true });
    expect(screen.getByRole('dialog', { name: 'bulkReplace.title' })).toBeInTheDocument();
  });

  test('cancels without replacing data', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'bulkReplace.cancel' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onReplace).not.toHaveBeenCalled();
  });

  test('offers editable columns and selects the default text column', () => {
    setup();
    expect(screen.getByRole('combobox')).toHaveValue('col1');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('option', { name: /ID/ })).not.toBeInTheDocument();
  });

  test.each([
    { selected: ['1', '3'], filtered: ['1', '2'], expected: 'scopeSelected' },
    { selected: [], filtered: ['1', '2'], expected: 'scopeFiltered' },
    { selected: [], filtered: ['1', '2', '3'], expected: 'scopeAll' },
  ])('defaults scope to $expected', ({ selected, filtered, expected }) => {
    setup({ selectedRowIds: new Set(selected), filteredRowIds: filtered });
    expect(screen.getByRole('radio', { name: new RegExp(expected) })).toBeChecked();
  });

  test('disables scopes with no rows', () => {
    setup({ selectedRowIds: new Set(), filteredRowIds: [] });
    expect(screen.getByRole('radio', { name: /scopeSelected/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /scopeFiltered/ })).toBeDisabled();
  });

  test('cannot execute without a column, search text or matching changes', () => {
    const props = setup({ columns: [] });
    configureReplacement();
    fireEvent.click(screen.getByTestId('replace-all-button'));
    expect(screen.getByTestId('replace-all-button')).toBeDisabled();
    expect(props.onReplace).not.toHaveBeenCalled();
  });

  test('updates the preview and enables execution only for matching changes', () => {
    setup();
    expect(screen.getByTestId('replace-all-button')).toBeDisabled();
    configureReplacement('Missing');
    expect(screen.getByTestId('replace-all-button')).toBeDisabled();
    configureReplacement();
    expect(screen.getByTestId('replace-all-button')).toBeEnabled();
    expect(screen.getByTestId('replace-all-button')).toHaveTextContent('(2)');
    fireEvent.click(screen.getByRole('button', { name: /bulkReplace.preview/ }));
    expect(screen.getAllByText('"Draft"')).toHaveLength(2);
    expect(screen.getAllByText('"Published"')).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: /scopeFiltered/ }));
    expect(screen.getByTestId('replace-all-button')).toHaveTextContent('(1)');
  });

  test('sends the selected column, scope and matching options to onReplace', async () => {
    const props = setup({ onReplace: vi.fn().mockResolvedValue({ ...success, totalChanged: 0 }) });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'col2' } });
    fireEvent.click(screen.getByRole('radio', { name: /scopeAll/ }));
    configureReplacement('^High$', 'Low');
    fireEvent.click(screen.getByRole('checkbox', { name: 'bulkReplace.caseSensitive' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'bulkReplace.regex' }));
    await waitFor(() => expect(screen.getByTestId('replace-all-button')).toBeEnabled());
    fireEvent.click(screen.getByTestId('replace-all-button'));
    await waitFor(() => expect(props.onReplace).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      columnId: 'col2', targetScope: 'all', operationType: 'replace',
      findValue: '^High$', replaceValue: 'Low', caseSensitive: true, useRegex: true,
    })));
  });

  // Ticket 22477: "all rows" used to mean the loaded, filtered window.
  test('counts and previews "all rows" from the whole table, not the loaded window', async () => {
    const loaded = rows.slice(0, 1);
    const props = setup({
      rows: loaded, selectedRowIds: new Set(), filteredRowIds: ['1'], allRowIds: ['1'],
      totalRows: 3, fetchAllRows: vi.fn().mockResolvedValue(rows),
    });
    const allScope = screen.getByRole('radio', { name: /scopeAll/ });
    expect(allScope).toBeChecked();
    expect(allScope).toHaveAccessibleName(/scopeAll\s*3$/);
    configureReplacement();
    await waitFor(() => expect(screen.getByTestId('replace-all-button')).toHaveTextContent('(2)'));
    expect(props.fetchAllRows).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /bulkReplace.preview/ }));
    expect(screen.getAllByText('"Draft"')).toHaveLength(2);
  });

  test('blocks execution until the whole table has loaded', async () => {
    let finish!: (all: RowModel[]) => void;
    const fetchAllRows = vi.fn(() => new Promise<RowModel[]>(resolve => { finish = resolve; }));
    setup({ selectedRowIds: new Set(), filteredRowIds: ['1', '2', '3'], fetchAllRows });
    configureReplacement();
    expect(screen.getByRole('status')).toHaveTextContent('bulkReplace.loadingAllRows');
    expect(screen.getByTestId('replace-all-button')).toBeDisabled();
    await act(async () => finish(rows));
    await waitFor(() => expect(screen.getByTestId('replace-all-button')).toBeEnabled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('does not load the whole table for the selected or filtered scope', () => {
    const props = setup();
    configureReplacement();
    fireEvent.click(screen.getByRole('radio', { name: /scopeFiltered/ }));
    expect(props.fetchAllRows).not.toHaveBeenCalled();
  });

  test('supports prefix and suffix in the combined add-text operation', async () => {
    const props = setup({ onReplace: vi.fn().mockResolvedValue({ ...success, totalChanged: 0 }) });
    fireEvent.click(screen.getByRole('radio', { name: 'bulkReplace.opAppend' }));
    expect(screen.queryByTestId('find-input')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('bulkReplace.prependPlaceholder'), { target: { value: '[' } });
    fireEvent.change(screen.getByPlaceholderText('bulkReplace.appendPlaceholder'), { target: { value: ']' } });
    fireEvent.click(screen.getByTestId('replace-all-button'));
    await waitFor(() => expect(props.onReplace).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'addText', prependValue: '[', appendValue: ']', findValue: undefined,
    })));
  });

  test('warns before clearing and submits the selected scope', async () => {
    const props = setup({ onReplace: vi.fn().mockResolvedValue({ ...success, totalChanged: 0 }) });
    fireEvent.click(screen.getByRole('radio', { name: 'bulkReplace.opClear' }));
    expect(screen.getByText('bulkReplace.clearWarning')).toBeInTheDocument();
    expect(screen.queryByTestId('find-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('replace-all-button')).toHaveTextContent('(2)');
    fireEvent.click(screen.getByTestId('replace-all-button'));
    await waitFor(() => expect(props.onReplace).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'clear', targetScope: 'selected', columnId: 'col1',
    })));
  });

  test('blocks duplicate submission and dismissal until replacement finishes', async () => {
    let finish!: (result: BulkReplaceResult) => void;
    const onReplace = vi.fn(() => new Promise<BulkReplaceResult>(resolve => { finish = resolve; }));
    const props = setup({ onReplace });
    configureReplacement();
    const button = screen.getByTestId('replace-all-button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('bulkReplace.processing');
    expect(screen.getByRole('button', { name: 'bulkReplace.cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => finish({ ...success, totalChanged: 0 }));
    expect(button).toBeEnabled();
  });

  test('shows success and closes after the confirmation delay', async () => {
    vi.useFakeTimers();
    const props = setup();
    configureReplacement();
    await act(async () => fireEvent.click(screen.getByTestId('replace-all-button')));
    expect(screen.getByText('bulkReplace.successChanged')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1500));
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  test('preserves input after a rejected request and allows retry', async () => {
    const onReplace = vi.fn().mockRejectedValueOnce(new Error('Database error'))
      .mockResolvedValue({ ...success, totalChanged: 0 });
    const props = setup({ onReplace });
    configureReplacement();
    fireEvent.click(screen.getByTestId('replace-all-button'));
    expect(await screen.findByText('Database error')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('find-input')).toHaveValue('Draft');
    expect(screen.getByTestId('replace-input')).toHaveValue('Published');
    fireEvent.click(screen.getByTestId('replace-all-button'));
    await waitFor(() => expect(onReplace).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Database error')).not.toBeInTheDocument();
  });

  test('keeps the modal open when replacement returns an unsuccessful result', async () => {
    vi.useFakeTimers();
    const props = setup({ onReplace: vi.fn().mockResolvedValue({
      success: false, totalProcessed: 2, totalChanged: 0, errors: [{ rowId: '1', error: 'Conflict' }],
    }) });
    configureReplacement();
    await act(async () => fireEvent.click(screen.getByTestId('replace-all-button')));
    act(() => vi.advanceTimersByTime(2000));
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText('bulkReplace.successChanged')).not.toBeInTheDocument();
  });
});
