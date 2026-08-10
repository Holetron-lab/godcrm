import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import type { TableModel } from '@/features/tables/types/table.types';
import { ChevronRight, ChevronDown, FolderOpen, Folder } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export interface TableGroupProps {
  parentTable: TableModel;
  childTables: TableModel[];
  activeTableId: string | null;
}

export const TableGroup = ({ parentTable, childTables, activeTableId }: TableGroupProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [isExpanded, setIsExpanded] = useState(false);
  const isParentActive = activeTableId === parentTable.id;
  const hasActiveChild = childTables.some(t => t.id === activeTableId);

  // Auto-expand if child is active
  useEffect(() => {
    if (hasActiveChild && !isExpanded) {
      setIsExpanded(true);
    }
  }, [hasActiveChild]);

  return (
    <div className="rounded-lg overflow-hidden">
      {/* Parent table as folder header */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex-1 flex items-center gap-2 rounded-lg px-2 py-1 text-sm transition ${
            isParentActive || hasActiveChild
              ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
          }`}
        >
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {isExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
          <span>{parentTable.displayName ?? parentTable.name}</span>
          <span className="text-xs text-[var(--text-tertiary)]">({childTables.length + 1})</span>
        </button>
      </div>

      {/* Child tables */}
      {isExpanded && (
        <div className="ml-4 pl-2 border-l border-[var(--border-primary)] flex flex-col gap-0.5 mt-1">
          {/* Parent table as first item - highlighted */}
          <NavLink
            to={`/tables/${parentTable.id}`}
            className={({ isActive: linkActive }) =>
              `rounded-lg px-3 py-1 text-sm transition truncate font-medium ${
                linkActive || activeTableId === parentTable.id
                  ? 'text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/20'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`
            }
            title={`${parentTable.source_table_name || parentTable.name} ${t('(основная таблица)', '(main table)')}`}
          >
            📊 {parentTable.source_table_name || parentTable.name}
          </NavLink>

          {/* Child tables */}
          {childTables.map((table) => (
            <NavLink
              key={table.id}
              to={`/tables/${table.id}`}
              className={({ isActive: linkActive }) =>
                `rounded-lg px-3 py-1 text-sm transition truncate ${
                  linkActive || activeTableId === table.id
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`
              }
              title={table.displayName ?? table.name}
            >
              {table.displayName ?? table.name}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
};
