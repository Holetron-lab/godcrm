import { Button, DropdownMenu, MultiSelect, Select, Tooltip } from '@/shared/components/ui';
import type { ColumnModel, TableView } from '../../types/table.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDataSources } from '@/features/data-sources/hooks/useDataSources';

interface TableToolbarProps {
  tableName?: string;
  views: TableView[];
  activeViewId?: string;
  onViewChange: (viewId: string) => void;
  onOpenColumnPanel: () => void;
  columns: ColumnModel[];
  visibleColumnIds: string[];
  onColumnVisibilityChange: (visibleIds: string[]) => void;
  readOnly?: boolean;
  rowsLimit?: number;
  onRowsLimitChange?: (limit: number) => void;
  currentDataSourceId?: string | null;
  onDataSourceChange?: (dataSourceId: string | null) => void;
  workspaceId?: string;
  onAddRow?: () => void;
  externalTableName?: string | null;
  dataSourceName?: string | null;
}

export const TableToolbar = ({
  tableName,
  views,
  activeViewId,
  onViewChange,
  onOpenColumnPanel,
  columns,
  visibleColumnIds,
  onColumnVisibilityChange,
  readOnly = false,
  rowsLimit = 50,
  onRowsLimitChange,
  currentDataSourceId = null,
  onDataSourceChange,
  workspaceId = '1',
  onAddRow,
  externalTableName = null,
  dataSourceName = null
}: TableToolbarProps) => {
  const { t } = useLanguage();
  
  // Fetch data sources for workspace
  const { dataSources, loading: dataSourcesLoading } = useDataSources(workspaceId);
  
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">{t('tables.viewTitle')}</p>
        <h2 data-testid="table-header" className="text-xl font-semibold text-[var(--text-primary)]">{tableName ?? t('tableToolbar.defaultName')}</h2>
        {externalTableName && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="rounded bg-[var(--color-primary-100)] px-2 py-1 font-medium text-[var(--color-primary-700)]">
              🔗 {t('tableToolbar.externalBadge')}
            </span>
            <span className="font-mono">
              {dataSourceName || 'Unknown'} → {externalTableName}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Select
          label={t('tableToolbar.viewLabel')}
          value={activeViewId}
          onChange={onViewChange}
          options={(views || []).map((view) => ({ label: view.name, value: view.id }))}
          placeholder="Select view"
        />
        
        {/* Data Source Selector */}
        {onDataSourceChange && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">{t('tableToolbar.dataSource')}</span>
            <Select
              label=""
              value={currentDataSourceId || ''}
              onChange={(value) => onDataSourceChange(value || null)}
              options={(dataSources || []).map((ds) => ({
                label: `${ds.name} (${ds.type})`,
                value: ds.id
              }))}
              disabled={readOnly || dataSourcesLoading}
              placeholder={dataSourcesLoading ? t('tableToolbar.loadingSource') : t('tableToolbar.noDataSource')}
            />
          </div>
        )}
        
        <MultiSelect
          label={t('tableToolbar.columnsLabel')}
          value={visibleColumnIds || []}
          onChange={onColumnVisibilityChange}
          options={(columns || []).map((column) => ({ label: column.displayName, value: column.id }))}
        />
        {readOnly ? (
          <span className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
            {t('users.readOnlyBadge')}
          </span>
        ) : (
          <>
            <Tooltip label={t('tableToolbar.columnSettings')}>
              <Button data-testid="table-settings-btn" variant="secondary" onClick={onOpenColumnPanel}>
                {t('tableToolbar.columnSettings')}
              </Button>
            </Tooltip>
            <DropdownMenu
              trigger={<Button data-testid="add-row-btn" variant="primary">{t('tableToolbar.actionsLabel')}</Button>}
              items={[
                { 
                  label: t('tableToolbar.addRow'), 
                  value: 'add-row',
                  onSelect: () => {
                    onAddRow?.();
                  }
                },
                { label: t('tableToolbar.duplicate'), value: 'duplicate' },
                { label: t('tableToolbar.delete'), value: 'delete', danger: true }
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
};
