import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/shared/components/ui';
import { showToast } from '@/shared/hooks/useToast';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import { EditRowModal } from '@/features/tables/components/modals/EditRowModal';
import { TableViewWidget } from '../TableViewWidget';
import type { Widget } from '../../../types/widget.types';
import { describeSupply, moscowToday, summarizeSupplies, supplyViews, type SupplyView } from './procurement';
import { loadSupplies } from './loadSupplies';

function currencyTotals(values: Record<string, number>): string {
  const entries = Object.entries(values);
  return entries.length ? entries.map(([currency, value]) => `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`).join(' · ') : 'Нет платежей';
}

export function ProcurementWidget({ widget }: { widget: Widget }) {
  const tableId = Number(widget.config.table_id);
  const supplierTableId = Number(widget.config.procurement?.supplier_table_id);
  const [params, setParams] = useSearchParams();
  const viewKey = `supplies_${widget.id}`;
  const requestedView = params.get(viewKey) ?? 'all';
  const view: SupplyView = Object.prototype.hasOwnProperty.call(supplyViews, requestedView) ? requestedView as SupplyView : 'all';
  const [today, setToday] = useState(moscowToday);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const saving = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(moscowToday()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const query = useQuery({
    queryKey: ['procurement', tableId, supplierTableId],
    queryFn: async () => {
      if (!Number.isSafeInteger(tableId) || tableId <= 0 || !Number.isSafeInteger(supplierTableId) || supplierTableId <= 0) throw new Error('Не настроена таблица поставок');
      const [{ columns }, rows, suppliers] = await Promise.all([
        tablesApi.getColumns(String(tableId)), loadSupplies(tableId), loadSupplies(supplierTableId),
      ]);
      const required = ['order', 'supplier', 'expected_date', 'status', 'amount', 'paid', 'currency', 'balance', 'payment_due', 'invoice', 'delivery_note', 'closing_documents', 'responsible'];
      if (!required.every(name => columns.some(column => column.name === name))) throw new Error('Схема поставок изменилась. Проверьте настройку таблицы');
      const relationData = new Map([[String(supplierTableId), new Map(suppliers.map(row => [String(row.id), { label: String(row.data['поставщик'] ?? row.id) }]))]]);
      return { columns, rows, relationData };
    },
    retry: false,
    refetchInterval: adding || selectedId ? false : 60000,
    refetchOnWindowFocus: !adding && !selectedId,
  });

  const editableColumns = useMemo(() => query.data?.columns.filter(column => column.name !== 'balance') ?? [], [query.data?.columns]);

  async function save(data: Record<string, unknown>, rowId?: string) {
    if (saving.current || !query.data) return;
    const existing = query.data.rows.find(row => String(row.id) === rowId)?.data ?? {};
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const column = query.data.columns.find(column => column.name === key || column.id === key);
      if (column && column.name !== 'balance') patch[column.name] = value;
    }
    const full = { ...existing, ...patch };
    const description = describeSupply(full, today);
    if (description.balance === null || description.currency === null || !String(full.order ?? '').trim() || !full.supplier || !['Заказано', 'Подтверждено', 'В пути', 'Получено'].includes(String(full.status))) {
      const message = 'Укажите заказ, поставщика, статус, валюту и неотрицательные сумму и оплату.';
      setSaveError(message); showToast(message, 'error'); throw new Error(message);
    }
    saving.current = true; setSaveError(null);
    try {
      if (rowId) await tablesApi.updateRow(String(tableId), rowId, patch);
      else await tablesApi.createRow(String(tableId), patch);
      setAdding(false); setSelectedId(null);
      await query.refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить поставку';
      setSaveError(message); showToast(message, 'error'); throw error;
    } finally { saving.current = false; }
  }

  if (query.isPending) return <p role="status" className="p-4">Загружаем поставки и оплаты…</p>;
  if (query.isError || !query.data) return <div role="alert" className="p-4 space-y-3"><p>Сводка недоступна: {query.error instanceof Error ? query.error.message : 'не удалось загрузить данные'}</p><Button onClick={() => void query.refetch()}>Повторить</Button></div>;

  const { rows, columns, relationData } = query.data;
  const summary = summarizeSupplies(rows.map(row => row.data), today);
  const displayRows = rows.flatMap(row => {
    const state = describeSupply(row.data, today);
    if ((view === 'waiting' && !state.waiting) || (view === 'payment' && !state.needsPayment) || (view === 'documents' && !state.missingDocuments)) return [];
    return [{ ...row, data: { ...row.data, amount: row.data.amount === '' || row.data.amount == null ? 'Не указана' : row.data.amount, paid: row.data.paid === '' || row.data.paid == null ? 'Не указано' : row.data.paid, balance: state.balance ?? 'Нет данных', expected_date: row.data.expected_date || 'Не указана', payment_due: row.data.payment_due || 'Не указан', responsible: row.data.responsible || 'Не назначен', documents_status: state.missingDocuments ? 'Не хватает документов' : 'Комплект отмечен' } }];
  });
  const selected = rows.find(row => String(row.id) === selectedId);
  const columnsInfo = columns.map(column => ({ name: column.name, displayName: column.displayName, type: ['balance', 'amount', 'paid', 'status', 'currency', 'expected_date', 'payment_due'].includes(column.name) ? 'text' : column.type, config: column.config, isVisible: column.isVisible, orderIndex: column.orderIndex }));
  columnsInfo.push({ name: 'documents_status', displayName: 'Документы', type: 'text', config: {}, isVisible: true, orderIndex: 100 });
  const tableWidget = { ...widget, config: { ...widget.config, procurement: undefined, visible_columns: ['order', 'supplier', 'expected_date', 'status', 'amount', 'paid', 'balance', 'currency', 'payment_due', 'documents_status', 'responsible'] } };
  return <section className="p-3 space-y-4" aria-label="Поставки и оплаты">
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Сводка поставок">
      {[
        ['К оплате на этой неделе', currencyTotals(summary.week)],
        ['Просроченные оплаты', currencyTotals(summary.overdue)],
        ['Ближайшие поставки', String(summary.upcoming)],
        ['Задержки', String(summary.delayed)],
      ].map(([label, value]) => <div key={label} className="rounded border border-[var(--border-primary)] p-3"><dt className="text-sm text-[var(--text-secondary)]">{label}</dt><dd className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{value}</dd></div>)}
    </dl>
    <details className="text-sm text-[var(--text-secondary)]"><summary className="cursor-pointer">Правила расчёта и документов</summary><p className="mt-2">Даты — Europe/Moscow. Неделя: понедельник–воскресенье, включая уже просроченные платежи этой недели. Ближайшие поставки: сегодня и следующие 6 дней. Задержка и просрочка: дата раньше сегодня. Полученные поставки исключены из ожидания. Остаток = сумма − оплачено; отрицательный остаток — переплата. Валюты считаются отдельно. Счёт обязателен; после получения нужны накладная и закрывающие. Проверяется наличие вложений, а не их содержание.</p></details>
    {summary.incomplete > 0 && <p role="status" className="text-sm text-[var(--text-secondary)]">Неполные данные: {summary.incomplete}. Заполните суммы, валюту, статус и даты. Неизвестные суммы и даты исключены из соответствующих показателей.</p>}
    {saveError && <p role="alert">{saveError}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-semibold mr-auto">Поставки и оплаты</h2>
      <label className="flex items-center gap-2 text-sm">Вид<select aria-label="Вид поставок" className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1" value={view} onChange={event => setParams(previous => { const next = new URLSearchParams(previous); next.set(viewKey, event.target.value); return next; }, { replace: true })}>{Object.entries(supplyViews).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <Button size="sm" onClick={() => setAdding(true)}>Добавить поставку</Button>
      <Button size="sm" variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>Обновить</Button>
    </div>
    <p className="text-sm text-[var(--text-secondary)]">Показано {displayRows.length} из {rows.length}. Откройте строку, чтобы изменить поставку или приложить документы.</p>
    {displayRows.length ? <TableViewWidget widget={tableWidget} data={displayRows} columnsInfo={columnsInfo} relationData={relationData} onRowClick={row => setSelectedId(String(row.id))} /> : <p className="py-6 text-center text-[var(--text-secondary)]">{rows.length ? 'В этом виде поставок нет' : 'Поставок пока нет. Добавьте первый заказ.'}</p>}
    {adding && <AddRowModal isOpen onClose={() => { if (!saving.current) setAdding(false); }} columns={editableColumns} tableId={tableId} tableName="Поставки и оплаты" prefilledData={{ status: 'Заказано', paid: 0, currency: 'RUB' }} onConfirm={data => { void save(data).catch(() => undefined); }} />}
    {selected && <EditRowModal isOpen onClose={() => { if (!saving.current) setSelectedId(null); }} rowId={String(selected.id)} rowData={selected.data} columns={editableColumns} tableId={tableId} tableName="Поставки и оплаты" onSave={data => { void save(data, String(selected.id)).catch(() => undefined); }} />}
  </section>;
}
