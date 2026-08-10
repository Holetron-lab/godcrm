import { ChevronRight, ChevronDown, Database } from 'lucide-react';
import { ExternalTableItem } from './ExternalTableItem';
import type { ExternalDbGroupProps } from './types';

export function ExternalDbGroup({ dbName, tables, isExpanded, onToggle, currentPath, projectId }: ExternalDbGroupProps) {
  return (
    <div className="space-y-0.5">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-2 h-2" />
        ) : (
          <ChevronRight className="w-2 h-2" />
        )}
        <Database className="w-2.5 h-2.5 text-primary-500" />
        <span className="truncate">{dbName}</span>
        <span className="ml-auto text-[8px] w-6 text-right">
          {tables.length}
        </span>
      </button>

      {isExpanded && (
        <div className="ml-5 space-y-0.5">
          {tables.map((table) => (
            <ExternalTableItem
              key={table.id}
              table={table}
              isActive={currentPath.includes(`/tables/${table.id}`)}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
