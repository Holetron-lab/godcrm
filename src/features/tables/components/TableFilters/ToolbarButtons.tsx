import { Plus, Zap, LayoutGrid, Table2, RefreshCw, Printer, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface ToolbarButtonsProps {
  onAddRow?: () => void;
  addRowText?: string;
  tableId?: string;
  compact?: boolean;
  projectId?: number;
  rawMode?: boolean;
  tableIdProp?: number;
  onBulkReplace?: () => void;
  bulkReplaceDisabled?: boolean;
  showBulkReplace?: boolean;
  onPrint?: () => void;
  showPrint?: boolean;
  onTableSettings?: () => void;
  showTableSettings?: boolean;
  isExternal?: boolean;
  onRefresh?: () => void;
  onShowAutomationModal: () => void;
}

export const ToolbarButtons = ({
  onAddRow,
  addRowText,
  tableId,
  compact,
  projectId,
  rawMode,
  tableIdProp,
  onBulkReplace,
  bulkReplaceDisabled = false,
  showBulkReplace = false,
  onPrint,
  showPrint = false,
  onTableSettings,
  showTableSettings = false,
  isExternal,
  onRefresh,
  onShowAutomationModal,
}: ToolbarButtonsProps) => {
  const { t } = useLanguage();

  return (
    <>
      {/* Add Row Button - Left side */}
      {onAddRow && (
        <Button onClick={onAddRow} variant="primary" className="gap-2 whitespace-nowrap flex-shrink-0">
          <Plus className="h-4 w-4" />
          {addRowText || t('tableToolbar.addRow') || 'Add row'}
        </Button>
      )}

      {/* Automations Button - Hide in compact mode, opens modal */}
      {tableId && !compact && (
        <button
          onClick={onShowAutomationModal}
          title={t('table.automations') || 'Automations'}
          className="flex items-center gap-0.5 p-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition rounded"
        >
          <Plus className="w-2.5 h-2.5" />
          <Zap className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Widget Button - Only show when projectId is available */}
      {projectId && !compact && (
        rawMode ? (
          // In raw mode - link to normal table view
          <Link
            to={`/tables/${tableIdProp || tableId}`}
            title={t('table.openTableView') || 'Open table view'}
            className="flex items-center gap-0.5 p-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition rounded"
          >
            <Table2 className="w-4 h-4" />
          </Link>
        ) : (
          // In normal mode - link to create widget
          <Link
            to={`/projects/${projectId}/widgets/create?tableId=${tableIdProp || tableId}`}
            title={t('table.newWidget') || 'New Widget'}
            className="flex items-center gap-0.5 p-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition rounded"
          >
            <Plus className="w-2.5 h-2.5" />
            <LayoutGrid className="w-3.5 h-3.5" />
          </Link>
        )
      )}
    </>
  );
};

interface ActionButtonsProps {
  onBulkReplace?: () => void;
  bulkReplaceDisabled?: boolean;
  showBulkReplace?: boolean;
  onPrint?: () => void;
  showPrint?: boolean;
  onTableSettings?: () => void;
  showTableSettings?: boolean;
  isExternal?: boolean;
  onRefresh?: () => void;
}

export const ActionButtons = ({
  onBulkReplace,
  bulkReplaceDisabled = false,
  showBulkReplace = false,
  onPrint,
  showPrint = false,
  onTableSettings,
  showTableSettings = false,
  isExternal,
  onRefresh,
}: ActionButtonsProps) => {
  const { t } = useLanguage();

  return (
    <>
      {/* Bulk Replace Button */}
      {showBulkReplace && onBulkReplace && (
        <Button
          onClick={onBulkReplace}
          disabled={bulkReplaceDisabled}
          variant="secondary"
          className="whitespace-nowrap"
        >
          <svg className="w-4 h-4 mr-2 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v6m0 8v6M2 12h6m8 0h6" />
          </svg>
          {t('table.bulkReplace') || 'Замена'}
        </Button>
      )}

      {/* Table Settings Button */}
      {showTableSettings && onTableSettings && (
        <Button
          onClick={onTableSettings}
          variant="secondary"
          className="whitespace-nowrap"
          title="Настройки таблицы"
        >
          <Settings className="w-4 h-4" />
        </Button>
      )}

      {/* Print Button */}
      {showPrint && onPrint && (
        <Button
          onClick={onPrint}
          variant="secondary"
          className="whitespace-nowrap"
          title="Печать"
        >
          <Printer className="w-4 h-4" />
        </Button>
      )}

      {/* Refresh button for external tables - icon only */}
      {isExternal && onRefresh && (
        <button
          onClick={onRefresh}
          className="p-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
          title={t('common.refresh') || 'Refresh'}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
    </>
  );
};
