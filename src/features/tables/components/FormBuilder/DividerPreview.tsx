import React from 'react';
import {
  ArrowUp,
  ArrowDown,
  Trash2,
} from 'lucide-react';

// Divider preview component
export function DividerPreview({
  isSelected,
  onClick,
  isPageBreak = false,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp,
  canMoveDown,
  isPreviewMode = false,
  order,
  onOrderChange,
}: {
  isSelected: boolean;
  onClick: () => void;
  isPageBreak?: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isPreviewMode?: boolean;
  order?: number;
  onOrderChange?: (order: number) => void;
}) {
  // In preview mode, page breaks are not shown (handled by pagination)
  if (isPreviewMode && isPageBreak) return null;

  // In preview mode, show simple divider
  if (isPreviewMode) {
    return (
      <div className="w-full py-2">
        <div className="h-px bg-[var(--border-primary)]" />
      </div>
    );
  }

  return (
    <div className="w-full p-1.5">
      <div
        onClick={onClick}
        className={`
          rounded-lg border border-dashed flex items-center cursor-pointer transition-all px-2
          ${isSelected
            ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10'
            : 'border-[var(--border-primary)] hover:border-[var(--color-primary-400)]'}
        `}
      >
        {/* Move arrows */}
        <div className="flex items-center gap-1 mr-2">
          <button
            disabled={!canMoveUp}
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
          >
            <ArrowUp className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          </button>
          <button
            disabled={!canMoveDown}
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
          >
            <ArrowDown className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          </button>
          {order !== undefined && onOrderChange && (
            <input
              type="number"
              min={1}
              defaultValue={order}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  const newOrder = parseInt((e.target as HTMLInputElement).value) || order;
                  onOrderChange(newOrder);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              onBlur={(e) => {
                const newOrder = parseInt(e.target.value) || order;
                if (newOrder !== order) {
                  onOrderChange(newOrder);
                }
              }}
              className="w-12 px-1.5 py-0.5 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-[10px] text-center focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
              title="Порядок (Enter для применения)"
            />
          )}
        </div>

        <div className="flex-1 h-px bg-[var(--border-primary)] mx-2" />
        <span className="text-[10px] text-[var(--text-tertiary)] py-2">
          {isPageBreak ? 'Новая страница' : 'Разделитель'}
        </span>
        <div className="flex-1 h-px bg-[var(--border-primary)] mx-2" />

        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 rounded hover:bg-red-500/20 text-red-500 ml-2"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
