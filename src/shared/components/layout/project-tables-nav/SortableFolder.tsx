import {
  ChevronRight, ChevronDown, FolderOpen, Folder, GripVertical, Plus,
} from 'lucide-react';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableTableItem } from './SortableTableItem';
import type { SortableFolderProps, TableItem } from './types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export function SortableFolder({ folder, tables, onToggle, currentPath, projectId, isPrivileged }: SortableFolderProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
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
            <span>{t('Перетащите сюда', 'Drop here')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
