import { NavLink } from 'react-router-dom';
import { GripVertical, Table, ChevronDown, ChevronRight, FolderOpen, Folder, Plus } from 'lucide-react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { showToast } from '@/shared/hooks/useToast';
import type { TableItem, SortableTableItemProps, SortableFolderProps } from './project-tables-nav/types';

// ============================================================================
// Sortable Table Item Component (simplified - just technical name, no settings)
// ============================================================================
export function SortableTableItem({ table, isActive, isDragging, isPrivileged }: SortableTableItemProps) {
  // Handle Ctrl+Click to copy table ID
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.ctrlKey && isPrivileged) {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(table.id);
        showToast(`ID ${table.id} скопирован`, 'success');
      } catch {
        showToast('Не удалось скопировать ID таблицы', 'error');
      }
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
        className="group relative flex items-center gap-1 px-1 py-1 rounded text-xs bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]"
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Переместить таблицу ${technicalName}`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing p-0.5 hover:bg-[var(--bg-secondary)] rounded"
        >
          <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
        </button>
        <NavLink
          to={`/tables/${table.id}?mode=raw`}
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={handleClick}
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
      className="group relative flex items-center gap-1 px-1 py-1 rounded text-xs transition cursor-grab active:cursor-grabbing text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Переместить таблицу ${technicalName}`}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5"
      >
        <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
      </button>
      <NavLink
        to={`/tables/${table.id}?mode=raw`}
        className="flex items-center gap-2 flex-1 min-w-0"
        onClick={handleClick}
      >
        <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
        <span className="truncate font-mono text-[10px]">{technicalName}</span>
        <span className="font-mono text-[10px]">({table.id})</span>
      </NavLink>
    </div>
  );
}

// ============================================================================
// Sortable Folder Component
// ============================================================================
export function SortableFolder({ folder, tables, onToggle, currentPath, projectId, isPrivileged }: SortableFolderProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isOver,
  } = useSortable({ id: folder.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const folderTables = folder.items.map(id => tables.get(id)).filter(Boolean) as TableItem[];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`space-y-0.5 ${isOver ? 'bg-[var(--color-primary-500)]/10 rounded' : ''}`}
    >
      <div className="group flex items-center gap-1">
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing p-0.5 hover:bg-[var(--bg-secondary)] rounded"
        >
          <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
        </button>
        <button
          onClick={onToggle}
          className="flex items-center gap-2 px-1 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-1"
        >
          {folder.isExpanded ? (
            <>
              <ChevronDown className="w-2 h-2" />
              <FolderOpen className="w-3 h-3 text-amber-500" />
            </>
          ) : (
            <>
              <ChevronRight className="w-2 h-2" />
              <Folder className="w-3 h-3 text-amber-500" />
            </>
          )}
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto text-[8px] px-1 rounded bg-[var(--bg-tertiary)]">
            {folder.items.length}
          </span>
        </button>
      </div>

      {folder.isExpanded && (
        <div className="ml-6 space-y-0.5">
          <SortableContext items={folder.items} strategy={verticalListSortingStrategy}>
            {folderTables.map((table) => (
              <SortableTableItem
                key={table.id}
                table={table}
                isActive={currentPath.includes(`/tables/${table.id}`)}
                projectId={projectId}
                isPrivileged={isPrivileged}
              />
            ))}
          </SortableContext>

          {/* Drop zone for dragging items into folder */}
          <div
            className={`
              flex items-center justify-center gap-1 px-2 py-1.5 rounded border-2 border-dashed
              text-[10px] text-[var(--text-tertiary)] transition-colors
              ${isOver
                ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 text-[var(--color-primary-600)]'
                : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'
              }
            `}
          >
            <Plus className="w-3 h-3" />
            <span>Перетащите сюда</span>
          </div>
        </div>
      )}
    </div>
  );
}
