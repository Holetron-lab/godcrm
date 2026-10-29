import { useCallback, useRef, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { getPendingValue, type useRowMutations } from '../../hooks/useRowMutations';
import { useTablesStore } from '../../store/tablesStore';
import type { ColumnModel, RowModel } from '../../types/table.types';
import type { UniversalTableProps } from './types';
import { formatGeoPoint, parseGeoPoint } from '../../../../../shared/geo-point.js';
import { parseAddressDraft } from '../cells/AddressCell';

interface TableCellEditingOptions {
  table: { id: string | number } | null | undefined;
  columns: (ColumnModel & { is_external?: boolean; _readonly?: boolean })[];
  rows: RowModel[];
  rowMutation: ReturnType<typeof useRowMutations>;
  isReadOnlyContext: boolean;
  isViewerRole: boolean;
  onLocalCellUpdate: UniversalTableProps['onLocalCellUpdate'];
}

export function useTableCellEditing({
  table, columns, rows, rowMutation, isReadOnlyContext, isViewerRole, onLocalCellUpdate,
}: TableCellEditingOptions) {
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [draftValue, setDraftValue] = useState('');

  const handleCellClick = useCallback((value: unknown, columnId: string, event?: React.MouseEvent) => {
    if (!event?.ctrlKey && !event?.metaKey) return;
    const column = columns.find((col: ColumnModel) => col.id === columnId);
    if (column?.type === 'password') return;
    if (column?.config?.copyable === false) return;
    const textValue = value == null ? '' : String(value);
    if (!textValue || textValue === '—' || textValue === '🔓 Not set') return;
    navigator.clipboard.writeText(textValue).then(() => {
      setTimeout(() => showToast('Copied to clipboard', 'success'), 0);
    }).catch(() => {
      setTimeout(() => showToast('Failed to copy', 'error'), 0);
    });
  }, [columns]);

  const handleCellDoubleClick = (rowId: string, columnId: string, initialValue: unknown) => {
    if (isReadOnlyContext || isViewerRole) return;
    const column = columns.find((col: ColumnModel) => col.id === columnId);
    if (!column) return;
    if (column.name.toLowerCase() === 'id') return;
    if (column.is_external) return;
    if (column.isReadonly) return;
    if (column._readonly) return;
    setEditingCell({ rowId, columnId });
    // ADR-0017: JSON columns may store object/array directly — preserve via JSON.stringify
    // ADR-0035: a geo_point cell is edited as its raw "lat, lng" text
    // ADR-0035-A: an address cell is edited as its JSON (the AddressEditor parses it back into fields)
    setDraftValue(
      (column.type === 'json' || column.type === 'address') && initialValue && typeof initialValue === 'object' ? JSON.stringify(initialValue, null, 2)
        : column.type === 'geo_point' ? formatGeoPoint(initialValue)
        : (initialValue ? String(initialValue) : '')
    );
  };

  const isCommittingRef = useRef(false);

  const handleCommitEdit = (valueOverride?: string) => {
    if (isCommittingRef.current) {
      logger.debug('[UniversalTable] handleCommitEdit - already committing, skipping');
      return;
    }
    const finalValue = valueOverride !== undefined ? valueOverride : draftValue;
    if (!table || !editingCell || isReadOnlyContext) return;
    const row = rows.find((item) => item.id === editingCell.rowId);
    if (!row) return;
    // ADR-0035: a geo_point cell commits through the one shared parser ("lat, lng" text → {lat, lng}).
    const columnId = editingCell.columnId;
    let value: unknown = finalValue;
    const target = columns.find((col: ColumnModel) => col.id === editingCell.columnId);
    if (target?.type === 'geo_point') {
      const text = String(finalValue ?? '').trim();
      const parsed = text ? parseGeoPoint(text) : null;
      if (text && !parsed) return; // invalid: keep the editor (and its inline error) open, nothing is sent
      value = parsed ? { ...parsed, source: 'raw' } : null;
    } else if (target?.type === 'address') {
      // ADR-0035-A: the editor commits a JSON object (→ full value), inline/raw text commits a plain
      // string (→ the server stores `{ formatted }`), '' clears.
      value = parseAddressDraft(String(finalValue ?? ''));
    }
    isCommittingRef.current = true;
    const nextData = { ...row.data, [columnId]: value };
    rowMutation.mutate({ rowId: editingCell.rowId, columnId, value, data: nextData });
    setEditingCell(null);
    setTimeout(() => { isCommittingRef.current = false; }, 100);
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
    setDraftValue('');
  };

  const handleCheckboxToggle = useCallback((
    rowId: string, columnId: string, currentValue: unknown,
    config?: { trueValue?: unknown; falseValue?: unknown }
  ) => {
    if (isReadOnlyContext || isViewerRole || !table) return;
    const trueValue = config?.trueValue ?? 1;
    const falseValue = config?.falseValue ?? 0;
    const isChecked = currentValue === trueValue || currentValue === true || currentValue === 1 || currentValue === '1' || currentValue === 'true' || String(currentValue) === String(trueValue);
    const newValue = isChecked ? falseValue : trueValue;
    const row = rows.find((item) => item.id === rowId);
    if (!row) return;
    const nextData = { ...row.data, [columnId]: newValue };
    rowMutation.mutate({ rowId, columnId, value: newValue, data: nextData });
  }, [isReadOnlyContext, isViewerRole, table, rows, rowMutation]);

  const handleNumberStep = useCallback((
    rowId: string, columnId: string, currentValue: unknown, direction: 1 | -1,
    config?: { step?: number; min?: number; max?: number }
  ) => {
    if (isReadOnlyContext || isViewerRole || !table) return;
    const step = config?.step ?? 1;
    const min = config?.min;
    const max = config?.max;
    const currentTableId = String(table.id);

    let freshValue: unknown;
    const pendingVal = getPendingValue(currentTableId, rowId, columnId);
    if (pendingVal !== undefined) {
      freshValue = pendingVal;
    } else {
      const storeRows = useTablesStore.getState().rows[currentTableId] ?? [];
      const storeRow = storeRows.find((r) => String(r.id) === String(rowId));
      if (storeRow?.data?.[columnId] !== undefined) {
        freshValue = storeRow.data[columnId];
      } else {
        freshValue = currentValue;
      }
    }

    const numValue = freshValue === null || freshValue === undefined || freshValue === '' ? 0 : Number(freshValue);
    let newValue = (isNaN(numValue) ? 0 : numValue) + direction * step;
    if (min !== undefined && newValue < min) newValue = min;
    if (max !== undefined && newValue > max) newValue = max;

    if (onLocalCellUpdate) { onLocalCellUpdate(rowId, columnId, newValue); }

    const row = rows.find((item) => String(item.id) === String(rowId));
    if (!row) return;
    const nextData = { ...row.data, [columnId]: newValue };
    rowMutation.mutate({ rowId, columnId, value: newValue, data: nextData });
  }, [isReadOnlyContext, isViewerRole, table, rows, rowMutation, onLocalCellUpdate]);

  return {
    editingCell, draftValue, setDraftValue,
    handleCellClick, handleCellDoubleClick, handleCommitEdit, handleCancelEdit,
    handleCheckboxToggle, handleNumberStep,
  };
}
