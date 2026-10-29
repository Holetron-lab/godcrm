import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * RowViewerModal — Self-loading modal that fetches row data and renders it in
 * either a kanban-style CardDetailModal (mode='view', default) or an
 * EditRowModal (mode='edit'). Used by row_reference chips in chat messages.
 *
 * Uses useTicketData to load relationData + columns so relation-typed fields
 * (state, priority, type, assigned_to) render with proper labels/colors and
 * the rich left-sidebar / right-content layout kicks in.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { EditRowModal } from '@/features/tables/components/modals/EditRowModal';
import { CardDetailModal } from '@/features/widgets/components/modals/CardDetailModal';
import { useTicketData } from '@/features/widgets/hooks/useTicketData';
import type { ColumnModel } from '@/features/tables/types/table.types';

interface RowViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: number;
  rowId: number;
  /** 'view' = kanban CardDetailModal (default), 'edit' = legacy EditRowModal */
  mode?: 'view' | 'edit';
  onAttachToChat?: (rowId: string) => void;
  onAttachToMessage?: (rowId: string) => void;
}

const TITLE_FIELD_CANDIDATES = ['title', 'name', 'what', 'summary', 'subject', 'label'];

const RowViewerModal = ({
  isOpen,
  onClose,
  tableId,
  rowId,
  mode = 'view',
  onAttachToChat,
  onAttachToMessage,
}: RowViewerModalProps) => {
  const { t } = useLanguage();
  const [rowData, setRowData] = useState<Record<string, unknown>>({});
  const [tableName, setTableName] = useState('');
  const [loadingRow, setLoadingRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Loads tableColumns + relationData (with caching across the app).
  const {
    tableColumns,
    relationData,
    groupColumn,
    isLoadingColumns,
  } = useTicketData({ widgetId: 0, tableId, enabled: isOpen });

  useEffect(() => {
    if (!isOpen) return;

    const fetchRow = async () => {
      setLoadingRow(true);
      setError(null);
      try {
        const [rowRes, tableRes] = await Promise.all([
          apiClient.get<{ row: { id: number; data: Record<string, unknown> } }>(`/tables/${tableId}/rows/${rowId}`),
          apiClient.get<{ data: { name?: string; display_name?: string } }>(`/tables/${tableId}`).catch(() => null),
        ]);

        const rowPayload = rowRes as any;
        const rawRow = rowPayload?.row || rowPayload?.data?.row || {};
        const rowFields = rawRow?.data || rawRow || {};

        setRowData(rowFields);

        if (tableRes) {
          const td = (tableRes as any)?.data || tableRes;
          setTableName(td?.display_name || td?.name || `Table #${tableId}`);
        } else {
          setTableName(`Table #${tableId}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load row data');
      } finally {
        setLoadingRow(false);
      }
    };

    fetchRow();
  }, [isOpen, tableId, rowId]);

  const handleSave = useCallback(async (data: Record<string, unknown>) => {
    try {
      await apiClient.put(`/tables/${tableId}/rows/${rowId}`, { data });
      setRowData(prev => ({ ...prev, ...data }));
      if (mode === 'edit') onClose();
    } catch (err) {
      console.error('Failed to save row:', err);
    }
  }, [tableId, rowId, mode, onClose]);

  const handleCardSave = useCallback(async (_cardId: string, data: Record<string, unknown>) => {
    await handleSave(data);
  }, [handleSave]);

  // Auto-detect title field from common names; CardDetailModal will fall back
  // to the first text column if none of these are present.
  const titleField = useMemo(() => {
    const cols = (tableColumns as ColumnModel[]) || [];
    for (const candidate of TITLE_FIELD_CANDIDATES) {
      if (cols.some(c => c.name === candidate)) return candidate;
    }
    return 'title';
  }, [tableColumns]);

  if (!isOpen) return null;

  const loading = loadingRow || isLoadingColumns;

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
        <div className="bg-[var(--bg-primary)] rounded-lg p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary-500)]" />
          <span className="text-sm text-[var(--text-secondary)]">{t('aiChat.ui.loadingRowData')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <Dialog.Content
            aria-modal="true"
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocusRef.current?.focus();
            }}
            className="fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-sm max-h-[90dvh] overflow-y-auto bg-[var(--bg-primary)] rounded-lg p-6"
          >
          <Dialog.Title asChild>
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
          </Dialog.Title>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
          >
            {t('aiChat.ui.close')}</button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (mode === 'edit') {
    return (
      <EditRowModal
        isOpen={isOpen}
        onClose={onClose}
        onSave={handleSave}
        columns={tableColumns as ColumnModel[]}
        rowData={rowData}
        rowId={String(rowId)}
        tableId={tableId}
        tableName={tableName}
      />
    );
  }

  return (
    <CardDetailModal
      isOpen={isOpen}
      onClose={onClose}
      card={{ id: String(rowId), data: rowData }}
      columns={tableColumns as ColumnModel[]}
      tableId={tableId}
      titleField={titleField}
      groupByField={groupColumn?.name}
      relationData={relationData}
      onSave={handleCardSave}
      onAttachToChat={onAttachToChat}
      onAttachToMessage={onAttachToMessage}
    />
  );
};

export default RowViewerModal;
