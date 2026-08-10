import { TableModel } from '../types/table.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button } from '@/shared/components/ui/Button';

interface TableActionsPanelProps {
  table: TableModel;
  onAddRow?: () => void;
  onEditStructure?: () => void;
  onDelete?: () => void;
  onSyncNow?: () => void;
  onConfigureSync?: () => void;
  onViewSyncLogs?: () => void;
  onAddCustomColumn?: () => void;
}

export function TableActionsPanel({
  table,
  onAddRow,
  onEditStructure,
  onDelete,
  onSyncNow,
  onConfigureSync,
  onViewSyncLogs,
  onAddCustomColumn
}: TableActionsPanelProps) {
  const { t } = useLanguage();
  const tableType = table.table_type || 'own';

  // Actions for 'own' tables
  const ownActions = (
    <>
      {onAddRow && (
        <Button variant="primary" onClick={onAddRow}>
          + {t('tableToolbar.addRow')}
        </Button>
      )}
      {onEditStructure && (
        <Button variant="secondary" onClick={onEditStructure}>
          ⚙️ Edit Structure
        </Button>
      )}
      {onDelete && (
        <Button variant="danger" onClick={onDelete}>
          🗑️ {t('tableToolbar.delete')}
        </Button>
      )}
    </>
  );

  // Actions for 'external' tables
  const externalActions = (
    <>
      {onSyncNow && (
        <Button variant="primary" onClick={onSyncNow}>
          🔄 Sync Now
        </Button>
      )}
      {onConfigureSync && (
        <Button variant="secondary" onClick={onConfigureSync}>
          ⚙️ Configure Sync
        </Button>
      )}
      {onViewSyncLogs && (
        <Button variant="secondary" onClick={onViewSyncLogs}>
          📋 View Logs
        </Button>
      )}
    </>
  );

  // Actions for 'hybrid' tables
  const hybridActions = (
    <>
      {onSyncNow && (
        <Button variant="primary" onClick={onSyncNow}>
          🔄 Sync Now
        </Button>
      )}
      <Button variant="primary" onClick={() => alert('Merge table functionality - coming soon')}>
        ⚡ Merge Tables
      </Button>
      {onAddCustomColumn && (
        <Button variant="primary" onClick={onAddCustomColumn}>
          + Add Custom Column
        </Button>
      )}
      {onViewSyncLogs && (
        <Button variant="secondary" onClick={onViewSyncLogs}>
          📋 View Logs
        </Button>
      )}
      {onEditStructure && (
        <Button variant="secondary" onClick={onEditStructure}>
          ⚙️ Edit Structure
        </Button>
      )}
    </>
  );

  const actionsMap = {
    own: ownActions,
    external: externalActions,
    hybrid: hybridActions
  };

  return (
    <div className="flex items-center gap-2">
      {actionsMap[tableType]}
    </div>
  );
}
