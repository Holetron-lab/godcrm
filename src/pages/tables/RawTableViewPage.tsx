import { useEffect, useState, useCallback, useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Database, RefreshCw, ArrowLeft, Table2 } from 'lucide-react';
import { UniversalTable } from '@/features/tables/components/UniversalTable/UniversalTable';
import { TableSkeleton } from '@/features/tables/components/UniversalTable/TableSkeleton';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useColumnConfig } from '@/features/tables/hooks/useColumnConfig';
import { useTableData } from '@/features/tables/hooks/useTableData';
import { useQueryClient } from '@tanstack/react-query';

/**
 * RawTableViewPage - Display table data in RAW mode (no formatting)
 * 
 * Used for viewing Data Source tables with raw data:
 * - Shows ISO dates instead of formatted
 * - Shows select values instead of badges
 * - Shows NULL instead of empty placeholders
 * - Read-only by default
 */
const RawTableViewPage = () => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const { dataSourceId, tableId } = useParams<{ dataSourceId: string; tableId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const selectTable = useTablesStore((state) => state.selectTable);
  const tables = useTablesStore((state) => state.tables);
  
  // Find the current table
  const currentTable = tables.find(t => t.id === tableId);
  
  // Load columns and rows
  const columns = useColumnConfig(tableId ?? null);
  const rows = useTableData(tableId ?? null);
  
  logger.debug('[RawTableViewPage] Mount', { 
    dataSourceId, 
    tableId,
    tableName: currentTable?.name,
    columnsCount: columns.length,
    rowsCount: rows.length
  });
  
  // Select table when component mounts
  useEffect(() => {
    if (tableId) {
      selectTable(tableId);
    }
  }, [tableId, selectTable]);
  
  const handleRefresh = useCallback(() => {
    if (tableId) {
      logger.debug('[RawTableViewPage] Refresh', { tableId });
      queryClient.invalidateQueries({ queryKey: ['rows', tableId] });
      queryClient.invalidateQueries({ queryKey: ['columns', tableId] });
    }
  }, [tableId, queryClient]);
  
  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);
  
  // Loading state
  if (!currentTable || columns.length === 0) {
    return (
      <section className="flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[var(--bg-tertiary)] rounded animate-pulse" />
            <div className="flex-1">
              <div className="h-5 w-48 bg-[var(--bg-tertiary)] rounded animate-pulse mb-1" />
              <div className="h-3 w-32 bg-[var(--bg-tertiary)] rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div className="flex-1 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden m-4">
          <TableSkeleton rows={10} columns={5} />
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Back button */}
            <button
              onClick={handleBack}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
              title={t('Назад', 'Back')}
            >
              <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
            </button>
            
            {/* Table icon and info */}
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--color-primary)]/10">
                <Database className="w-5 h-5 text-[var(--color-primary)]" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                  {currentTable.displayName || currentTable.name}
                </h1>
                <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] font-mono">
                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)]">RAW</span>
                  <span>•</span>
                  <span>{rows.length} rows</span>
                  <span>•</span>
                  <span>{columns.length} columns</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Create Widget Button - creates table widget with this table preselected */}
            {currentTable.projectId && (
              <Link
                to={`/projects/${currentTable.projectId}/widgets/create?tableId=${currentTable.id}&type=table`}
                className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                title={t('Создать представление', 'Create view')}
              >
                <Table2 className="w-4 h-4 text-[var(--text-primary)]" />
              </Link>
            )}
            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
              title={t('Обновить', 'Refresh')}
            >
              <RefreshCw className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>
          </div>
        </div>
      </div>

      {/* RAW Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden">
          <UniversalTable 
            rawMode={true}
          />
        </div>
      </div>
    </section>
  );
};

export default RawTableViewPage;
