import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrintModal } from '@/features/tables/components/PrintModal/PrintModal';

vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));
import { showToast } from '@/shared/hooks/useToast';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// The modal opens a blank popup first and writes the data into the popup's own sessionStorage.
const mockPopup = () => {
  const store = new Map<string, string>();
  const popup = {
    sessionStorage: { setItem: (key: string, value: string) => store.set(key, value) },
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  return { open, popup, stored: () => JSON.parse(store.get('printPreviewData') ?? 'null') };
};

const preview = () => fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));

describe('PrintModal row scopes', () => {
  const rows = [{ id: '1', data: { title: 'First' } }, { id: '2', data: { title: 'Second' } }];

  it.each([
    ['Всем строкам', rows],
    ['Выделенным строкам', [rows[1]]],
    ['Отфильтрованным строкам', [rows[0]]],
  ])('prints %s with minimal row data', async (scope, expected) => {
    const onClose = vi.fn();
    const { open, popup, stored } = mockPopup();
    render(<PrintModal isOpen onClose={onClose} columns={[]} rows={rows}
      tableName="Tickets" selectedRowIds={new Set(['2'])} filteredRowIds={['1']} />);
    expect(screen.getByRole('dialog', { name: 'Печать' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Применить к:' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(scope) }));
    preview();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(open).toHaveBeenCalledWith('', 'PrintPreview', expect.any(String));
    expect(stored()).toEqual({ columns: [], rows: expected, tableName: 'Tickets' });
    expect(popup.location.replace).toHaveBeenCalledWith('/print-preview');
  });

  it('counts the whole table and loads the rows beyond the loaded window', async () => {
    const onClose = vi.fn();
    const { stored } = mockPopup();
    const fetchAllRows = vi.fn().mockResolvedValue([...rows, { id: '3', data: {} }]);
    render(<PrintModal isOpen onClose={onClose} columns={[]} rows={rows} totalRows={300} fetchAllRows={fetchAllRows} />);
    expect(screen.getByRole('radio', { name: /Всем строкам 300/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Отфильтрованным строкам/ })).toBeDisabled();
    // the radio count and the "will print" summary both show the server total
    expect(screen.getAllByText('300')).toHaveLength(2);
    preview();
    expect(screen.getByRole('button', { name: 'Загрузка…' })).toBeDisabled();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetchAllRows).toHaveBeenCalledOnce();
    expect(stored().rows).toHaveLength(3);
  });

  it('closes the popup and reports when the rows cannot be loaded', async () => {
    const onClose = vi.fn();
    const { popup } = mockPopup();
    const fetchAllRows = vi.fn().mockRejectedValue(new Error('offline'));
    render(<PrintModal isOpen onClose={onClose} columns={[]} rows={rows} totalRows={300} fetchAllRows={fetchAllRows} />);
    preview();
    await waitFor(() => expect(popup.close).toHaveBeenCalledOnce());
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Не удалось'), 'error');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports a blocked popup instead of failing silently', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<PrintModal isOpen onClose={vi.fn()} columns={[]} rows={rows} />);
    preview();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('всплывающие окна'), 'error');
  });

  it('disables preview when the selected scope has no rows', () => {
    render(<PrintModal isOpen onClose={vi.fn()} columns={[]} rows={[]} />);
    expect(screen.getByRole('button', { name: 'Предпросмотр' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Выделенным строкам/ })).toBeDisabled();
  });
});
