import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button } from '@/shared/components/ui';
import { Printer, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { ColumnModel, RowModel } from '../../types/table.types';

interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnModel[];
  rows: RowModel[];
  selectedRowIds?: Set<string>;
  filteredRowIds?: Set<string>;
  tableName?: string;
  spaceName?: string;
  projectName?: string;
  viewType?: 'table' | 'kanban' | 'timeline' | 'calendar';
}

type RowScope = 'selected' | 'filtered' | 'all';

export const PrintModal = ({
  isOpen,
  onClose,
  columns,
  rows,
  selectedRowIds: selectedRowIdsProp,
  filteredRowIds: filteredRowIdsProp,
  tableName = 'Таблица',
  spaceName,
  projectName,
  viewType = 'table'
}: PrintModalProps) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  
  // Ensure we have valid Sets
  const selectedRowIds = selectedRowIdsProp instanceof Set ? selectedRowIdsProp : new Set<string>();
  const filteredRowIds = filteredRowIdsProp instanceof Set ? filteredRowIdsProp : new Set<string>();
  
  // Row scope selection
  const [rowScope, setRowScope] = useState<RowScope>('all');
  
  // Counts
  const selectedCount = selectedRowIds.size;
  const filteredCount = filteredRowIds.size;
  const allCount = rows.length;
  
  // Get rows based on scope
  const getRowsForScope = (scope: RowScope): RowModel[] => {
    switch (scope) {
      case 'selected':
        return rows.filter(r => selectedRowIds.has(r.id));
      case 'filtered':
        return rows.filter(r => filteredRowIds.has(r.id));
      case 'all':
      default:
        return rows;
    }
  };
  
  const scopeRows = useMemo(() => getRowsForScope(rowScope), [rowScope, rows, selectedRowIds, filteredRowIds]);
  
  // Open print preview page
  const handleOpenPreview = () => {
    // Save data to sessionStorage for the preview page
    sessionStorage.setItem('printPreviewData', JSON.stringify({
      columns,
      rows: scopeRows,
      tableName
    }));
    
    // Open in new popup window
    const width = 900;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    window.open(
      '/print-preview',
      'PrintPreview',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
    );
    onClose();
  };
  
  if (!isOpen) return null;
  
  return (
    <Modal 
      open={isOpen} 
      onOpenChange={onClose}
      title={
        <div className="flex items-center gap-2">
          <Printer className="w-5 h-5 text-[var(--color-primary-500)]" />
          <span>Печать</span>
        </div>
      }
      size="sm"
    >
      {/* Table Info */}
      <div className="mb-4 p-3 bg-[var(--bg-secondary)] rounded-lg">
        <div className="text-sm text-[var(--text-primary)]">
          <strong>{tableName}</strong>
        </div>
      </div>
      
      {/* Row Scope Selection */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-primary)] block mb-2">
          Применить к:
        </label>
        
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
          } ${filteredCount === allCount ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-3">
            <input
              type="radio"
              name="rowScope"
              value="filtered"
              checked={rowScope === 'filtered'}
              onChange={() => setRowScope('filtered')}
              disabled={filteredCount === allCount}
              className="w-4 h-4 text-[var(--color-primary-500)] border-[var(--border-primary)] focus:ring-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Отфильтрованным строкам</span>
          </div>
          <span className={`text-sm ${filteredCount < allCount ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'}`}>
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
      </div>
      
      {/* Summary */}
      <div className="mt-4 p-3 bg-[var(--bg-secondary)] rounded-lg text-center">
        <span className="text-sm text-[var(--text-secondary)]">
          Будет напечатано: <strong className="text-[var(--text-primary)]">{scopeRows.length}</strong> строк
        </span>
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--border-primary)]">
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button 
          onClick={handleOpenPreview}
          disabled={scopeRows.length === 0}
          className="flex items-center gap-2"
        >
          <ExternalLink className="w-4 h-4" />
          Предпросмотр
        </Button>
      </div>
    </Modal>
  );
};

export default PrintModal;
