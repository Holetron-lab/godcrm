import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, ChevronDown, Database, Table, Loader2, FolderOpen } from 'lucide-react';
import { useDataSources } from '@/features/data-sources/hooks/useDataSources';
import { useLinkedTables } from '@/features/data-sources/hooks/useDataSourceTables';
import type { DataSource } from '@/features/data-sources/types/dataSource.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface DataSourcesNavProps {
  spaceId: number;
  isExpanded?: boolean;
}

interface DataSourceItemProps {
  dataSource: DataSource;
}

/**
 * Single Data Source folder in navigation
 * Expands to show linked tables
 */
function DataSourceItem({ dataSource }: DataSourceItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const location = useLocation();
  
  // Lazy load tables only when expanded
  const { mainTable, linkedTables, total, loading } = useLinkedTables(
    isExpanded ? dataSource.id : null
  );
  
  const isCurrentDataSource = location.pathname.includes(`/data-sources/${dataSource.id}`);
  
  // Database type icons
  const dbIcons: Record<string, string> = {
    mysql: '🐬',
    postgresql: '🐘',
    sqlite: '📦'
  };
  const dbIcon = dbIcons[dataSource.type] || '🔌';
  
  return (
    <div>
      {/* Data Source Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`
          w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
          text-left text-xs transition-colors
          ${isCurrentDataSource
            ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]' 
            : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
          }
        `}
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 flex-shrink-0" />
        )}
        
        <span className="flex-shrink-0">{dbIcon}</span>
        <span className="truncate flex-1">{dataSource.name}</span>
        
        {dataSource.table_count !== undefined && dataSource.table_count > 0 && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
            {dataSource.table_count}
          </span>
        )}
      </button>
      
      {/* Tables List (when expanded) */}
      {isExpanded && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[var(--border-primary)] pl-2">
          {loading ? (
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-tertiary)]">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading...
            </div>
          ) : total === 0 ? (
            <div className="px-2 py-1 text-[10px] text-[var(--text-tertiary)] italic">
              No tables
            </div>
          ) : (
            <>
              {/* Main Table - highlighted */}
              {mainTable && (
                <NavLink
                  to={`/data-sources/${dataSource.id}/tables/${mainTable.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                      isActive
                        ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                    }`
                  }
                >
                  <Table className="w-3 h-3 text-[var(--color-primary-500)]" />
                  <span className="truncate">{mainTable.source_table_name || mainTable.name}</span>
                  <span className="ml-auto text-[8px] px-1 rounded bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)] uppercase font-bold">
                    main
                  </span>
                </NavLink>
              )}
              
              {/* Linked Tables */}
              {linkedTables.map((table) => (
                <NavLink
                  key={table.id}
                  to={`/data-sources/${dataSource.id}/tables/${table.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1 rounded text-xs transition truncate ${
                      isActive
                        ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                        : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
                    }`
                  }
                >
                  <Table className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{table.source_table_name || table.name}</span>
                </NavLink>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * DataSourcesNav - Navigation section for Data Sources in sidebar
 * Shows all data sources for a space with expandable table lists
 */
export function DataSourcesNav({ spaceId, isExpanded = true }: DataSourcesNavProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [isSectionExpanded, setIsSectionExpanded] = useState(isExpanded);
  const workspaceId = spaceId.toString();
  
  const { dataSources, loading } = useDataSources(workspaceId);
  
  if (!loading && (!dataSources || dataSources.length === 0)) {
    return null; // Don't show section if no data sources
  }
  
  return (
    <div className="space-y-1">
      {/* Section Header */}
      <button
        onClick={() => setIsSectionExpanded(!isSectionExpanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {isSectionExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <Database className="w-3.5 h-3.5" />
        <span>{t('Источники данных', 'Data sources')}</span>
        {dataSources && dataSources.length > 0 && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)]">
            {dataSources.length}
          </span>
        )}
      </button>
      
      {/* Data Sources List */}
      {isSectionExpanded && (
        <div className="ml-2 space-y-0.5">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-tertiary)]">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading...
            </div>
          ) : (
            dataSources?.map((ds) => (
              <DataSourceItem key={ds.id} dataSource={ds} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
