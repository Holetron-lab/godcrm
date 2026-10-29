import { useState } from 'react';
import { Modal, Button } from '@/shared/components/ui';
import { ExternalLink } from 'lucide-react';
import { showToast } from '@/shared/hooks/useToast';
import { logger } from '@/shared/utils/logger';
import type { ColumnModel, RowModel } from '../../types/table.types';

type PrintRow = Pick<RowModel, 'id' | 'data'>;

interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnModel[];
  /** Rows loaded in the view (unfiltered). */
  rows: PrintRow[];
  selectedRowIds?: Set<string | number>;
  /** Ids of the rows that pass the active search/filters. */
  filteredRowIds?: Iterable<string>;
  /** Rows in the whole table as reported by the server; defaults to the loaded rows. */
  totalRows?: number;
  /** Loads every row of the table when more exist than are loaded. */
  fetchAllRows?: () => Promise<PrintRow[]>;
  tableName?: string;
  spaceName?: string;
  projectName?: string;
  viewType?: 'table' | 'kanban' | 'timeline' | 'calendar';
}

type RowScope = 'selected' | 'filtered' | 'all';

const POPUP_FEATURES = () => {
  const width = 900;
  const height = 700;
  const left = (window.screen.width - width) / 2;
  const top = (window.screen.height - height) / 2;
  return `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`;
};

export const PrintModal = ({
  isOpen,
  onClose,
  columns,
  rows,
  selectedRowIds: selectedRowIdsProp,
  filteredRowIds: filteredRowIdsProp,
  totalRows,
  fetchAllRows,
  tableName = 'Таблица'
}: PrintModalProps) => {
  const selectedRowIds = selectedRowIdsProp instanceof Set ? selectedRowIdsProp : new Set<string>();
  // No filter ids at all means nothing is filtered out.
  const filteredRowIds = filteredRowIdsProp ? new Set<string>(filteredRowIdsProp) : new Set<string>(rows.map(row => String(row.id)));

  const [rowScope, setRowScope] = useState<RowScope>('all');
  const [loading, setLoading] = useState(false);

  const selectedCount = selectedRowIds.size;
  const filteredCount = filteredRowIds.size;
  const allCount = Math.max(totalRows ?? 0, rows.length);
  const filterActive = filteredCount < rows.length;

  const scopeIds = rowScope === 'selected' ? selectedRowIds : filteredRowIds;
  const scopeRows = rowScope === 'all' ? rows : rows.filter(row => scopeIds.has(row.id));
  const printCount = rowScope === 'all' ? allCount : scopeRows.length;

  // Open the popup first — a window.open after an await is blocked as a popup; the data is then
  // written into the popup's own sessionStorage, which the preview page reads on mount.
  const handleOpenPreview = async () => {
    const popup = window.open('', 'PrintPreview', POPUP_FEATURES());
    if (!popup) {
      showToast('Браузер заблокировал окно печати — разрешите всплывающие окна', 'error');
      return;
    }
    setLoading(true);
    try {
      const needsAll = rowScope === 'all' && allCount > rows.length && fetchAllRows;
      const printRows = needsAll ? await fetchAllRows() : scopeRows;
      popup.sessionStorage.setItem('printPreviewData', JSON.stringify({ columns, rows: printRows, tableName }));
      popup.location.replace('/print-preview');
      onClose();
    } catch (error) {
      popup.close();
      logger.error('Failed to prepare print data:', error);
      showToast('Не удалось подготовить данные для печати — выделите или отфильтруйте строки', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onOpenChange={onClose}
      title="Печать"
      size="sm"
    >
      {/* Table Info */}
      <div className="mb-4 p-3 bg-[var(--bg-secondary)] rounded-lg">
        <div className="text-sm text-[var(--text-primary)]">
          <strong>{tableName}</strong>
        </div>
      </div>

      {/* Row Scope Selection */}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-[var(--text-primary)] block mb-2">
          Применить к:
        </legend>

        {/* Selected rows */}
        <label
          className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
            rowScope === 'selected'
              ? 'bg-[var(--color-primary-500)]/10 border border-[var(--color-primary-500)]'
              : 'bg-[var(--bg-secondary)] border border-transparent hover:bg-[var(--bg-tertiary)]'
          } ${selectedCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-3">
            <input
              type="radio"
              name="rowScope"
              value="selected"
              checked={rowScope === 'selected'}
              onChange={() => setRowScope('selected')}
              disabled={selectedCount === 0}
              className="w-4 h-4 text-[var(--color-primary-500)] border-[var(--border-primary)] focus:ring-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Выделенным строкам</span>
          </div>
          <span className={`text-sm ${selectedCount > 0 ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'}`}>
            {selectedCount}
          </span>
        </label>

        {/* Filtered rows */}
        <label
          className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
            rowScope === 'filtered'
              ? 'bg-[var(--color-primary-500)]/10 border border-[var(--color-primary-500)]'
              : 'bg-[var(--bg-secondary)] border border-transparent hover:bg-[var(--bg-tertiary)]'
          } ${!filterActive ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-3">
            <input
              type="radio"
              name="rowScope"
              value="filtered"
              checked={rowScope === 'filtered'}
              onChange={() => setRowScope('filtered')}
              disabled={!filterActive}
              className="w-4 h-4 text-[var(--color-primary-500)] border-[var(--border-primary)] focus:ring-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Отфильтрованным строкам</span>
          </div>
          <span className={`text-sm ${filterActive ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'}`}>
            {filteredCount}
          </span>
        </label>

        {/* All rows */}
        <label
          className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
            rowScope === 'all'
              ? 'bg-[var(--color-primary-500)]/10 border border-[var(--color-primary-500)]'
              : 'bg-[var(--bg-secondary)] border border-transparent hover:bg-[var(--bg-tertiary)]'
          }`}
        >
          <div className="flex items-center gap-3">
            <input
              type="radio"
              name="rowScope"
              value="all"
              checked={rowScope === 'all'}
              onChange={() => setRowScope('all')}
              className="w-4 h-4 text-[var(--color-primary-500)] border-[var(--border-primary)] focus:ring-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Всем строкам</span>
          </div>
          <span className="text-sm text-[var(--color-primary-500)]">
            {allCount}
          </span>
        </label>
      </fieldset>

      {/* Summary */}
      <div className="mt-4 p-3 bg-[var(--bg-secondary)] rounded-lg text-center">
        <span className="text-sm text-[var(--text-secondary)]">
          Будет напечатано: <strong className="text-[var(--text-primary)]">{printCount}</strong> строк
        </span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--border-primary)]">
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button
          onClick={handleOpenPreview}
          disabled={printCount === 0 || loading}
          className="flex items-center gap-2"
        >
          <ExternalLink className="w-4 h-4" />
          {loading ? 'Загрузка…' : 'Предпросмотр'}
        </Button>
      </div>
    </Modal>
  );
};

export default PrintModal;
