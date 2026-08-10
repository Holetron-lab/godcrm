import { NavLink } from 'react-router-dom';
import { GripVertical, Table } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { showToast } from '@/shared/hooks/useToast';
import type { SortableTableItemProps } from './types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export function SortableTableItem({ table, isActive, isDragging, isPrivileged }: SortableTableItemProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  // Handle Ctrl+Click to copy table ID
  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey && isPrivileged) {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(table.id);
      showToast(t(`ID ${table.id} скопирован`, `ID ${table.id} copied`), 'success');
    }
  };
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: table.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Use sourceName (original table name) or name as technical key
  const technicalName = table.sourceName || table.name;

  // Active table (currently open) - still clickable to go to raw view
  if (isActive) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        onClick={handleClick}
        className="group relative flex items-center gap-1 px-1 py-1 rounded text-xs bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]"
      >
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing p-0.5 hover:bg-[var(--bg-secondary)] rounded"
        >
          <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
        </button>
        <NavLink
          to={`/tables/${table.id}?mode=raw`}
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
          <span className="truncate font-mono text-[10px]">{technicalName}</span>
          <span className="font-mono text-[10px]">({table.id})</span>
        </NavLink>
      </div>
    );
  }

  // Inactive table
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleClick}
      className="group relative flex items-center gap-1 px-1 py-1 rounded text-xs transition cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
    >
      <span
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 p-0.5"
      >
        <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
      </span>
      <NavLink
        to={`/tables/${table.id}?mode=raw`}
        className="flex items-center gap-2 flex-1 min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
        <span className="truncate font-mono text-[10px]">{technicalName}</span>
        <span className="font-mono text-[10px]">({table.id})</span>
      </NavLink>
    </div>
  );
}
