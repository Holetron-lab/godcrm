import { useState, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { NavLink } from 'react-router-dom';
import { GripVertical, Settings } from 'lucide-react';
import { EditWidgetDisplayModal } from '@/features/widgets/components/EditWidgetDisplayModal';
import { useDeleteWidget } from '@/features/widgets/hooks/useWidgets';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { widgetTypeConfig } from './types';
import type { WidgetItem } from './types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface SortableWidgetItemProps {
  widget: WidgetItem;
  isActive: boolean;
  isDragging?: boolean;
}

export function SortableWidgetItem({ widget, isActive, isDragging }: SortableWidgetItemProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const deleteWidgetMutation = useDeleteWidget();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: widget.id });

  const handleDeleteWidget = useCallback(async () => {
    if (confirm(t('Вы уверены, что хотите удалить этот модуль?', 'Are you sure you want to delete this module?'))) {
      try {
        await deleteWidgetMutation.mutateAsync(widget.id);
      } catch (err) {
        logger.error('Error deleting widget:', err);
      }
    }
  }, [widget.id, deleteWidgetMutation]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.8 : 1,
    zIndex: isSortableDragging ? 1000 : undefined,
    position: isSortableDragging ? 'relative' as const : undefined,
  };

  const config = widgetTypeConfig[widget.preset_name || ''] || { emoji: '📊', labelKey: 'widgets.types.table' };
  const emoji = widget.icon || config.emoji;
  const isTableWidget = widget.preset_name === 'table_widget' || widget.preset_name === 'table_view';
  const tableId = widget.config?.tableId || widget.config?.table_id;

  const url = isTableWidget && tableId
    ? `/tables/${tableId}`
    : `/widgets/${widget.id}`;

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={`group flex items-center gap-1 px-1 py-1 rounded text-xs transition cursor-grab active:cursor-grabbing ${
          isSortableDragging ? 'shadow-lg bg-[var(--bg-primary)] border border-[var(--border-primary)]' : ''
        } ${
          isActive
            ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
            : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
        }`}
      >
        <span className="opacity-0 group-hover:opacity-100 p-0.5">
          <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
        </span>
        <NavLink
          to={url}
          title={widget.description || ''}
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={(e) => {
            // Prevent navigation when dragging
            if (isSortableDragging) {
              e.preventDefault();
            }
          }}
        >
          <span>{emoji}</span>
          <span className="truncate">{widget.title}</span>
        </NavLink>

        {/* Settings button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setEditModalOpen(true);
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--bg-tertiary)] transition"
          title={t('Настройки модуля', 'Module settings')}
        >
          <Settings className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        </button>
      </div>

      {/* Edit Widget Display Modal */}
      <EditWidgetDisplayModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        widgetId={widget.id}
        currentTitle={widget.title}
        currentIcon={widget.icon}
        currentDescription={widget.description}
        tableId={widget.config?.table_id ?? widget.config?.tableId}
        onDeleteClick={handleDeleteWidget}
      />
    </>
  );
}
