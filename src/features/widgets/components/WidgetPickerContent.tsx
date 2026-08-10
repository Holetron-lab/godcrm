/**
 * WidgetPickerContent Component — ADR-073
 * Reusable content component for widget picker (used in both WidgetPickerModal and AddWidgetModal tabs)
 */

import { useState, useCallback, useMemo, memo } from 'react';
import { Search, Star, Clock, Folder, Globe, X } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { cn } from '@/shared/utils/cn';
import { WidgetGrid } from './WidgetGrid';
import { WidgetPreviewPanel } from './WidgetPreviewPanel';
import { useWidgetLibrary } from '../hooks/useWidgetLibrary';
import type { WidgetLibraryItem, WidgetCategory, WidgetAddMode } from '../types/widget-library.types';
import type { Widget, WidgetPosition } from '../types/widget.types';

/**
 * Category configuration
 */
interface CategoryConfig {
  id: WidgetCategory;
  label: string;
  icon: React.ReactNode;
}

const categories: CategoryConfig[] = [
  { id: 'favorites', label: 'Favorites', icon: <Star className="w-4 h-4" /> },
  { id: 'recent', label: 'Recent', icon: <Clock className="w-4 h-4" /> },
  { id: 'this_space', label: 'This Space', icon: <Folder className="w-4 h-4" /> },
  { id: 'all_spaces', label: 'All Spaces', icon: <Globe className="w-4 h-4" /> },
];

export interface WidgetPickerContentProps {
  dashboardId: number;
  spaceId: number;
  onWidgetAdded?: (widget: Widget) => void;
  /** Height of the content area. Use 'auto' for flexible height or a specific value like '500px' */
  height?: string;
}

export const WidgetPickerContent = memo(function WidgetPickerContent({
  dashboardId,
  spaceId,
  onWidgetAdded,
  height = '500px',
}: WidgetPickerContentProps) {
  // Local state
  const [activeCategory, setActiveCategory] = useState<WidgetCategory>('this_space');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWidget, setSelectedWidget] = useState<WidgetLibraryItem | null>(null);

  // Fetch library data
  const {
    items,
    total,
    categories: categoryCounts,
    isLoading,
    error,
    toggleFavorite,
    addToLibrary,
  } = useWidgetLibrary({
    spaceId,
    category: activeCategory,
    search: searchQuery || null,
    includePublic: activeCategory === 'all_spaces',
    enabled: spaceId > 0,
  });

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.preset_name?.toLowerCase().includes(query) ||
        item.space_name.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  // Handle category change
  const handleCategoryChange = useCallback((category: WidgetCategory) => {
    setActiveCategory(category);
    setSelectedWidget(null);
    setSearchQuery('');
  }, []);

  // Handle widget selection
  const handleSelectWidget = useCallback((widget: WidgetLibraryItem) => {
    setSelectedWidget(widget);
  }, []);

  // Handle favorite toggle
  const handleToggleFavorite = useCallback(
    async (widgetId: number) => {
      try {
        await toggleFavorite(widgetId);
        // Update selected widget if it was the one toggled
        if (selectedWidget?.widget_id === widgetId) {
          setSelectedWidget((prev) =>
            prev ? { ...prev, is_favorite: !prev.is_favorite } : null
          );
        }
      } catch (err) {
        logger.error('Failed to toggle favorite:', err);
      }
    },
    [toggleFavorite, selectedWidget]
  );

  // Handle add widget to dashboard
  const handleAddWidget = useCallback(
    async (mode: WidgetAddMode) => {
      if (!selectedWidget) return;

      try {
        // Calculate position (at the end, full width)
        const position: WidgetPosition = {
          x: 0,
          y: 1000, // Will be auto-adjusted by grid
          w: 6,
          h: 4,
        };

        const newWidget = await addToLibrary(
          dashboardId,
          selectedWidget.widget_id,
          mode,
          position
        );

        logger.debug('Widget added:', newWidget.id);
        onWidgetAdded?.(newWidget);

        // Reset selection after adding
        setSelectedWidget(null);
      } catch (err) {
        logger.error('Failed to add widget:', err);
      }
    },
    [selectedWidget, dashboardId, addToLibrary, onWidgetAdded]
  );

  return (
    <div className="flex gap-4" style={{ height }}>
      {/* Left sidebar - Categories */}
      <div className="w-48 flex-shrink-0 border-r border-[var(--border-primary)] pr-4">
        <nav className="space-y-1">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategoryChange(cat.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                activeCategory === cat.id
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              {cat.icon}
              <span className="flex-1 text-left">{cat.label}</span>
              {categoryCounts && (
                <span className="text-xs text-[var(--text-tertiary)]">
                  {categoryCounts[cat.id as keyof typeof categoryCounts] ?? 0}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="Search widgets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Widget grid */}
        <div className="flex-1 overflow-y-auto pr-2">
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-red-400">
                Failed to load widgets: {error.message}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 text-sm text-primary-400 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : (
            <WidgetGrid
              items={filteredItems}
              onSelect={handleSelectWidget}
              onFavorite={handleToggleFavorite}
              selectedId={selectedWidget?.widget_id}
              isLoading={isLoading}
              emptyMessage={
                searchQuery
                  ? `No widgets found for "${searchQuery}"`
                  : activeCategory === 'favorites'
                  ? 'No favorite widgets yet'
                  : activeCategory === 'recent'
                  ? 'No recently used widgets'
                  : 'No widgets in this category'
              }
            />
          )}
        </div>

        {/* Results count */}
        {!isLoading && !error && filteredItems.length > 0 && (
          <div className="text-xs text-[var(--text-tertiary)] mt-3">
            {filteredItems.length} of {total} widgets
          </div>
        )}
      </div>

      {/* Right panel - Preview */}
      <div className="w-64 flex-shrink-0 border-l border-[var(--border-primary)] pl-4">
        <WidgetPreviewPanel
          widget={selectedWidget}
          onAdd={handleAddWidget}
          onFavorite={() => {
            if (selectedWidget) {
              handleToggleFavorite(selectedWidget.widget_id);
            }
          }}
          showModeSelector={selectedWidget !== null && !selectedWidget.is_own_space}
        />
      </div>
    </div>
  );
});

export default WidgetPickerContent;
