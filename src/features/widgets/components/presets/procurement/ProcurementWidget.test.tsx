import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import type { Widget } from '../../../types/widget.types';
import { ProcurementWidget } from './ProcurementWidget';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { loadSupplies } from './loadSupplies';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import { EditRowModal } from '@/features/tables/components/modals/EditRowModal';
vi.mock('./loadSupplies', () => ({ loadSupplies: vi.fn() }));
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getColumns: vi.fn(), createRow: vi.fn(), updateRow: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/features/tables/components/modals/AddRowModal', () => ({ AddRowModal: ({ onConfirm }: ComponentProps<typeof AddRowModal>) => <button onClick={() => onConfirm({ order: 'New', supplier: '4', status: 'Заказано', amount: 200, paid: 0, currency: 'RUB' })}>Подтвердить создание</button> }));
vi.mock('@/features/tables/components/modals/EditRowModal', () => ({ EditRowModal: ({ onSave }: ComponentProps<typeof EditRowModal>) => <button onClick={() => onSave({ '5': 50, '7': 999 })}>Оплатить часть</button> }));
const widget = { id: 1, config: { table_id: 5, procurement: { supplier_table_id: 6 } } } as Widget;
const fields = ['order', 'supplier', 'expected_date', 'status', 'amount', 'paid', 'currency', 'balance', 'payment_due', 'invoice', 'delivery_note', 'closing_documents', 'responsible'];
let data: Record<string, unknown>;
function Location() { return <output aria-label="URL">{useLocation().search}</output>; }
function mount(url = '/') {
  return render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProcurementWidget widget={widget} /><Location /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  data = { order: 'Заказ один', supplier: 4, status: 'Заказано', amount: 100, paid: 0, currency: 'RUB', expected_date: '2026-10-14', payment_due: '2026-10-14' };
  vi.mocked(tablesApi.getColumns).mockResolvedValue({ userRole: 'owner', columns: fields.map((name, index) => ({ id: String(index), tableId: '5', isRequired: false, isReadonly: false, width: 150, name, displayName: name, type: name === 'supplier' ? 'select' : 'text', config: name === 'supplier' ? { relation: { enabled: true, type: 'link', tableId: '6', valueColumn: 'id', labelColumn: 'поставщик' } } : {}, isVisible: true, orderIndex: index })) });
  vi.mocked(loadSupplies).mockImplementation(async id => [{ id: id === 5 ? '1' : '4', data: id === 5 ? { ...data } : { поставщик: 'Поставщик А' }, tableId: String(id), createdAt: '', updatedAt: '', createdBy: '1' }]);
});
describe('supply workspace', () => {
  it('persists the selected view in the URL and restores it on remount', async () => {
    const first = mount();
    await screen.findByText('Заказ один');
    fireEvent.change(screen.getByLabelText('Вид поставок'), { target: { value: 'documents' } });
    expect(screen.getByLabelText('URL')).toHaveTextContent('supplies_1=documents');
    first.unmount(); mount('/?supplies_1=documents');
    expect(await screen.findByLabelText('Вид поставок')).toHaveValue('documents');
  });
  it('updates stored data, recalculates balance, and never writes the derived balance', async () => {
    vi.mocked(tablesApi.updateRow).mockImplementation(async (_table, _id, patch) => { data = { ...data, ...patch }; return { id: '1', data }; });
    mount(); fireEvent.click(await screen.findByText('Заказ один'));
    fireEvent.click(screen.getByText('Оплатить часть'));
    await waitFor(() => expect(tablesApi.updateRow).toHaveBeenCalledWith('5', '1', { paid: 50 }));
    await waitFor(() => expect(loadSupplies).toHaveBeenCalledTimes(4));
    expect(screen.getByText('Поставщик А')).toBeInTheDocument();
  });
  it('retains the create form after a failed save', async () => {
    vi.mocked(tablesApi.createRow).mockRejectedValue(new Error('Сохранение недоступно'));
    mount(); fireEvent.click(await screen.findByText('Добавить поставку')); fireEvent.click(screen.getByText('Подтвердить создание'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Сохранение недоступно');
    expect(screen.getByText('Подтвердить создание')).toBeInTheDocument();
  });
  it('shows a retryable error instead of zero financial totals', async () => {
    vi.mocked(loadSupplies).mockRejectedValue(new Error('Нет связи'));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи');
    expect(screen.queryByLabelText('Сводка поставок')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
