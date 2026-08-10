import { useState, useCallback, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import {
  format, addDays, addHours, addMinutes, addWeeks, addMonths as addMonthsFn,
  startOfMonth, startOfWeek, startOfDay, startOfHour, parseISO, differenceInDays
} from 'date-fns';
import { ru } from 'date-fns/locale';
import type { TimelineItem, TimeScale, DragState, StepSize } from './types';

interface UseTimelineHandlersParams {
  timeScale: TimeScale;
  viewStartDate: Date;
  setViewStartDate: React.Dispatch<React.SetStateAction<Date>>;
  totalUnits: number;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  startDateColumn: string;
  endDateColumn: string | undefined;
  dependencyColumn: string | undefined;
  displayItems: TimelineItem[];
  onEventUpdate?: (eventId: string, field: string, value: unknown) => void;
  edgesMode: boolean;
  getPositionForDate: (date: Date) => number;
  currentTime: Date;
}

export function useTimelineHandlers({
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
}: UseTimelineHandlersParams) {
  // Drag state
  const [dragState, setDragState] = useState<DragState>({
    type: null, item: null, startX: 0, originalStart: new Date(), originalEnd: new Date()
  });

  // Edge connection state
  const [connectingFrom, setConnectingFrom] = useState<{ itemId: string; side: 'left' | 'right' } | null>(null);
  const [hoveredDependency, setHoveredDependency] = useState<string | null>(null);

  // Navigation
  const navigate = useCallback((direction: number) => {
    setViewStartDate(d => {
      switch (timeScale) {
        case 'minute': return addMinutes(d, 60 * direction);
        case 'hour': return addHours(d, 24 * direction);
        case 'day': return addMonthsFn(d, direction);
        case 'week': return addWeeks(d, 8 * direction);
        case 'month': return addMonthsFn(d, 12 * direction);
      }
    });
  }, [timeScale, setViewStartDate]);

  const goToToday = useCallback(() => {
    switch (timeScale) {
      case 'minute': setViewStartDate(startOfHour(new Date())); break;
      case 'hour': setViewStartDate(startOfDay(new Date())); break;
      case 'day': setViewStartDate(startOfMonth(new Date())); break;
      case 'week': setViewStartDate(startOfWeek(new Date(), { locale: ru })); break;
      case 'month': setViewStartDate(startOfMonth(addMonthsFn(new Date(), -6))); break;
    }
  }, [timeScale, setViewStartDate]);

  const goToDate = useCallback((goToDateValue: string) => {
    try {
      const date = parseISO(goToDateValue);
      switch (timeScale) {
        case 'minute': setViewStartDate(startOfHour(date)); break;
        case 'hour': setViewStartDate(startOfDay(date)); break;
        case 'day': setViewStartDate(startOfMonth(date)); break;
        case 'week': setViewStartDate(startOfWeek(date, { locale: ru })); break;
        case 'month': setViewStartDate(startOfMonth(addMonthsFn(date, -6))); break;
      }
    } catch { /* ignore */ }
  }, [timeScale, setViewStartDate]);

  const applyDateRange = useCallback((rangeStartDate: string, rangeEndDate: string, setTimeScale: (s: TimeScale) => void) => {
    try {
      const start = parseISO(rangeStartDate);
      const end = parseISO(rangeEndDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const diffDays = differenceInDays(end, start);
        if (diffDays <= 7) {
          setTimeScale('day');
        } else if (diffDays <= 31) {
          setTimeScale('day');
        } else if (diffDays <= 90) {
          setTimeScale('week');
        } else {
          setTimeScale('month');
        }
        setViewStartDate(start);
      }
    } catch { /* ignore */ }
  }, [setViewStartDate]);

  const stepNavigate = useCallback((direction: number, stepSize: StepSize) => {
    setViewStartDate(prev => {
      if (stepSize === 'division') {
        switch (timeScale) {
          case 'minute': return addMinutes(prev, direction);
          case 'hour': return addHours(prev, direction);
          case 'day': return prev.getDate() === 1 ? startOfMonth(addMonthsFn(prev, direction)) : addDays(prev, direction);
          case 'week': return addWeeks(prev, direction);
          case 'month': return addMonthsFn(prev, direction);
          default: return prev;
        }
      }
      switch (stepSize) {
        case 'day': return addDays(prev, direction);
        case 'week': return addWeeks(prev, direction);
        case 'month': return addMonthsFn(prev, direction);
        case 'quarter': return addMonthsFn(prev, 3 * direction);
        case 'year': return addMonthsFn(prev, 12 * direction);
        default: return prev;
      }
    });
  }, [timeScale, setViewStartDate]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent, item: TimelineItem, type: 'move' | 'resize-start' | 'resize-end') => {
    if (!onEventUpdate) return;
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      type,
      item,
      startX: e.clientX,
      originalStart: item.startDate,
      originalEnd: item.endDate
    });
  }, [onEventUpdate]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.type || !dragState.item || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const deltaX = e.clientX - dragState.startX;
    const percentDelta = (deltaX / rect.width) * 100;

    let daysDelta: number;
    switch (timeScale) {
      case 'minute': daysDelta = (percentDelta / 100) * totalUnits / 60 / 24; break;
      case 'hour': daysDelta = (percentDelta / 100) * totalUnits / 24; break;
      case 'day': daysDelta = (percentDelta / 100) * totalUnits; break;
      case 'week': daysDelta = (percentDelta / 100) * totalUnits * 7; break;
      case 'month': daysDelta = (percentDelta / 100) * totalUnits * 30; break;
    }

    const item = dragState.item;

    if (dragState.type === 'move') {
      const newStart = addDays(dragState.originalStart, Math.round(daysDelta));
      const newEnd = addDays(dragState.originalEnd, Math.round(daysDelta));
      item.startDate = newStart;
      item.endDate = newEnd;
    } else if (dragState.type === 'resize-start') {
      const newStart = addDays(dragState.originalStart, Math.round(daysDelta));
      if (newStart < item.endDate) {
        item.startDate = newStart;
      }
    } else if (dragState.type === 'resize-end') {
      const newEnd = addDays(dragState.originalEnd, Math.round(daysDelta));
      if (newEnd > item.startDate) {
        item.endDate = newEnd;
      }
    }
  }, [dragState, timeScale, totalUnits, timelineRef]);

  const handleMouseUp = useCallback(() => {
    if (dragState.type && dragState.item && onEventUpdate) {
      const item = dragState.item;
      if (dragState.type === 'move' || dragState.type === 'resize-start') {
        onEventUpdate(item.id, startDateColumn, format(item.startDate, 'yyyy-MM-dd'));
      }
      if (dragState.type === 'move' || dragState.type === 'resize-end') {
        if (endDateColumn) {
          onEventUpdate(item.id, endDateColumn, format(item.endDate, 'yyyy-MM-dd'));
        }
      }
    }
    setDragState({ type: null, item: null, startX: 0, originalStart: new Date(), originalEnd: new Date() });
  }, [dragState, onEventUpdate, startDateColumn, endDateColumn]);

  // Handle edge connection click
  const handleEdgeClick = useCallback((itemId: string, side: 'left' | 'right') => {
    if (!edgesMode || !onEventUpdate || !dependencyColumn) {
      logger.debug('[handleEdgeClick] Blocked:', { edgesMode, hasOnEventUpdate: !!onEventUpdate, dependencyColumn });
      return;
    }

    logger.debug('[handleEdgeClick] Click:', { itemId, side, connectingFrom });

    if (!connectingFrom) {
      setConnectingFrom({ itemId, side });
      logger.debug('[handleEdgeClick] Started connection from:', itemId, side);
    } else {
      if (connectingFrom.itemId === itemId) {
        setConnectingFrom(null);
        logger.debug('[handleEdgeClick] Cancelled - same item');
        return;
      }

      let sourceId: string;
      let targetId: string;

      if (connectingFrom.side === 'right') {
        sourceId = connectingFrom.itemId;
        targetId = itemId;
      } else {
        sourceId = itemId;
        targetId = connectingFrom.itemId;
      }

      logger.debug('[handleEdgeClick] Connecting:', { sourceId, targetId });

      const targetItem = displayItems.find(i => i.id === targetId);
      if (targetItem) {
        const rawDeps = targetItem.row.data?.[dependencyColumn] || '';
        const currentDeps = rawDeps ? String(rawDeps).split(',').map((s: string) => s.trim()).filter(Boolean) : [];

        logger.debug('[handleEdgeClick] Current deps:', currentDeps);

        if (!currentDeps.includes(sourceId)) {
          const newDeps = [...currentDeps, sourceId].join(',');
          logger.debug('[handleEdgeClick] New deps:', newDeps);
          onEventUpdate(targetId, dependencyColumn, newDeps);
        } else {
          logger.debug('[handleEdgeClick] Already connected');
        }
      } else {
        logger.debug('[handleEdgeClick] Target item not found');
      }

      setConnectingFrom(null);
    }
  }, [edgesMode, connectingFrom, onEventUpdate, dependencyColumn, displayItems]);

  // Handle removing a dependency tag
  const handleRemoveDependency = useCallback((itemId: string, tagToRemove: string) => {
    if (!onEventUpdate || !dependencyColumn) return;

    const item = displayItems.find(i => i.id === itemId);
    if (!item) return;

    const currentDeps = item.dependencies || [];
    const newDeps = currentDeps.filter(tag => tag !== tagToRemove);

    onEventUpdate(itemId, dependencyColumn, newDeps.length > 0 ? newDeps : null);
    setHoveredDependency(null);
  }, [onEventUpdate, dependencyColumn, displayItems]);

  // Cancel connection on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && connectingFrom) {
        setConnectingFrom(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [connectingFrom]);

  // Drag event listeners
  useEffect(() => {
    if (dragState.type) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragState.type, handleMouseMove, handleMouseUp]);

  // NOW line position
  const nowLinePosition = useMemo(() => {
    const pos = getPositionForDate(currentTime);
    if (pos < 0 || pos > 100) return null;
    return pos;
  }, [currentTime, getPositionForDate]);

  // Print handler
  const handlePrint = useCallback((
    widget: { title?: string },
    viewStartDate: Date,
    viewEndDate: Date,
    data: unknown[] | undefined,
    displayItems: TimelineItem[],
    groupByColumn: string | undefined,
    progressColumn: string | undefined,
  ) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${widget.title || 'Timeline'} - Печать</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { font-size: 18pt; margin-bottom: 10px; }
          .meta { font-size: 10pt; color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #f5f5f5; }
          .bar { height: 20px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>${widget.title || 'Timeline'}</h1>
        <div class="meta">
          Период: ${format(viewStartDate, 'dd.MM.yyyy')} — ${format(viewEndDate, 'dd.MM.yyyy')}<br>
          Всего задач: ${data?.length || 0}
        </div>
        <table>
          <thead>
            <tr>
              <th>Задача</th>
              <th>Начало</th>
              <th>Окончание</th>
              <th>Длительность</th>
              ${groupByColumn ? '<th>Группа</th>' : ''}
              ${progressColumn ? '<th>Прогресс</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${displayItems.map(item => `
              <tr>
                <td>${item.title}</td>
                <td>${format(item.startDate, 'dd.MM.yyyy')}</td>
                <td>${format(item.endDate, 'dd.MM.yyyy')}</td>
                <td>${differenceInDays(item.endDate, item.startDate) + 1} дн.</td>
                ${groupByColumn ? `<td>${item.group || '-'}</td>` : ''}
                ${progressColumn ? `<td>${item.progress || 0}%</td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }, []);

  return {
    // Drag
    dragState,
    handleMouseDown,
    // Edge connections
    connectingFrom,
    setConnectingFrom,
    hoveredDependency,
    setHoveredDependency,
    handleEdgeClick,
    handleRemoveDependency,
    // Navigation
    navigate,
    goToToday,
    goToDate,
    applyDateRange,
    stepNavigate,
    // NOW line
    nowLinePosition,
    // Print
    handlePrint,
  };
}
