/**
 * BoundRowChip — minimal pill rendered for each bound row in BoundRowsStrip.
 * Prefix indicates source table:
 *   - documents → FileText lucide icon
 *   - tickets   → Ticket lucide icon
 *   - other     → table_name as text label
 * Then the row's emoji + full-width title with ellipsis. The rich state
 * (type/status pills, description, action icons) lives in the toolbar.
 */
import React from 'react';
import { FileText, Ticket } from 'lucide-react';
import { useBoundRowDisplay, type BoundRowRef } from '../hooks/useBoundRowDisplay';
import type { TasksSourceConfig, FavoritesConfig } from '../types';

interface BoundRowChipProps {
  br: BoundRowRef;
  active: boolean;
  onClick: () => void;
  tasksSource?: TasksSourceConfig | null;
  favoritesConfig?: FavoritesConfig | null;
}

export function BoundRowChip({ br, active, onClick, tasksSource, favoritesConfig }: BoundRowChipProps) {
  const { icon, title, kind } = useBoundRowDisplay(br, tasksSource, favoritesConfig);

  const tablePrefix =
    kind === 'documents' ? <FileText className="w-3 h-3 flex-shrink-0 text-[var(--text-tertiary)]" /> :
    kind === 'tickets'   ? <Ticket   className="w-3 h-3 flex-shrink-0 text-[var(--text-tertiary)]" /> :
    br.table_name        ? <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">{br.table_name}</span> :
    null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors text-[11px] min-w-0 flex-1 ${
        active
          ? 'bg-blue-500/20 text-[var(--text-primary)]'
          : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
      }`}
      title={`${br.table_name || 'Table'} · ${title}`}
    >
      {tablePrefix}
      {icon && <span className="text-xs flex-shrink-0">{icon}</span>}
      <span className="font-medium truncate min-w-0 flex-1 text-left">{title}</span>
    </button>
  );
}
