/**
 * WidgetGrid Component — ADR-073
 * Responsive grid for displaying widget library items
 */

import { memo } from 'react';
import { Package } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import type { WidgetLibraryItem } from '../types/widget-library.types';

export interface WidgetGridProps {
  items: WidgetLibraryItem[];
  onSelect: (item: WidgetLibraryItem) => void;
  onFavorite: (widgetId: number) => void;
  selectedId?: number;
  isLoading?: boolean;
  emptyMessage?: string;
}

/**
 * Loading skeleton for widget cards
 */
function WidgetCardSkeleton() {
  return (
    <div className="flex flex-col items-center p-4 rounded-xl bg-[var(--bg-secondary)] animate-pulse">
      <div className="w-12 h-12 rounded-xl bg-[var(--bg-tertiary)] mb-3" />
      <div className="w-20 h-4 rounded bg-[var(--bg-tertiary)] mb-1" />
      <div className="w-16 h-3 rounded bg-[var(--bg-tertiary)]" />
    </div>
  );
}

/**
 * Empty state component
 */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
        <Package className="w-8 h-8 text-[var(--text-tertiary)]" />
      </div>
      <p className="text-sm text-[var(--text-secondary)]">{message}</p>
    </div>
  );
}

export const WidgetGrid = memo(function WidgetGrid({
  items,
  onSelect,
  onFavorite,
  selectedId,
  isLoading = false,
  emptyMessage = 'No widgets found',
}: WidgetGridProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <WidgetCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  // Grid of widget cards
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map((item) => (
        <WidgetCard
          key={item.widget_id}
          item={item}
          isSelected={selectedId === item.widget_id}
          onClick={() => onSelect(item)}
          onFavorite={(e) => {
            e.stopPropagation();
            onFavorite(item.widget_id);
          }}
        />
      ))}
    </div>
  );
});

export default WidgetGrid;
