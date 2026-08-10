import { GitBranch, Link2, GripHorizontal, Workflow } from 'lucide-react';
import type { TimelineItem, ViewMode, ColorOption } from './types';

interface TimelineFooterProps {
  displayItems: TimelineItem[];
  dataLength: number;
  viewMode: ViewMode;
  edgesMode: boolean;
  connectingFrom: { itemId: string; side: 'left' | 'right' } | null;
  colorColumn: string | undefined;
  colorOptions: ColorOption[];
  onEventUpdate?: (eventId: string, field: string, value: unknown) => void;
}

export function TimelineFooter({
  displayItems,
  dataLength,
  viewMode,
  edgesMode,
  connectingFrom,
  colorColumn,
  colorOptions,
  onEventUpdate,
}: TimelineFooterProps) {
  return (
    <div className="px-3 py-2 border-t border-[var(--border-primary)] flex items-center justify-between text-xs text-[var(--text-tertiary)] bg-[var(--bg-secondary)] flex-shrink-0">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <GitBranch className="w-3.5 h-3.5" />
          {displayItems.length} из {dataLength} событий
        </span>
        {colorColumn && colorOptions.length > 0 && (
          <div className="flex items-center gap-1">
            {colorOptions.slice(0, 5).map((opt: ColorOption) => (
              <div
                key={opt.value}
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: opt.color }}
                title={opt.label}
              />
            ))}
            {colorOptions.length > 5 && (
              <span className="text-[10px]">+{colorOptions.length - 5}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-4">
        {viewMode === 'gantt' && !edgesMode && (
          <span className="flex items-center gap-1">
            <Link2 className="w-3.5 h-3.5" />
            Режим Gantt: связи между задачами
          </span>
        )}
        {onEventUpdate && !edgesMode && (
          <span className="hidden sm:flex items-center gap-1">
            <GripHorizontal className="w-3.5 h-3.5" />
            Перетаскивайте и растягивайте задачи
          </span>
        )}
        {edgesMode && !connectingFrom && (
          <span className="hidden sm:flex items-center gap-1 text-[var(--color-primary-500)]">
            <Workflow className="w-3.5 h-3.5" />
            Режим соединения: кликните на кружок для начала связи
          </span>
        )}
        {edgesMode && connectingFrom && (
          <span className="flex items-center gap-1 text-green-500 animate-pulse">
            <Workflow className="w-3.5 h-3.5" />
            Выберите второй элемент для соединения (Esc - отмена)
          </span>
        )}
      </div>
    </div>
  );
}
