import { useState, useCallback, useEffect, useRef } from 'react';
import GridLayout, { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { Plus, GripVertical, Trash2, Filter } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { DashboardWidgetCard } from './DashboardWidgetCard';
import { AddWidgetModal } from './AddWidgetModal';
import { useWidgets, useUpdateWidget, useDeleteWidget } from '../hooks/useWidgets';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import type { Widget, WidgetPosition } from '../types/widget.types';

interface DashboardGridProps {
  dashboardId: number;
  spaceId?: number;
  isEditable?: boolean;
  onAddWidget?: () => void;
  onWidgetAdded?: () => void;
  borderRadius?: number;
  widgetGap?: number;
  /** Show floating action button for quick-add. Default: true when editable */
  showQuickAddButton?: boolean;
  /**
   * ADR-0060 P5b — when true, drag/resize/add/delete are disabled and edit
   * affordances are hidden. Public read-only routes can also rely on
   * `PublicViewContext` instead of threading this prop; both routes converge.
   */
  readOnly?: boolean;
}

export function DashboardGrid({
  dashboardId,
  spaceId = 0,
  isEditable = false,
  onAddWidget,
  onWidgetAdded,
  borderRadius = 12,
  widgetGap = 16,
  showQuickAddButton,
  readOnly = false,
}: DashboardGridProps) {
  const isPublicReadOnly = useIsPublicReadOnly();
  // Effective edit gate: explicit readOnly OR public-view scope wins over isEditable.
  const effectiveEditable = isEditable && !readOnly && !isPublicReadOnly;
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);

  // Show quick add button by default in edit mode, unless explicitly disabled
  const shouldShowQuickAdd = showQuickAddButton ?? effectiveEditable;
  
  const { data: widgets = [], isLoading, error } = useWidgets(dashboardId);
  const updateWidgetMutation = useUpdateWidget();
  const deleteWidgetMutation = useDeleteWidget();

  // Responsive width and mobile detection
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        if (width > 0) {
          setContainerWidth(width);
          setIsMobile(width < 640);
        }
      }
    };
    
    // Initial update with small delay to ensure DOM is ready
    const timeoutId = setTimeout(updateWidth, 0);
    
    window.addEventListener('resize', updateWidth);
    
    // ResizeObserver for container changes
    const resizeObserver = new ResizeObserver(updateWidth);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updateWidth);
      resizeObserver.disconnect();
    };
  }, []);  // Convert widgets to react-grid-layout format
  const layoutItems: Layout[] = widgets.map((widget) => ({
    i: String(widget.id),
    x: widget.position.x,
    y: widget.position.y,
    w: widget.position.w,
    h: widget.position.h,
    minW: widget.position.minW || 2,
    maxW: widget.position.maxW || 12,
    minH: widget.position.minH || 2,
    maxH: widget.position.maxH,
  }));

  // Mobile-adapted layout: single column, full width
  const mobileLayoutItems: Layout[] = widgets.map((widget, index) => ({
    i: String(widget.id),
    x: 0,
    y: index * 4,
    w: 1,
    h: Math.min(widget.position.h, 5),
    minW: 1,
    maxW: 1,
    minH: 2,
    maxH: widget.position.maxH,
  }));

  // Grid settings based on screen size
  const gridCols = isMobile ? 1 : 12;
  const gridRowHeight = isMobile ? 60 : 80;
  const gridMargin: [number, number] = isMobile ? [0, 4] : [widgetGap, widgetGap];
  const currentLayout = isMobile ? mobileLayoutItems : layoutItems;

  const handleLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      if (!effectiveEditable) return;

      // Update widgets with new positions
      newLayout.forEach((item) => {
        const widget = widgets.find((w) => String(w.id) === item.i);
        if (!widget) return;

        const newPosition: WidgetPosition = {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          minW: item.minW,
          maxW: item.maxW,
          minH: item.minH,
          maxH: item.maxH,
        };

        // Only update if position changed
        if (JSON.stringify(newPosition) !== JSON.stringify(widget.position)) {
          updateWidgetMutation.mutate({
            widgetId: widget.id,
            updates: { position: newPosition },
          });
        }
      });
    },
    [widgets, effectiveEditable, updateWidgetMutation]
  );

  const handleDeleteWidget = useCallback(
    (widgetId: number) => {
      deleteWidgetMutation.mutate(widgetId);
    },
    [deleteWidgetMutation]
  );

  const handleToggleFilters = useCallback(
    async (widgetId: number, showFilters: boolean) => {
      const widget = widgets.find(w => w.id === widgetId);
      if (!widget) return;
      
      await updateWidgetMutation.mutateAsync({
        widgetId,
        updates: {
          config: {
            ...widget.config,
            show_filters: showFilters
          }
        }
      });
      
      // Invalidate widget cache to update DashboardWidgetCard
      queryClient.invalidateQueries({ queryKey: ['widget', widgetId] });
    },
    [widgets, updateWidgetMutation, queryClient]
  );

  const handleResizeWidget = useCallback(
    (widgetId: number, position: WidgetPosition) => {
      updateWidgetMutation.mutate({
        widgetId,
        updates: { position },
      });
    },
    [updateWidgetMutation]
  );

  // Handle widget added from picker (moved BEFORE early returns to fix hooks order)
  const handleWidgetAdded = useCallback(
    (widget: Widget) => {
      // Invalidate widgets list to refresh
      queryClient.invalidateQueries({ queryKey: ['widgets', dashboardId] });
      onWidgetAdded?.();
      setShowWidgetPicker(false);
    },
    [queryClient, dashboardId, onWidgetAdded]
  );

  if (isLoading || containerWidth === 0) {
    return (
      <div className="w-full" ref={containerRef}>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading widgets...</div>
        </div>
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-[var(--bg-secondary)] rounded-lg border-2 border-dashed border-[var(--border-primary)]">
        <p className="text-[var(--text-secondary)] mb-4">No widgets yet</p>
        {effectiveEditable && onAddWidget && (
          <button
            onClick={onAddWidget}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Widget
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Grid Layout */}
      <GridLayout
        className="layout"
        layout={currentLayout}
        cols={gridCols}
        rowHeight={gridRowHeight}
        width={containerWidth}
        isDraggable={effectiveEditable && !isMobile}
        isResizable={effectiveEditable && !isMobile}
        onLayoutChange={handleLayoutChange}
        draggableHandle="[data-testid='drag-handle']"
        compactType="vertical"
        preventCollision={false}
        margin={gridMargin}
        useCSSTransforms={false}
      >
        {widgets.map((widget) => (
          <div key={widget.id} data-grid={layoutItems.find((l) => l.i === String(widget.id))}>
            <WidgetGridItem
              widget={widget}
              effectiveEditable={effectiveEditable}
              onDelete={handleDeleteWidget}
              onToggleFilters={handleToggleFilters}
              borderRadius={isMobile ? 0 : borderRadius}
              isMobile={isMobile}
            />
          </div>
        ))}
      </GridLayout>

      {/* Floating Quick-Add Button - ADR-073 */}
      {shouldShowQuickAdd && spaceId > 0 && (
        <button
          type="button"
          onClick={() => setShowWidgetPicker(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-primary-600 hover:bg-primary-700
                     text-white rounded-full shadow-lg flex items-center justify-center
                     transition-transform hover:scale-105 z-50"
          title="Add Widget"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* Add Widget Modal - shows modules from current space */}
      {spaceId > 0 && (
        <AddWidgetModal
          isOpen={showWidgetPicker}
          onClose={() => setShowWidgetPicker(false)}
          dashboardId={dashboardId}
          spaceId={spaceId}
          onWidgetCreated={() => {
            handleWidgetAdded({} as Widget);
          }}
        />
      )}
    </div>
  );
}

/**
 * Widget grid item with drag handle and delete button
 */
function WidgetGridItem({
  widget,
  effectiveEditable,
  onDelete,
  onToggleFilters,
  borderRadius,
  isMobile = false,
}: {
  widget: Widget;
  effectiveEditable: boolean;
  onDelete: (widgetId: number) => void;
  onToggleFilters: (widgetId: number, showFilters: boolean) => void;
  borderRadius: number;
  isMobile?: boolean;
}) {
  const filtersEnabled = widget.config?.show_filters !== false;
  
  return (
    <div className="h-full relative group/widget">
      {/* Drag Handle, Filters Toggle and Delete - Only show in edit mode.
          Named group (`group/widget`) so the cell-hover that reveals this
          toolbar does NOT leak into widget presets' own unnamed `group-hover`
          affordances (e.g. documents per-doc icon rows). */}
      {effectiveEditable && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 opacity-0 group-hover/widget:opacity-100 transition-opacity">
          <div
            data-testid="drag-handle"
            className="p-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] cursor-grab hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <GripVertical className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFilters(widget.id, !filtersEnabled);
            }}
            className={`p-1.5 rounded-lg border transition-colors ${
              filtersEnabled 
                ? 'bg-primary-500/20 border-primary-500/30 hover:bg-primary-500/30' 
                : 'bg-[var(--bg-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
            }`}
            title={filtersEnabled ? 'Скрыть фильтры' : 'Показать фильтры'}
          >
            <Filter className={`w-4 h-4 ${filtersEnabled ? 'text-primary-400' : 'text-[var(--text-tertiary)]'}`} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(widget.id);
            }}
            className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>
        </div>
      )}
      
      <DashboardWidgetCard widgetId={widget.id} borderRadius={borderRadius} isMobile={isMobile} />
    </div>
  );
}
