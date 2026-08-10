import { NavLink } from 'react-router-dom';
import { Table } from 'lucide-react';
import type { SystemTableItemProps } from './types';

export function SystemTableItem({ table, isActive }: SystemTableItemProps) {
  // Use sourceName (original table name) or name as technical key
  const technicalName = table.sourceName || table.name;

  return (
    <NavLink
      to={`/tables/${table.id}?mode=raw`}
      className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
        isActive
          ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
          : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
      }`}
    >
      <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
      <span className="truncate font-mono text-[10px]">{technicalName}</span>
      <span className="font-mono text-[10px]">({table.id})</span>
    </NavLink>
  );
}
