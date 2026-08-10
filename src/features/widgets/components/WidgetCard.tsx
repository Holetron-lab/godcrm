/**
 * WidgetCard Component — ADR-073
 * Card component for displaying a widget in the picker grid
 */

import { memo } from 'react';
import { Star, Globe } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { WidgetLibraryItem } from '../types/widget-library.types';

// Icon mapping for widget presets
const presetIcons: Record<string, string> = {
  table_view: '📋',
  kanban_board: '📊',
  calendar_widget: '📅',
  timeline_widget: '⏱️',
  chart_widget: '📈',
  task_list: '✅',
  recent_activity: '📰',
  ai_agents: '🤖',
  documents: '📄',
  virtual_office: '🏢',
  data_sources: '🔗',
  labs: '🧪',
  wellness: '🧘',
  fitness: '💪',
  gallery: '🖼️',
  quick_links: '🔗',
  project_stats: '📊',
  metric_card: '📈',
};

export interface WidgetCardProps {
  item: WidgetLibraryItem;
  isSelected: boolean;
  onClick: () => void;
  onFavorite: (e: React.MouseEvent) => void;
}

export const WidgetCard = memo(function WidgetCard({
  item,
  isSelected,
  onClick,
  onFavorite,
}: WidgetCardProps) {
  // Get icon - prefer item's icon, fallback to preset icon, then default
  const icon = item.icon || (item.preset_name && presetIcons[item.preset_name]) || '📦';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center p-4 rounded-xl border-2 transition-all text-left w-full',
        'hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-secondary)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        isSelected
          ? 'border-primary-500 bg-primary-500/10'
          : 'border-transparent bg-[var(--bg-secondary)]'
      )}
    >
      {/* Favorite button */}
      <button
        type="button"
        onClick={onFavorite}
        className={cn(
          'absolute top-2 right-2 p-1 rounded-md transition-colors',
          'hover:bg-[var(--bg-primary)]',
          item.is_favorite ? 'text-yellow-500' : 'text-[var(--text-tertiary)]'
        )}
        title={item.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star
          className={cn('w-4 h-4', item.is_favorite && 'fill-current')}
        />
      </button>

      {/* Public indicator */}
      {item.is_public && (
        <div
          className="absolute top-2 left-2 p-1 text-[var(--text-tertiary)]"
          title="Public widget"
        >
          <Globe className="w-3.5 h-3.5" />
        </div>
      )}

      {/* Icon */}
      <div className="w-12 h-12 flex items-center justify-center text-3xl mb-3">
        {icon}
      </div>

      {/* Title */}
      <h4 className="font-medium text-sm text-[var(--text-primary)] text-center line-clamp-2 mb-1">
        {item.title}
      </h4>

      {/* Space name (if from different space) */}
      {!item.is_own_space && (
        <p className="text-xs text-[var(--text-tertiary)] truncate max-w-full">
          {item.space_name}
        </p>
      )}

      {/* Stats */}
      <div className="flex items-center gap-2 mt-2 text-xs text-[var(--text-tertiary)]">
        {item.use_count > 0 && (
          <span>{item.use_count} uses</span>
        )}
        {item.table_name && (
          <span className="truncate max-w-[80px]" title={item.table_name}>
            {item.table_name}
          </span>
        )}
      </div>
    </button>
  );
});

export default WidgetCard;
