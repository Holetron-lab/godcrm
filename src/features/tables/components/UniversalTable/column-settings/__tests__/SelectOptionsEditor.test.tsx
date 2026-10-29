import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tablesApi } from '@/features/tables/api/tablesApi';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import { createSelectColumn } from '../../__tests__/columnSettingsTestUtils';
import { SelectOptionsEditor } from '../SelectOptionsEditor';

vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getRows: vi.fn() } }));
const column = createSelectColumn({ id: '8', tableId: '123' });
const noop = () => {};
function Fixture() {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<ColumnModel | null>(column);
  if (!draft) return null;
  return <>
    <SelectOptionsEditor draft={draft} setDraft={setDraft} column={column} t={t}
      options={draft.config?.options || []}
      relationConfig={undefined} availableTables={[]} importTableColumns={[]}
      handleExportOptionsCsv={noop} handleImportOptionsCsv={noop} handleImportFromTable={noop}
      importFromTableOpen={false} setImportFromTableOpen={noop} importTableId="" setImportTableId={noop}
      importValueColumn="" setImportValueColumn={noop} importLabelColumn="" setImportLabelColumn={noop}
      optionsSubTab="options" setOptionsSubTab={noop} setActiveTab={noop} />
    <output data-testid="draft">{JSON.stringify(draft.config?.options)}</output>
    <button onClick={() => setDraft({ ...draft, displayName: 'Edited during collection' })}>Edit name</button>
    <output data-testid="name">{draft.displayName}</output>
  </>;
}
const renderEditor = () => render(<LanguageProvider><Fixture /></LanguageProvider>);
const page = (number: number, values: string[], pages = 2) => ({
  rows: values.map((status, index) => ({ id: `${number}-${index}`, tableId: '123', data: { status }, createdAt: '', updatedAt: '', createdBy: '' })),
  pagination: { page: number, limit: 500, total: pages * 500, pages },
});
const collect = () => screen.getByRole('button', { name: /Collect from/ });

describe('collect options from the whole table', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem('god-crm-language', 'en');
  });

  it('reads all pages, merges once, preserves edits and existing colors, and removes duplicates', async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    vi.mocked(tablesApi.getRows).mockResolvedValueOnce(page(1, [...Array<string>(499).fill('active'), 'first']))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderEditor();
    await userEvent.click(collect());
    await waitFor(() => expect(tablesApi.getRows).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /Collecting/ })).toBeDisabled();
    expect(screen.getByTestId('draft')).not.toHaveTextContent('first');
    await userEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    await act(async () => finish(page(2, ['first', 'last'])));
    expect(screen.getByTestId('draft')).toHaveTextContent('last');
    expect(JSON.parse(screen.getByTestId('draft').textContent || '[]')).toEqual([
      ...column.config.options!,
      expect.objectContaining({ value: 'first' }), expect.objectContaining({ value: 'last' }),
    ]);
    expect(screen.getByTestId('name')).toHaveTextContent('Edited during collection');
    expect(tablesApi.getRows).toHaveBeenNthCalledWith(1, '123', 1, 500, false, '__row_id', 'asc');
    expect(tablesApi.getRows).toHaveBeenNthCalledWith(2, '123', 2, 500, false, '__row_id', 'asc');
  });

  it('keeps the draft on a later page failure and lets the user retry', async () => {
    vi.mocked(tablesApi.getRows).mockResolvedValueOnce(page(1, ['partial']))
      .mockRejectedValueOnce(new Error('offline'));
    renderEditor();
    await userEvent.click(collect());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not collect');
    expect(screen.getByTestId('draft')).not.toHaveTextContent('partial');
    vi.mocked(tablesApi.getRows).mockResolvedValueOnce(page(1, ['retry'], 1));
    await userEvent.click(collect());
    await waitFor(() => expect(screen.getByTestId('draft')).toHaveTextContent('retry'));
  });
  it('uses Russian labels and a whole-table action in Russian', () => {
    localStorage.setItem('god-crm-language', 'ru');
    renderEditor();
    expect(screen.getByRole('button', { name: /Собрать из всей таблицы/ })).toBeEnabled();
    expect(screen.getAllByLabelText('Название')).toHaveLength(2);
    expect(screen.getAllByLabelText('Значение')).toHaveLength(2);
    expect(screen.getAllByLabelText('Цвет в формате HEX')).toHaveLength(2);
    expect(screen.queryByText(/columnSettings\./)).not.toBeInTheDocument();
  });

  it('reports an empty table without changing existing options', async () => {
    vi.mocked(tablesApi.getRows).mockResolvedValueOnce(page(1, [], 0));
    renderEditor();
    await userEvent.click(collect());
    expect(await screen.findByText('No non-empty values found in this column.')).toHaveAttribute('role', 'status');
    expect(JSON.parse(screen.getByTestId('draft').textContent || '[]')).toEqual(column.config.options);
  });

  it('stops reading pages when the editor is closed', async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    vi.mocked(tablesApi.getRows).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderEditor();
    await userEvent.click(collect());
    view.unmount();
    await act(async () => finish(page(1, ['late'])));
    expect(tablesApi.getRows).toHaveBeenCalledTimes(1);
  });

});
