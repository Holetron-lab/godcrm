import { useState, useRef, useEffect, useCallback } from 'react';
import { startOfMonth } from 'date-fns';
import { GitBranch, Plus } from 'lucide-react';
import { useTimelineData } from './useTimelineData';
import { useTimelineHandlers } from './useTimelineHandlers';
import { TimelineHeader } from './TimelineHeader';
import { TimelineBody } from './TimelineBody';
import { TimelineFooter } from './TimelineFooter';
import { renderDependencies as renderDependenciesFn } from './renderDependencies';
import type { TimelineWidgetProps, TimeScale, ViewMode } from './types';

/**
 * TimelineWidget - Modern Gantt/Timeline view
 *
 * Features:
 * - Drag & drop to move/resize events
 * - Time scale: hour/day/week/month
 * - Gantt mode with dependencies
 * - Tree structure for tasks
 * - Filters
 * - Print support
 * - Go to date
 */
export function TimelineWidget({
  widget,
  data,
  columnsInfo = [],
  relationData,
  onEventClick,
  onEventUpdate,
  onAddEvent
}: TimelineWidgetProps) {
  // State
  const [viewStartDate, setViewStartDate] = useState(() => startOfMonth(new Date()));
  const [timeScale, setTimeScale] = useState<TimeScale>('day');
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());
  const [edgesMode, setEdgesMode] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  const timelineRef = useRef<HTMLDivElement>(null);

  // Update current time every minute for NOW line
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Data processing
  const {
    startDateColumn,
    endDateColumn,
    groupByColumn,
    colorColumn,
    progressColumn,
    dependencyColumn,
    parentColumn,
    colorOptions,
    getDayInfo,
    timeUnits,
    totalUnits,
    viewEndDate,
    displayItems,
    groupedItemsWithLanes,
    allGroups,
    groupLabels,
    getPositionForDate,
    isCurrentUnit,
  } = useTimelineData({
    widget,
    data,
    columnsInfo,
    timeScale,
    viewStartDate,
    collapsedItems,
    collapsedGroups,
    selectedGroups,
    relationData,
  });

  // Handlers
  const {
    dragState,
    handleMouseDown,
    connectingFrom,
    hoveredDependency,
    setHoveredDependency,
    handleEdgeClick,
    handleRemoveDependency,
    navigate,
    goToToday,
    goToDate,
    applyDateRange,
    stepNavigate,
    nowLinePosition,
    handlePrint,
  } = useTimelineHandlers({
    timeScale,
    viewStartDate,
    setViewStartDate,
    totalUnits,
    timelineRef,
    startDateColumn,
    endDateColumn,
    dependencyColumn,
    displayItems,
    onEventUpdate,
    edgesMode,
    getPositionForDate,
    currentTime,
  });

  // Toggle group collapse
  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  // Render dependency arrows
  const renderDeps = useCallback(() => {
    return renderDependenciesFn({
      viewMode,
      displayItems,
      getPositionForDate,
      groupedItemsWithLanes,
      collapsedGroups,
      groupByColumn,
      hoveredDependency,
      setHoveredDependency,
      handleRemoveDependency,
    });
  }, [viewMode, displayItems, getPositionForDate, groupedItemsWithLanes, collapsedGroups, groupByColumn, hoveredDependency, setHoveredDependency, handleRemoveDependency]);

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)]">
        <GitBranch className="w-12 h-12 mb-2" />
        <p className="text-sm">Нет данных для отображения</p>
        <p className="text-xs mt-1">Добавьте записи с датами</p>
        {onAddEvent && (
          <button
            onClick={() => onAddEvent(new Date())}
            className="mt-4 px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Добавить событие
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      <TimelineHeader
        viewStartDate={viewStartDate}
        timeScale={timeScale}
        setTimeScale={setTimeScale}
        timeUnits={timeUnits}
        totalUnits={totalUnits}
        viewMode={viewMode}
        setViewMode={setViewMode}
        edgesMode={edgesMode}
        setEdgesMode={setEdgesMode}
        allGroups={allGroups}
        groupLabels={groupLabels}
        selectedGroups={selectedGroups}
        setSelectedGroups={setSelectedGroups}
        onNavigate={navigate}
        onGoToToday={goToToday}
        onGoToDate={goToDate}
        onApplyDateRange={applyDateRange}
        onStepNavigate={stepNavigate}
        onPrint={() => handlePrint(widget, viewStartDate, viewEndDate, data, displayItems, groupByColumn, progressColumn)}
        onAddEvent={onAddEvent}
        onEventUpdate={onEventUpdate}
      />

      <TimelineBody
        timeScale={timeScale}
        timeUnits={timeUnits}
        totalUnits={totalUnits}
        groupedItemsWithLanes={groupedItemsWithLanes}
        groupByColumn={groupByColumn}
        groupLabels={groupLabels}
        parentColumn={parentColumn}
        collapsedGroups={collapsedGroups}
        toggleGroup={toggleGroup}
        getPositionForDate={getPositionForDate}
        getDayInfo={getDayInfo}
        isCurrentUnit={isCurrentUnit}
        nowLinePosition={nowLinePosition}
        currentTime={currentTime}
        dragState={dragState}
        edgesMode={edgesMode}
        connectingFrom={connectingFrom}
        onMouseDown={handleMouseDown}
        onEdgeClick={handleEdgeClick}
        onEventClick={onEventClick}
        onEventUpdate={onEventUpdate}
        renderDependencies={renderDeps}
        timelineRef={timelineRef}
      />

      <TimelineFooter
        displayItems={displayItems}
        dataLength={data.length}
        viewMode={viewMode}
        edgesMode={edgesMode}
        connectingFrom={connectingFrom}
        colorColumn={colorColumn}
        colorOptions={colorOptions as { value: string; label: string; color?: string }[]}
        onEventUpdate={onEventUpdate}
      />
    </div>
  );
}
