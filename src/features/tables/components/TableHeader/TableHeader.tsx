import { useState, useRef, useCallback } from 'react';
import { RefreshCw, Plus, Download, Upload, GitMerge, MoreHorizontal } from 'lucide-react';
import { Button, DropdownMenu } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { showToast } from '@/shared/hooks/useToast';
import type { TableModel } from '../../types/table.types';

interface TableHeaderProps {
  table: TableModel;
  onRefresh?: () => void;
  onAddRow?: () => void;
  onExport?: () => void;
  onImportCSV?: () => void;
  onMerge?: () => void;
}

export const TableHeader = ({ 
  table, 
  onRefresh, 
  onAddRow,
  onExport,
  onImportCSV,
  onMerge
}: TableHeaderProps) => {
  const { t } = useLanguage();
  const isExternal = !!table.source_table_name;

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport();
    } else {
      showToast(t('common.comingSoon') || 'Coming soon', 'info');
    }
  }, [onExport, t]);

  const handleImportCSV = useCallback(() => {
    if (onImportCSV) {
      onImportCSV();
    } else {
      showToast(t('common.comingSoon') || 'Coming soon', 'info');
    }
  }, [onImportCSV, t]);

  const handleMerge = useCallback(() => {
    if (onMerge) {
      onMerge();
    } else {
      showToast(t('common.comingSoon') || 'Coming soon', 'info');
    }
  }, [onMerge, t]);

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Left side - Description only if exists */}
      <div className="flex-1 min-w-0">
        {table.description && (
          <p className="text-sm text-[var(--text-secondary)]">
            {table.description}
          </p>
        )}
      </div>

      {/* Right side - Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Refresh button for external tables */}
        {isExternal && onRefresh && (
          <Button onClick={onRefresh} variant="outline" className="gap-2 whitespace-nowrap">
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh') || 'Refresh'}
          </Button>
        )}

        {/* Import/Export/Merge Menu */}
        <DropdownMenu
          trigger={
            <Button variant="outline" className="gap-2 whitespace-nowrap">
              <MoreHorizontal className="h-4 w-4" />
              {t('common.actions') || 'Actions'}
            </Button>
          }
          items={[
            {
              label: t('table.export') || 'Export CSV',
              value: 'export',
              icon: <Download className="h-4 w-4" />,
              onSelect: handleExport
            },
            {
              label: t('table.import') || 'Import CSV',
              value: 'import',
              icon: <Upload className="h-4 w-4" />,
              onSelect: handleImportCSV
            },
            {
              label: t('table.merge') || 'Merge by ID',
              value: 'merge',
              icon: <GitMerge className="h-4 w-4" />,
              onSelect: handleMerge
            }
          ]}
          align="end"
        />
        
        {/* Add row button */}
        {onAddRow && (
          <Button onClick={onAddRow} variant="primary" className="gap-2 whitespace-nowrap">
            <Plus className="h-4 w-4" />
            {t('tableToolbar.addRow') || 'Add row'}
          </Button>
        )}
      </div>
    </div>
  );
};
