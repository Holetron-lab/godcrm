import { useCallback } from 'react';
import { format, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronDown, TreeDeciduous } from 'lucide-react';
import type { TimelineItem, TimeScale, DragState, DayInfo, TimelineRowData } from './types';

interface TimelineBodyProps {
  timeScale: TimeScale;
  timeUnits: Date[];
  totalUnits: number;
  groupedItemsWithLanes: Record<string, { items: TimelineItem[]; maxLane: number }>;
  groupByColumn: string | undefined;
  groupLabels?: Record<string, string>;
  parentColumn: string | undefined;
  collapsedGroups: Set<string>;
  toggleGroup: (group: string) => void;
  getPositionForDate: (date: Date) => number;
  getDayInfo: (date: Date) => DayInfo;
  isCurrentUnit: (date: Date) => boolean;
  nowLinePosition: number | null;
  currentTime: Date;
  dragState: DragState;
  edgesMode: boolean;
  connectingFrom: { itemId: string; side: 'left' | 'right' } | null;
  onMouseDown: (e: React.MouseEvent, item: TimelineItem, type: 'move' | 'resize-start' | 'resize-end') => void;
  onEdgeClick: (itemId: string, side: 'left' | 'right') => void;
  onEventClick?: (event: TimelineRowData, initialTab?: 'details' | 'files' | 'comments') => void;
  onEventUpdate?: (eventId: string, field: string, value: unknown) => void;
  renderDependencies: () => JSX.Element | null;
  timelineRef: React.RefObject<HTMLDivElement | null>;
}

export function TimelineBody({
  timeScale,
  timeUnits,
  totalUnits,
  groupedItemsWithLanes,
  groupByColumn,
  groupLabels,
  parentColumn,
  collapsedGroups,
  toggleGroup,
  getPositionForDate,
  getDayInfo,
  isCurrentUnit,
  nowLinePosition,
  currentTime,
  dragState,
  edgesMode,
  connectingFrom,
  onMouseDown,
  onEdgeClick,
  onEventClick,
  onEventUpdate,
  renderDependencies,
  timelineRef,
}: TimelineBodyProps) {
  // Format time unit label
  const formatUnitLabel = (date: Date, idx: number) => {
    switch (timeScale) {
      case 'minute':
        return (
          <div className="text-[9px]">
            {format(date, 'mm')}
          </div>
        );
      case 'hour':
        return (
          <div className="text-[10px]">
            {format(date, 'HH:mm')}
          </div>
        );
      case 'day':
        return (
          <>
            <div className="text-[9px] opacity-70">{format(date, 'EE', { locale: ru })}</div>
            <div>{format(date, 'd')}</div>
          </>
        );
      case 'week':
        return (
          <>
            <div className="text-[9px] opacity-70">Нед. {format(date, 'w')}</div>
            <div className="text-[10px]">{format(date, 'd MMM', { locale: ru })}</div>
          </>
        );
      case 'month':
        return (
          <>
            <div className="text-[10px]">{format(date, 'LLL', { locale: ru })}</div>
            <div className="text-[9px] opacity-70">{format(date, 'yyyy')}</div>
          </>
        );
    }
  };

  return (
    <div className="flex-1 overflow-auto" ref={timelineRef as React.Ref<HTMLDivElement>}>
      <div className="min-w-[900px]">
        {/* Timeline header row */}
        <div className="flex border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] sticky top-0 z-10">
          <div className="w-48 flex-shrink-0 p-2 text-xs font-medium text-[var(--text-tertiary)] border-r border-[var(--border-primary)] sticky left-0 bg-[var(--bg-secondary)] z-20 flex items-center gap-2">
            {parentColumn && <TreeDeciduous className="w-4 h-4" />}
            Событие
          </div>
          <div className="flex flex-1">
            {timeUnits.map((unit, idx) => {
              const isCurrent = isCurrentUnit(unit);
              const dayInfo = getDayInfo(unit);
              const bgColor = dayInfo.bgColor;
              const fontColor = dayInfo.fontColor;
              const isHol = dayInfo.type === 'holiday';
              const isWknd = dayInfo.type === 'weekend';
              return (
                <div
                  key={idx}
                  style={{
                    width: `${100 / totalUnits}%`,
                    backgroundColor: isCurrent ? undefined : (timeScale === 'day' && bgColor ? bgColor : undefined),
                    color: isCurrent ? undefined : (timeScale === 'day' && fontColor ? fontColor : undefined)
                  }}
                  className={`
                    py-1 text-center text-[10px] border-r border-[var(--border-primary)] last:border-r-0
                    ${isCurrent ? 'bg-[var(--color-primary-500)]/20 font-bold text-[var(--color-primary-500)]' : ''}
                    ${!bgColor && isHol && !isCurrent ? 'bg-red-500/30 text-red-600' : !bgColor && isWknd && !isCurrent ? 'bg-[var(--bg-tertiary)]/50 text-[var(--text-tertiary)]' : !bgColor ? 'text-[var(--text-secondary)]' : ''}
                  `}
                >
                  {formatUnitLabel(unit, idx)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline rows */}
        <div className="relative">
          {/* NOW line */}
          {nowLinePosition !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-primary-500 z-30 pointer-events-none"
              style={{
                left: `calc(192px + (100% - 192px) * ${nowLinePosition} / 100)`
              }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-primary-500 text-white text-[9px] px-1 rounded whitespace-nowrap">
                {format(currentTime, 'HH:mm')}
              </div>
            </div>
          )}

          {/* Dependency arrows overlay */}
          {renderDependencies()}

          {Object.entries(groupedItemsWithLanes).map(([groupName, { items: groupItems, maxLane }]) => {
            const isGroupCollapsed = collapsedGroups.has(groupName);
            const LANE_HEIGHT = 33;

            return (
              <div key={groupName}>
                {/* Group header */}
                {groupByColumn && groupName && (
                  <div
                    className="flex border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)] cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors"
                    onClick={() => toggleGroup(groupName)}
                  >
                    <div className="w-48 flex-shrink-0 p-2 text-xs font-semibold text-[var(--text-primary)] sticky left-0 bg-[var(--bg-tertiary)] z-10 flex items-center gap-2">
                      <ChevronDown className={`w-4 h-4 transition-transform ${isGroupCollapsed ? '-rotate-90' : ''}`} />
                      {groupLabels?.[groupName] ?? groupName}
                      <span className="text-[var(--text-tertiary)] font-normal">({groupItems.length})</span>
                    </div>
                    <div className="flex-1" />
                  </div>
                )}

                {/* Compact multi-lane layout */}
                {!isGroupCollapsed && maxLane > 0 && (
                  <div className="flex border-b border-[var(--border-primary)]">
                    {/* Sidebar with expandable item list */}
                    <div className="w-48 flex-shrink-0 border-r border-[var(--border-primary)] sticky left-0 bg-[var(--bg-primary)] z-10 overflow-y-auto"
                      style={{ maxHeight: maxLane * LANE_HEIGHT + 8 }}
                    >
                      <div className="p-1 space-y-0.5">
                        {groupItems.map((item) => (
                          <div
                            key={item.id}
                            className="group/item"
                          >
                            <div
                              className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                              onClick={() => onEventClick?.(item.row, 'details')}
                            >
                              <div
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: item.color }}
                              />
                              <span className="text-[10px] text-[var(--text-primary)] truncate flex-1">
                                {item.title}
                              </span>
                              <span className="text-[8px] text-[var(--text-tertiary)] flex-shrink-0">
                                {format(item.startDate, 'dd.MM')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Timeline area with multiple lanes */}
                    <div
                      className="flex-1 relative"
                      style={{ height: maxLane * LANE_HEIGHT + 8 }}
                    >
                      {/* Grid lines background */}
                      <div className="absolute inset-0 flex">
                        {timeUnits.map((unit, idx) => {
                          const isCurrent = isCurrentUnit(unit);
                          const dayInfo = getDayInfo(unit);
                          const bgColor = dayInfo.bgColor;
                          const isHol = dayInfo.type === 'holiday';
                          const isWknd = dayInfo.type === 'weekend';
                          return (
                            <div
                              key={idx}
                              style={{
                                width: `${100 / totalUnits}%`,
                                backgroundColor: isCurrent ? undefined : (timeScale === 'day' && bgColor ? `${bgColor}60` : undefined)
                              }}
                              className={`
                                border-r border-[var(--border-primary)] last:border-r-0
                                ${isCurrent ? 'bg-[var(--color-primary-500)]/10' : ''}
                                ${!bgColor && isHol && !isCurrent ? 'bg-red-500/20' : !bgColor && isWknd && !isCurrent ? 'bg-[var(--bg-tertiary)]/30' : ''}
                              `}
                            />
                          );
                        })}
                      </div>

                      {/* Render items in their lanes */}
                      {groupItems.map((item) => {
                        const startPos = getPositionForDate(item.startDate);
                        const endPos = getPositionForDate(item.endDate);

                        const visibleStart = Math.max(0, startPos);
                        const visibleEnd = Math.min(100, endPos);
                        const isBarVisible = visibleEnd > 0 && visibleStart < 100;

                        if (!isBarVisible) return null;

                        const left = visibleStart;
                        const width = Math.max(2, visibleEnd - visibleStart);
                        const isPartialStart = startPos < 0;
                        const isPartialEnd = endPos > 100;
                        const lane = item.lane || 0;

                        return (
                          <div
                            key={item.id}
                            className={`
                              absolute rounded h-7
                              transition-shadow hover:shadow-lg hover:z-10
                              ${isPartialStart ? 'rounded-l-none' : ''}
                              ${isPartialEnd ? 'rounded-r-none' : ''}
                              ${dragState.item?.id === item.id ? 'shadow-lg ring-2 ring-[var(--color-primary-500)] z-20' : ''}
                            `}
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              top: lane * LANE_HEIGHT + 2,
                              background: `linear-gradient(135deg, ${item.color}50 0%, ${item.color}30 100%)`,
                              borderLeft: isPartialStart ? 'none' : `3px solid ${item.color}`,
                              borderRight: isPartialEnd ? `2px dashed ${item.color}` : 'none',
                            }}
                            title={`${item.title}${item.description ? '\n' + item.description : ''}\n${format(item.startDate, 'dd.MM.yyyy')} — ${format(item.endDate, 'dd.MM.yyyy')}`}
                          >
                            {/* Connection circle - left */}
                            {edgesMode && !isPartialStart && (
                              <div
                                className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 cursor-pointer hover:scale-125 transition-all z-20 ${
                                  connectingFrom?.itemId === item.id && connectingFrom?.side === 'left'
                                    ? 'bg-primary-500 border-primary-500 scale-125'
                                    : connectingFrom && connectingFrom.itemId !== item.id
                                      ? 'bg-green-500/50 border-green-500 animate-pulse'
                                      : 'bg-[var(--bg-primary)]'
                                }`}
                                style={{ borderColor: connectingFrom ? undefined : item.color }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEdgeClick(item.id, 'left');
                                }}
                              />
                            )}

                            {/* Resize handle - start */}
                            {onEventUpdate && !isPartialStart && !edgesMode && (
                              <div
                                className="absolute left-0 top-0 bottom-0 w-2 cursor-w-resize hover:bg-white/30 rounded-l z-10"
                                onMouseDown={(e) => onMouseDown(e, item, 'resize-start')}
                              />
                            )}

                            {/* Progress bar */}
                            {item.progress !== null && item.progress > 0 && (
                              <div
                                className="absolute inset-y-0 left-0 rounded-l opacity-60"
                                style={{
                                  width: `${item.progress}%`,
                                  backgroundColor: item.color
                                }}
                              />
                            )}

                            {/* Content */}
                            <div
                              className={`absolute inset-0 flex items-center gap-1 px-1.5 overflow-hidden ${!edgesMode ? 'cursor-move' : ''}`}
                              onMouseDown={(e) => !edgesMode && onMouseDown(e, item, 'move')}
                            >
                              <span
                                className="text-[10px] font-medium flex-shrink-0 cursor-pointer hover:underline z-20"
                                style={{ color: item.color }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEventClick?.(item.row, 'details');
                                }}
                              >
                                {item.title}
                              </span>

                              {item.description && (
                                <span
                                  className="text-[9px] opacity-60 truncate flex-1 min-w-0 pointer-events-none"
                                  style={{ color: item.color }}
                                >
                                  — {item.description}
                                </span>
                              )}

                              {item.progress !== null && (
                                <span
                                  className="text-[9px] opacity-70 pointer-events-none flex-shrink-0"
                                  style={{ color: item.color }}
                                >
                                  {item.progress}%
                                </span>
                              )}
                            </div>

                            {/* Resize handle - end */}
                            {onEventUpdate && !isPartialEnd && !edgesMode && (
                              <div
                                className="absolute right-0 top-0 bottom-0 w-2 cursor-e-resize hover:bg-white/30 rounded-r z-10"
                                onMouseDown={(e) => onMouseDown(e, item, 'resize-end')}
                              />
                            )}

                            {/* Connection circle - right */}
                            {edgesMode && !isPartialEnd && (
                              <div
                                className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 cursor-pointer hover:scale-125 transition-all z-20 ${
                                  connectingFrom?.itemId === item.id && connectingFrom?.side === 'right'
                                    ? 'bg-primary-500 border-primary-500 scale-125'
                                    : connectingFrom && connectingFrom.itemId !== item.id
                                      ? 'bg-green-500/50 border-green-500 animate-pulse'
                                      : 'bg-[var(--bg-primary)]'
                                }`}
                                style={{ borderColor: connectingFrom ? undefined : item.color }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEdgeClick(item.id, 'right');
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
