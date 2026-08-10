/**
 * RowViewerModal — Self-loading modal that fetches row data and displays it in EditRowModal.
 * Ticket #81431: "Show" button on row_reference chips in chat messages.
 *
 * Fetches columns + row data from API, then renders EditRowModal.
 * Supports saving edits back to the API.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { EditRowModal } from '@/features/tables/components/modals/EditRowModal';
import type { ColumnModel } from '@/features/tables/types/table.types';

interface RowViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: number;
  rowId: number;
}

const RowViewerModal = ({ isOpen, onClose, tableId, rowId }: RowViewerModalProps) => {
  const [columns, setColumns] = useState<ColumnModel[]>([]);
  const [rowData, setRowData] = useState<Record<string, unknown>>({});
  const [tableName, setTableName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch columns and row data in parallel
        const [colsRes, rowRes] = await Promise.all([
          apiClient.get<{ data: ColumnModel[] }>(`/tables/${tableId}/columns`),
          apiClient.get<{ data: Record<string, unknown> }>(`/tables/${tableId}/rows/${rowId}`),
        ]);

        const cols = Array.isArray(colsRes.data) ? colsRes.data : (colsRes as unknown as { data: { data: ColumnModel[] } }).data?.data || [];
        const row = rowRes.data && typeof rowRes.data === 'object' && !Array.isArray(rowRes.data)
          ? (rowRes as unknown as { data: { data: Record<string, unknown> } }).data?.data || rowRes.data
          : {};

        setColumns(cols);
        setRowData(row);

        // Try to get table name
        try {
          const tableRes = await apiClient.get<{ data: { name?: string; display_name?: string } }>(`/tables/${tableId}`);
          const tableData = (tableRes as unknown as { data: { data: { name?: string; display_name?: string } } }).data?.data || tableRes.data;
          setTableName(tableData?.display_name || tableData?.name || `Table #${tableId}`);
        } catch {
          setTableName(`Table #${tableId}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load row data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen, tableId, rowId]);

  const handleSave = useCallback(async (data: Record<string, unknown>) => {
    try {
      await apiClient.put(`/tables/${tableId}/rows/${rowId}`, { data });
      onClose();
    } catch (err) {
      console.error('Failed to save row:', err);
    }
  }, [tableId, rowId, onClose]);

  if (!isOpen) return null;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-[var(--bg-primary)] rounded-lg p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary-500)]" />
          <span className="text-sm text-[var(--text-secondary)]">Loading row data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
        <div className="bg-[var(--bg-primary)] rounded-lg p-6 max-w-sm" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <EditRowModal
      isOpen={isOpen}
      onClose={onClose}
      onSave={handleSave}
      columns={columns}
      rowData={rowData}
      rowId={String(rowId)}
      tableId={tableId}
      tableName={tableName}
    />
  );
};

export default RowViewerModal;
