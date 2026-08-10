import React from 'react';
import { Link2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

export interface BoundRow {
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
  project_id?: number;
  project_name?: string;
}

interface BoundRowsChipsProps {
  boundRows: BoundRow[];
  inheritedBoundRows?: BoundRow[];
  onRowClick?: (row: BoundRow) => void;
  compact?: boolean;
  className?: string;
}

export function BoundRowsChips({ boundRows, inheritedBoundRows, onRowClick, compact, className }: BoundRowsChipsProps) {
  const hasOwn = boundRows?.length > 0;
  const hasInherited = (inheritedBoundRows?.length ?? 0) > 0;
  if (!hasOwn && !hasInherited) return null;

  const renderChip = (row: BoundRow, inherited = false) => (
    <button
      key={`${inherited ? 'inh-' : ''}${row.table_id}-${row.row_id}`}
      onClick={() => onRowClick?.(row)}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
        "transition-colors cursor-pointer border",
        inherited
          ? "bg-[var(--bg-tertiary)] border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          : "bg-[var(--color-primary-50,rgba(59,130,246,0.05))] border-[var(--color-primary-200,rgba(59,130,246,0.2))] text-[var(--color-primary-700,#1d4ed8)] hover:bg-[var(--color-primary-100,rgba(59,130,246,0.1))]"
      )}
      title={`${row.table_name || 'Table'} → #${row.row_id}${inherited ? ' (inherited)' : ''}`}
    >
      {row.table_icon ? (
        <span className="text-xs flex-shrink-0">{row.table_icon}</span>
      ) : (
        <Link2 className="w-3 h-3 flex-shrink-0" />
      )}
      <span className={cn("truncate", compact ? "max-w-[100px]" : "max-w-[150px]")}>
        {row.row_title || `#${row.row_id}`}
      </span>
    </button>
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-1 mt-1.5", className)}>
      <Link2 className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
      {hasOwn && boundRows.map(row => renderChip(row, false))}
      {hasInherited && inheritedBoundRows!.map(row => renderChip(row, true))}
    </div>
  );
}
