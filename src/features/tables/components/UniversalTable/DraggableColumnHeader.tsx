import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { flexRender, Header } from '@tanstack/react-table';
import type { RowModel, ColumnModel } from '../../types/table.types';

interface DraggableColumnHeaderProps {
  header: Header<RowModel, unknown>;
  column?: ColumnModel;
  isFirst?: boolean;
  rawMode?: boolean;
}

export const DraggableColumnHeader = ({ header, column, isFirst, rawMode }: DraggableColumnHeaderProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({ id: header.id });
  
  const isFromSource = column?.is_from_source === true;
  const isIdColumn = column?.name?.toLowerCase() === 'id';
  const columnColor = column?.config?.appearance?.columnColor;
  
  // RAW mode colors: red for id, yellow for from_source columns
  const rawModeBackground = rawMode 
    ? (isIdColumn 
        ? 'linear-gradient(to right, rgba(239, 68, 68, 0.4), rgba(239, 68, 68, 0.2))' 
        : isFromSource 
          ? 'linear-gradient(to right, rgba(234, 179, 8, 0.25), rgba(234, 179, 8, 0.1))' 
          : 'var(--bg-secondary)')
    : undefined;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms ease',
    width: header.getSize(),
    maxWidth: header.getSize(),
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 100 : 20,
    scale: isDragging ? 1.02 : 1,
    // RAW mode background takes priority, then column color, then default
    background: rawModeBackground 
      ? rawModeBackground
      : columnColor 
        ? `linear-gradient(to right, ${columnColor}40, ${columnColor}25)`
        : 'var(--bg-secondary)',
    // Apply column color indicator on left (not in RAW mode)
    ...(!rawMode && columnColor && !isDragging ? {
      borderLeftColor: columnColor,
      borderLeftWidth: '3px',
      borderLeftStyle: 'solid' as const
    } : {}),
    // RAW mode: red border for id column
    ...(rawMode && isIdColumn && !isDragging ? {
      borderLeftColor: 'rgb(239, 68, 68)',
      borderLeftWidth: '4px',
      borderLeftStyle: 'solid' as const
    } : {}),
    // RAW mode: yellow border for from_source columns
    ...(rawMode && isFromSource && !isIdColumn && !isDragging ? {
      borderLeftColor: 'rgb(234, 179, 8)',
      borderLeftWidth: '3px',
      borderLeftStyle: 'solid' as const
    } : {})
  };

  // Text color classes based on mode
  const textColorClass = rawMode
    ? (isIdColumn 
        ? 'text-red-400' 
        : isFromSource 
          ? 'text-amber-400' 
          : 'text-[var(--text-secondary)]')
    : columnColor 
      ? '' 
      : 'text-[var(--text-secondary)]';

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={`sticky top-0 relative px-3 py-1 text-left text-xs font-semibold uppercase tracking-wide transition-all duration-200 ${
        isFirst ? 'rounded-tl-xl border-l border-[var(--border-primary)]' : ''
      } ${textColorClass} ${
        isDragging ? 'shadow-2xl ring-2 ring-[var(--color-primary-500)]/50 rounded-lg backdrop-blur-xl bg-white/80 dark:bg-black/60' : ''
      } ${isOver ? 'bg-[var(--color-primary-500)]/15' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className={`cursor-grab active:cursor-grabbing p-1 -ml-2 rounded transition-all duration-150 ${
            isDragging 
              ? 'text-[var(--color-primary-500)] scale-110'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
          }`}
          title="Перетащите для изменения порядка"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        
        {/* Column header content */}
        <span className="flex-1 truncate">
          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
        </span>
      </div>
      
      {/* Resize handle */}
      {header.column.getCanResize() && !isDragging && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none transition-colors ${
            header.column.getIsResizing()
              ? 'bg-[var(--color-primary-500)] w-1.5'
              : 'bg-[var(--border-primary)] opacity-0 hover:opacity-100 hover:bg-[var(--color-primary-400)]'
          }`}
          title="Drag to resize"
        />
      )}
      
      {/* Right border divider - rendered on top to cover gaps */}
      {!isDragging && (
        <div 
          className="absolute right-0 top-0 bottom-0 w-px pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.25)' }}
        />
      )}
      
      {/* Drop indicator line */}
      {isOver && !isDragging && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-primary-500)] rounded-full animate-pulse" />
      )}
    </th>
  );
};
