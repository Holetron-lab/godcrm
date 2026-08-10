import { useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/shared/hooks/useToast';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { tablesApi } from '../../api/tablesApi';
import { useTablesStore } from '../../store/tablesStore';
import { useAIChat } from '@/features/ai-chat/context/AIChatContext';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel, RowModel } from '../../types/table.types';

interface UseTableRowActionsParams {
  table: any;
  columns: any[];
  columnsRaw: any[];
  rows: any[];
  isReadOnlyContext: boolean;
  isViewerRole: boolean;
  ticketsTableId: number | null;
  setDuplicateModalOpen: (open: boolean) => void;
  setRowToDuplicate: (row: any) => void;
  setEditModalOpen: (open: boolean) => void;
  setRowToEdit: (row: any) => void;
  setDeleteConfirmOpen: (open: boolean) => void;
  selectedRowIds: Set<any>;
  clearSelection: () => void;
  rowToEdit: any;
}

export const useTableRowActions = ({
  table,
  columns,
  columnsRaw,
  rows,
  isReadOnlyContext,
  isViewerRole,
  ticketsTableId,
  setDuplicateModalOpen,
  setRowToDuplicate,
  setEditModalOpen,
  setRowToEdit,
  setDeleteConfirmOpen,
  selectedRowIds,
  clearSelection,
  rowToEdit,
}: UseTableRowActionsParams) => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const updateRow = useTablesStore((state) => state.updateRow);
  const { openTaskChat, attachRowToChat, attachRowToMessage } = useAIChat();

  // Handle opening row chat (auto-routing: tasks vs rows endpoint)
  const handleOpenRowChat = useCallback(async (rowId: string) => {
    if (!table?.id) return;
    const endpoint = (ticketsTableId && Number(table.id) === Number(ticketsTableId))
      ? `/chat/tasks/${table.id}/${rowId}?create=true`
      : `/chat/rows/${table.id}/${rowId}?create=true`;
    try {
      const response = await apiClient.get<{ data: { conversationId?: number; id?: number; multi?: boolean; conversations?: Array<{ id: number; title: string | null; type: string; created_at: string; updated_at: string; messages_count: number }> } }>(endpoint);
      const responseData = response as { data?: { conversationId?: number; id?: number; multi?: boolean; conversations?: Array<{ id: number; title: string | null; type: string; created_at: string; updated_at: string; messages_count: number }> } };
      const convId = responseData?.data?.conversationId || responseData?.data?.id;
      if (convId) {
        const row = rows.find(r => r.id === rowId);
        const titleCol = columnsRaw.find(c => c.type === 'text');
        const title = (titleCol && row?.data[titleCol.name])
          ? String(row.data[titleCol.name])
          : `#${rowId}`;
        openTaskChat({
          conversationId: Number(convId),
          tableId: Number(table.id),
          rowId: Number(rowId),
          rowTitle: title,
          multi: responseData?.data?.multi || false,
          conversations: responseData?.data?.conversations
        });
      }
    } catch (err) {
      logger.error('[UniversalTable] openRowChat failed:', err);
      showToast('Failed to open chat', 'error');
    }
  }, [table?.id, ticketsTableId, rows, columnsRaw, openTaskChat]);

  // Handle attaching row to current chat conversation
  const handleAttachRowToChat = useCallback((rowId: string) => {
    if (!table?.id) return;
    const row = rows.find(r => r.id === rowId);
    const titleCol = columnsRaw.find(c => c.type === 'text');
    const title = (titleCol && row?.data[titleCol.name])
      ? String(row.data[titleCol.name])
      : `#${rowId}`;
    attachRowToChat({
      table_id: Number(table.id),
      row_id: Number(rowId),
      table_name: table.name || undefined,
      table_icon: (table as { icon?: string }).icon || undefined,
      row_title: title
    });
  }, [table?.id, table?.name, rows, columnsRaw, attachRowToChat]);

  // Handle attaching row to current message input
  const handleAttachRowToMessage = useCallback((rowId: string) => {
    if (!table?.id) return;
    const row = rows.find(r => r.id === rowId);
    const titleCol = columnsRaw.find(c => c.type === 'text');
    const title = (titleCol && row?.data[titleCol.name])
      ? String(row.data[titleCol.name])
      : `#${rowId}`;
    attachRowToMessage({
      table_id: Number(table.id),
      row_id: Number(rowId),
      table_name: table.name || undefined,
      table_icon: (table as { icon?: string }).icon || undefined,
      row_title: title
    });
  }, [table?.id, table?.name, rows, columnsRaw, attachRowToMessage]);

  const handleAddRow = useCallback(async () => {
    if (!table?.id || isReadOnlyContext) {
      return;
    }

    const newRowData: Record<string, unknown> = {};
    const now = new Date().toISOString();

    const resolveFormula = (formula: string, data: Record<string, unknown>): string => {
      return formula.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        if (key === 'row_id') {
          const rowId = data['id'] ?? data['row_id'] ?? data['_id'];
          return rowId !== undefined && rowId !== null ? String(rowId) : '';
        }
        const col = columns.find(c => c.name === key || c.id === key);
        if (col && data[col.id] !== undefined) {
          return String(data[col.id]);
        }
        return '';
      });
    };

    // First pass: set static default values
    columns.forEach((col) => {
      if ((col.type === 'date' || col.type === 'datetime') && !col.defaultValue) {
        newRowData[col.id] = now;
      } else if (col.defaultValue !== undefined && col.defaultValue !== null) {
        const defaultVal = String(col.defaultValue);
        if (defaultVal === 'NOW()' || defaultVal === 'now()') {
          newRowData[col.id] = now;
        } else if (!defaultVal.includes('{{')) {
          newRowData[col.id] = col.defaultValue;
        }
      }
    });

    // Second pass: resolve formulas (after static values are set)
    columns.forEach((col) => {
      if (col.defaultValue !== undefined && col.defaultValue !== null) {
        const defaultVal = String(col.defaultValue);
        if (defaultVal.includes('{{')) {
          newRowData[col.id] = resolveFormula(defaultVal, newRowData);
        }
      }
    });

    try {
      await tablesApi.createRow(table.id, newRowData);
      showToast('Row added successfully', 'success');
      queryClient.invalidateQueries({ queryKey: ['rows'] });
    } catch (error) {
      logger.error('❌ [handleAddRow] Error:', error);
      showToast('Failed to add row', 'error');
    }
  }, [table?.id, columns, isReadOnlyContext, queryClient]);

  const handleDuplicateRow = useCallback((rowId: string) => {
    if (isReadOnlyContext) {
      return;
    }

    const row = rows.find((r) => r.id === rowId);

    if (row) {
      setRowToDuplicate(row);
      setDuplicateModalOpen(true);
    }
  }, [rows, isReadOnlyContext]);

  const handleEditRow = useCallback((rowId: string) => {
    if (isReadOnlyContext) {
      return;
    }

    const row = rows.find((r) => r.id === rowId);

    if (row) {
      setRowToEdit(row);
      setEditModalOpen(true);
    }
  }, [rows, isReadOnlyContext]);

  const handleSaveEditedRow = useCallback(async (data: Record<string, unknown>) => {
    if (!table?.id || !rowToEdit) return;

    try {
      await tablesApi.updateRow(table.id, rowToEdit.id, data);
      updateRow(table.id, rowToEdit.id, data);
      showToast(t('rowActions.editSuccess') || 'Строка обновлена', 'success');
      setEditModalOpen(false);
      setRowToEdit(null);
    } catch (error) {
      logger.error('Failed to update row:', error);
      showToast(t('rowActions.editFailed') || 'Ошибка обновления', 'error');
    }
  }, [table?.id, rowToEdit, updateRow, t]);

  const handleConfirmDuplicate = useCallback(async (newId: string) => {
    if (!table?.id) return;

    // rowToDuplicate is accessed from closure through the params
    // We need to find it from rows since it might have changed
    try {
      // Note: this handler might not have the latest rowToDuplicate - but it's used
      // via the duplicate modal which already has the data passed to it
      const now = new Date().toISOString();
      showToast(t('rowActions.duplicateSuccess'), 'success');
      queryClient.invalidateQueries({ queryKey: ['rows'] });
      setDuplicateModalOpen(false);
      setRowToDuplicate(null);
    } catch (error) {
      logger.error('Failed to duplicate row:', error);
      const errorMessage = error instanceof Error ? error.message : t('rowActions.duplicateFailed');
      showToast(errorMessage, 'error');
    }
  }, [table?.id, queryClient, t]);

  const handleConfirmDuplicateExternal = useCallback(async (data: Record<string, unknown>) => {
    if (!table?.id) return;

    try {
      await tablesApi.createRow(table.id, data);
      showToast(t('rowActions.duplicateSuccess'), 'success');
      queryClient.invalidateQueries({ queryKey: ['rows'] });
      setDuplicateModalOpen(false);
      setRowToDuplicate(null);
    } catch (error) {
      logger.error('Failed to duplicate row:', error);
      const errorMessage = error instanceof Error ? error.message : t('rowActions.duplicateFailed');
      showToast(errorMessage, 'error');
    }
  }, [table?.id, queryClient, t]);

  const handleDeleteRow = useCallback(async (rowId: string) => {
    if (!table?.id || isReadOnlyContext) return;

    if (!confirm(t('rowActions.deleteConfirm'))) {
      return;
    }

    try {
      await tablesApi.deleteRow(table.id, rowId);
      showToast(t('rowActions.deleteSuccess'), 'success');
      queryClient.invalidateQueries({ queryKey: ['rows'] });
    } catch (error) {
      logger.error('Failed to delete row:', error);
      showToast(t('rowActions.deleteFailed'), 'error');
    }
  }, [table?.id, isReadOnlyContext, queryClient, t]);

  // Open delete confirmation modal
  const handleDeleteSelectedClick = useCallback(() => {
    if (!table?.id || isReadOnlyContext || selectedRowIds.size === 0) return;
    setDeleteConfirmOpen(true);
  }, [table?.id, isReadOnlyContext, selectedRowIds.size]);

  // Batch delete selected rows (called from modal)
  const handleDeleteSelectedConfirm = useCallback(async () => {
    if (!table?.id || isReadOnlyContext || selectedRowIds.size === 0) return;

    const count = selectedRowIds.size;
    setDeleteConfirmOpen(false);

    try {
      const rowIds = Array.from(selectedRowIds);
      await tablesApi.batchDeleteRows(table.id, rowIds);
      showToast((t as any)('rowActions.deleteSelectedSuccess', { count }) || `Удалено ${count} строк`, 'success');
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['rows'] });
    } catch (error) {
      logger.error('Failed to delete selected rows:', error);
      showToast(t('rowActions.deleteSelectedFailed') || 'Ошибка при удалении строк', 'error');
    }
  }, [table?.id, isReadOnlyContext, selectedRowIds, clearSelection, queryClient, t]);

  return {
    handleOpenRowChat,
    handleAttachRowToChat,
    handleAttachRowToMessage,
    handleAddRow,
    handleDuplicateRow,
    handleEditRow,
    handleSaveEditedRow,
    handleConfirmDuplicate,
    handleConfirmDuplicateExternal,
    handleDeleteRow,
    handleDeleteSelectedClick,
    handleDeleteSelectedConfirm,
  };
};
