import { useState, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronRight, ChevronDown, Database, Table, Loader2 } from 'lucide-react';
import { useLinkedTables } from '@/features/data-sources/hooks/useDataSourceTables';
import type { DataSource } from '@/features/data-sources/types/dataSource.types';

interface DataSourceFolderProps {
  dataSource: DataSource;
  isActive?: boolean;
}

/**
 * DataSourceFolder - Collapsible folder component for Data Sources in sidebar
 * 
 * Shows data source as a folder that expands to reveal linked tables.
 * Main table is highlighted and shown first.
 */
export const DataSourceFolder = ({ dataSource, isActive }: DataSourceFolderProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  
  // Only fetch tables when expanded
  const { mainTable, linkedTables, total, loading } = useLinkedTables(
    isExpanded ? dataSource.id : null
  );
  
  const handleToggle = useCallback(() => {
    logger.debug('[DataSourceFolder] Toggle', { 
      dataSourceId: dataSource.id, 
      dataSourceName: dataSource.name,
      isExpanded: !isExpanded 
    });
    setIsExpanded(!isExpanded);
  }, [dataSource.id, dataSource.name, isExpanded]);
  
  const handleTableClick = useCallback((tableId: string) => {
    logger.debug('[DataSourceFolder] Navigate to RAW table', { 
      dataSourceId: dataSource.id, 
      tableId 
    });
    navigate(`/data-sources/${dataSource.id}/tables/${tableId}`);
  }, [dataSource.id, navigate]);
  
  // Check if current route matches this data source
  const isCurrentDataSource = location.pathname.includes(`/data-sources/${dataSource.id}`);
  
  return (
    <div className="select-none">
      {/* Folder Header */}
      <button
        onClick={handleToggle}
        className={`
          w-full flex items-center gap-2 px-3 py-2 rounded-lg
          text-left text-sm transition-colors
          ${isActive || isCurrentDataSource
            ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' 
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
          }
        `}
      >
        {/* Expand/Collapse Icon */}
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)]" />
        )}
        
        {/* Database Icon */}
        <Database className="w-4 h-4 flex-shrink-0" />
        
        {/* Name */}
        <span className="truncate font-medium">{dataSource.name}</span>
        
        {/* Table count badge */}
        {dataSource.table_count !== undefined && dataSource.table_count > 0 && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
            {dataSource.table_count}
          </span>
        )}
      </button>
      
      {/* Tables List (when expanded) */}
      {isExpanded && (
        <div className="ml-4 mt-1 space-y-0.5 border-l border-[var(--border-primary)] pl-2">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-tertiary)]">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading tables...
            </div>
          ) : total === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--text-tertiary)] italic">
              No imported tables
            </div>
          ) : (
            <>
              {/* Main Table - highlighted */}
              {mainTable && (
                <button
                  onClick={() => handleTableClick(mainTable.id)}
                  className={`
                    w-full flex items-center gap-2 px-3 py-1.5 rounded-lg
                    text-left text-sm transition-colors
                    ${location.pathname.includes(`/tables/${mainTable.id}`)
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                    }
                  `}
                >
                  <Table className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                  <span className="truncate font-medium">
                    {mainTable.displayName || mainTable.name}
                  </span>
                  <span className="ml-auto text-[10px] px-1 py-0.5 rounded bg-[var(--color-primary)]/20 text-[var(--color-primary)] uppercase font-semibold">
                    main
                  </span>
                </button>
              )}
              
              {/* Linked Tables */}
              {linkedTables.map((table) => (
                <button
                  key={table.id}
                  onClick={() => handleTableClick(table.id)}
                  className={`
                    w-full flex items-center gap-2 px-3 py-1.5 rounded-lg
                    text-left text-sm transition-colors
                    ${location.pathname.includes(`/tables/${table.id}`)
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                    }
                  `}
                >
                  <Table className="w-3.5 h-3.5" />
                  <span className="truncate">{table.displayName || table.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
