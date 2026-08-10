import { GripVertical, Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableWidgetItem } from './SortableWidgetItem';
import { InlineEditFolder } from './FolderForms';
import type { WidgetItem, WidgetFolder } from './types';

// ============================================================================
// Folder Bottom Drop Line (drag widget here to add to folder)
// ============================================================================
interface FolderBottomDropLineProps {
  folderId: string;
  isDragging: boolean;
}

function FolderBottomDropLine({ folderId, isDragging }: FolderBottomDropLineProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `folder-drop-${folderId}`,
    data: { type: 'folder-drop', folderId }
  });

  // Only show when dragging
  if (!isDragging) return null;

  return (
    <div
      ref={setNodeRef}
      className={`relative h-1 mx-2 my-0.5 rounded-full transition-all ${
        isOver
          ? 'bg-[var(--color-primary-500)] h-1.5 shadow-[0_0_8px_var(--color-primary-500)]'
          : 'bg-[var(--border-secondary)]'
      }`}
    >
      {isOver && (
        <span className="absolute left-1/2 -translate-x-1/2 -top-4 text-[9px] text-[var(--color-primary-600)] whitespace-nowrap bg-[var(--bg-primary)] px-1 rounded">
          + в папку
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Sortable Folder Component
// ============================================================================
interface SortableFolderProps {
  folder: WidgetFolder;
  widgets: Map<number, WidgetItem>;
  onToggle: () => void;
  onEdit: () => void;
  onSave: (folderId: string, name: string, icon?: string) => void;
  onDelete: (folderId: string) => void;
  isEditing: boolean;
  currentPath: string;
  isDragging: boolean;
}

export function SortableFolder({ folder, widgets, onToggle, onEdit, onSave, onDelete, isEditing, currentPath, isDragging }: SortableFolderProps) {
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

  const folderWidgets = folder.items.map(id => widgets.get(id)).filter(Boolean) as WidgetItem[];
  const folderIcon = folder.icon;

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
          onDoubleClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="flex items-center gap-2 px-1 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-1"
        >
          {folder.isExpanded ? (
            <ChevronDown className="w-2.5 h-2.5" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5" />
          )}
          {folderIcon ? (
            <span className="text-xs">{folderIcon}</span>
          ) : folder.isExpanded ? (
            <FolderOpen className="w-3 h-3 text-amber-500" />
          ) : (
            <Folder className="w-3 h-3 text-amber-500" />
          )}
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto text-[8px] px-1 rounded bg-[var(--bg-tertiary)]">
            {folder.items.length}
          </span>
        </button>
      </div>

      {/* Inline Edit Form */}
      {isEditing && (
        <InlineEditFolder
          folder={folder}
          onClose={onEdit}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}

      {folder.isExpanded && folderWidgets.length > 0 && (
        <div className="ml-6 space-y-0.5">
          <SortableContext items={folder.items} strategy={verticalListSortingStrategy}>
            {folderWidgets.map((widget) => (
              <SortableWidgetItem
                key={widget.id}
                widget={widget}
                isActive={currentPath.includes(`/widgets/${widget.id}`)}
              />
            ))}
          </SortableContext>
        </div>
      )}

      {/* Drop line - appears when dragging */}
      <FolderBottomDropLine folderId={folder.id} isDragging={isDragging} />
    </div>
  );
}
