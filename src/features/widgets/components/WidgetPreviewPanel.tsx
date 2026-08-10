/**
 * WidgetPreviewPanel Component — ADR-073
 * Preview panel showing selected widget details
 */

import { useState, memo } from 'react';
import { Star, Plus, Copy, Link, Calendar, Table2, Hash, Clock } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { WidgetLibraryItem, WidgetAddMode } from '../types/widget-library.types';

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

// Human-readable preset names
const presetLabels: Record<string, string> = {
  table_view: 'Table View',
  kanban_board: 'Kanban Board',
  calendar_widget: 'Calendar',
  timeline_widget: 'Timeline',
  chart_widget: 'Chart',
  task_list: 'Task List',
  recent_activity: 'Recent Activity',
  ai_agents: 'AI Agents',
  documents: 'Documents',
  virtual_office: 'Virtual Office',
  data_sources: 'Data Sources',
  labs: 'Labs',
  wellness: 'Wellness',
  fitness: 'Fitness',
  gallery: 'Gallery',
  quick_links: 'Quick Links',
  project_stats: 'Project Stats',
  metric_card: 'Metric Card',
};

export interface WidgetPreviewPanelProps {
  widget: WidgetLibraryItem | null;
  onAdd: (mode: WidgetAddMode) => void;
  onFavorite: () => void;
  showModeSelector?: boolean;
}

export const WidgetPreviewPanel = memo(function WidgetPreviewPanel({
  widget,
  onAdd,
  onFavorite,
  showModeSelector = false,
}: WidgetPreviewPanelProps) {
  const [selectedMode, setSelectedMode] = useState<WidgetAddMode>('reference');

  // Empty state
  if (!widget) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
          <Plus className="w-8 h-8 text-[var(--text-tertiary)]" />
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          Select a widget to preview
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Click on a widget card to see details
        </p>
      </div>
    );
  }

  // Get icon and label
  const icon = widget.icon || (widget.preset_name && presetIcons[widget.preset_name]) || '📦';
  const typeLabel = widget.preset_name
    ? presetLabels[widget.preset_name] || widget.preset_name
    : 'Custom Widget';

  // Format last used date
  const formatLastUsed = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start gap-4 pb-4 border-b border-[var(--border-primary)]">
        <div className="w-16 h-16 flex items-center justify-center text-4xl bg-[var(--bg-secondary)] rounded-xl">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg text-[var(--text-primary)] truncate">
            {widget.title}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">{typeLabel}</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            {widget.space_name}
          </p>
        </div>
        <button
          type="button"
          onClick={onFavorite}
          className={cn(
            'p-2 rounded-lg transition-colors',
            'hover:bg-[var(--bg-secondary)]',
            widget.is_favorite ? 'text-yellow-500' : 'text-[var(--text-tertiary)]'
          )}
          title={widget.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star className={cn('w-5 h-5', widget.is_favorite && 'fill-current')} />
        </button>
      </div>

      {/* Details */}
      <div className="flex-1 py-4 space-y-3 overflow-y-auto">
        {/* Table info */}
        {widget.table_name && (
          <div className="flex items-center gap-3 text-sm">
            <Table2 className="w-4 h-4 text-[var(--text-tertiary)]" />
            <span className="text-[var(--text-secondary)]">Table:</span>
            <span className="text-[var(--text-primary)] truncate">{widget.table_name}</span>
          </div>
        )}

        {/* Row count */}
        {widget.row_count !== null && widget.row_count !== undefined && (
          <div className="flex items-center gap-3 text-sm">
            <Hash className="w-4 h-4 text-[var(--text-tertiary)]" />
            <span className="text-[var(--text-secondary)]">Rows:</span>
            <span className="text-[var(--text-primary)]">{widget.row_count.toLocaleString()}</span>
          </div>
        )}

        {/* Use count */}
        <div className="flex items-center gap-3 text-sm">
          <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />
          <span className="text-[var(--text-secondary)]">Used:</span>
          <span className="text-[var(--text-primary)]">
            {widget.use_count} {widget.use_count === 1 ? 'time' : 'times'}
          </span>
        </div>

        {/* Last used */}
        <div className="flex items-center gap-3 text-sm">
          <Clock className="w-4 h-4 text-[var(--text-tertiary)]" />
          <span className="text-[var(--text-secondary)]">Last used:</span>
          <span className="text-[var(--text-primary)]">
            {formatLastUsed(widget.last_used_at)}
          </span>
        </div>

        {/* Tags */}
        {widget.tags && widget.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-4">
            {widget.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Mode selector (for cross-space widgets) */}
      {showModeSelector && !widget.is_own_space && (
        <div className="py-3 border-t border-[var(--border-primary)]">
          <p className="text-xs text-[var(--text-tertiary)] mb-2">Add mode:</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedMode('reference')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm transition-colors',
                selectedMode === 'reference'
                  ? 'bg-primary-500 text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              )}
            >
              <Link className="w-4 h-4" />
              Reference
            </button>
            <button
              type="button"
              onClick={() => setSelectedMode('copy')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm transition-colors',
                selectedMode === 'copy'
                  ? 'bg-primary-500 text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              )}
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-2">
            {selectedMode === 'reference'
              ? 'Widget will stay synced with the source'
              : 'Creates an independent copy of the widget'}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="pt-4 border-t border-[var(--border-primary)]">
        <button
          type="button"
          onClick={() => onAdd(showModeSelector && !widget.is_own_space ? selectedMode : 'copy')}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
        >
          <Plus className="w-5 h-5" />
          Add to Dashboard
        </button>
      </div>
    </div>
  );
});

export default WidgetPreviewPanel;
