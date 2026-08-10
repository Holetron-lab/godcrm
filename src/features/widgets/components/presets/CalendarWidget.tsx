import { useMemo, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { 
  startOfMonth, endOfMonth, eachDayOfInterval, 
  format, isSameDay, isSameMonth, addMonths, subMonths,
  startOfWeek, endOfWeek, parseISO,
  differenceInDays, addDays
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import type { PresetWidgetProps } from '../../types/widget.types';

// Column info for color mapping
interface ColumnInfo {
  name: string;
  displayName?: string;
  type: string;
  config?: {
    options?: Array<{ value: string; label: string; color?: string }>;
  };
}

// Local types for calendar events and color options
interface CalendarEventData {
  id?: string | number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ColorOption {
  value: string;
  label: string;
  color?: string;
}

interface CalendarWidgetProps extends PresetWidgetProps {
  columnsInfo?: ColumnInfo[];
  onEventClick?: (event: CalendarEventData, initialTab?: 'details' | 'files' | 'comments') => void;
  onEventUpdate?: (eventId: string, field: string, value: unknown) => void;
  onAddEvent?: (date: Date) => void;
}

// Default colors for events without specific color
const DEFAULT_EVENT_COLORS = [
  '#3b82f6', // blue
  '#a855f7', // purple
  '#22c55e', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#ef4444', // red
  '#84cc16', // lime
];

// Get color based on event index (for events without color column)
const getDefaultColor = (index: number) => DEFAULT_EVENT_COLORS[index % DEFAULT_EVENT_COLORS.length];

// Simple hash for consistent colors
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

/**
 * CalendarWidget - displays data as a calendar with drag & drop support
 * 
 * Events are placed on dates based on dateColumn from config.
 * Supports single-day and multi-day events with color coding.
 */
export function CalendarWidget({ 
  widget, 
  data,
  columnsInfo = [],
  onEventClick,
  onEventUpdate,
  onAddEvent
}: CalendarWidgetProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [draggedEvent, setDraggedEvent] = useState<any>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  
  const config = widget.config;
  
  // Auto-detect date column from data if not configured
  const autoDetectDateColumn = useMemo(() => {
    if (!data || data.length === 0) return 'date';
    
    const sampleRow = data[0]?.data || {};
    const keys = Object.keys(sampleRow);
    
    // Priority order for date column detection
    const datePatterns = [
      /^scheduled$/i, /^date$/i, /^due_date$/i, /^start_date$/i,
      /scheduled/i, /дата/i, /date/i, /deadline/i, /due/i
    ];
    
    for (const pattern of datePatterns) {
      const found = keys.find(k => pattern.test(k));
      if (found && sampleRow[found]) {
        // Verify it looks like a date
        const val = sampleRow[found];
        if (typeof val === 'string' && (val.includes('-') || val.includes('/'))) {
          return found;
        }
      }
    }
    
    // Fallback: find any column with date-like value
    for (const key of keys) {
      const val = sampleRow[key];
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
        return key;
      }
    }
    
    return 'date';
  }, [data]);

  // Auto-detect title column
  const autoDetectTitleColumn = useMemo(() => {
    if (!data || data.length === 0) return 'title';
    
    const sampleRow = data[0]?.data || {};
    const keys = Object.keys(sampleRow);
    
    const titlePatterns = [
      /^task$/i, /^title$/i, /^name$/i, /^название$/i, /^задача$/i,
      /task/i, /title/i, /name/i
    ];
    
    for (const pattern of titlePatterns) {
      const found = keys.find(k => pattern.test(k));
      if (found) return found;
    }
    
    // Return first text column
    return keys[0] || 'title';
  }, [data]);

  // Get column names from config (with auto-detection fallback)
  const configDateColumn = config.calendar?.dateColumn || config.x_column;
  
  // Smart date column resolution: check if configured column exists in data
  const dateColumn = useMemo(() => {
    if (!data || data.length === 0) return configDateColumn || autoDetectDateColumn;
    
    const sampleRow = data[0]?.data || {};
    const keys = Object.keys(sampleRow);
    
    // If configured column exists in data, use it
    if (configDateColumn && keys.includes(configDateColumn)) {
      return configDateColumn;
    }
    
    // If configured column doesn't exist, try to find by column name in columnsInfo
    if (configDateColumn && columnsInfo.length > 0) {
      const colInfo = columnsInfo.find(c => 
        c.name === configDateColumn || 
        c.displayName?.toLowerCase() === configDateColumn.toLowerCase()
      );
      if (colInfo && keys.includes(colInfo.name)) {
        return colInfo.name;
      }
    }
    
    // Fallback: find any column with date-like value (ISO date format)
    for (const key of keys) {
      const val = sampleRow[key];
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
        logger.debug('[CalendarWidget] Auto-detected date column by value:', key);
        return key;
      }
    }
    
    return autoDetectDateColumn;
  }, [data, configDateColumn, autoDetectDateColumn, columnsInfo]);
  
  const endDateColumn = config.calendar?.endDateColumn;
  const titleColumn = config.calendar?.titleColumn || config.card_title_column || autoDetectTitleColumn;
  const descriptionColumn = config.calendar?.descriptionColumn || config.card_subtitle_column;
  const colorColumn = config.calendar?.colorColumn;
  
  // Debug: log available columns vs configured column
  if (data && data.length > 0) {
    const sampleKeys = Object.keys(data[0]?.data || {});
    logger.debug('[CalendarWidget] Available columns:', sampleKeys.join(', '));
    logger.debug('[CalendarWidget] Config dateColumn:', configDateColumn, '| Resolved to:', dateColumn);
    logger.debug('[CalendarWidget] Sample row date value:', data[0]?.data?.[dateColumn]);
  }
  
  // Get color column info
  const colorColInfo = colorColumn ? columnsInfo.find(c => c.name === colorColumn) : null;
  const colorOptions = colorColInfo?.config?.options || [];

  // Get event color
  const getEventColor = (event: CalendarEventData, index: number): string => {
    if (!colorColumn) return getDefaultColor(index);
    
    const colorValue = event.data?.[colorColumn];
    if (!colorValue) return getDefaultColor(index);
    
    // Find color in options
    const option = colorOptions.find((o: ColorOption) => o.value === colorValue);
    if (option?.color) return option.color;
    
    // Use hash-based color for unknown values
    return getDefaultColor(hashString(String(colorValue)));
  };

  // Group events by date
  const eventsByDate = useMemo(() => {
    if (!data) return new Map<string, any[]>();
    
    logger.debug('[CalendarWidget] Processing data:', data.length, 'items, dateColumn:', dateColumn);
    
    const map = new Map<string, any[]>();
    
    data.forEach((row, rowIndex) => {
      const dateValue = row.data?.[dateColumn];
      if (!dateValue) {
        // Try to find any date column
        const anyDateKey = Object.keys(row.data || {}).find(k => 
          k.toLowerCase().includes('date') || k.toLowerCase().includes('дата')
        );
        if (anyDateKey && rowIndex === 0) {
          logger.debug('[CalendarWidget] dateColumn not found, available date-like columns:', anyDateKey);
        }
        return;
      }
      
      try {
        const startDate = typeof dateValue === 'string' ? parseISO(dateValue) : new Date(dateValue);
        if (isNaN(startDate.getTime())) return;
        
        // Handle multi-day events
        const endValue = endDateColumn ? row.data?.[endDateColumn] : null;
        const endDate = endValue ? (typeof endValue === 'string' ? parseISO(endValue) : new Date(endValue)) : startDate;
        
        // Add event to all days it spans
        const daysDiff = differenceInDays(endDate, startDate);
        for (let i = 0; i <= Math.min(daysDiff, 30); i++) { // Limit to 30 days max
          const day = addDays(startDate, i);
          const key = format(day, 'yyyy-MM-dd');
          
          if (!map.has(key)) {
            map.set(key, []);
          }
          map.get(key)!.push({
            ...row,
            _isFirstDay: i === 0,
            _isLastDay: i === daysDiff,
            _isMultiDay: daysDiff > 0,
            _dayIndex: i,
            _totalDays: daysDiff + 1,
            _rowIndex: rowIndex
          });
        }
      } catch {
        // Skip invalid dates
      }
    });
    
    return map;
  }, [data, dateColumn, endDateColumn]);

  // Calculate days to display (including padding days from prev/next month)
  const calendarDays = useMemo(() => {
    try {
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);
      const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday
      const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
      
      const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
      return days.length > 0 ? days : [];
    } catch (e) {
      logger.error('[CalendarWidget] Error calculating days:', e);
      return [];
    }
  }, [currentMonth]);

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, event: CalendarEventData) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedEvent(event);
  };

  // Handle drag over day
  const handleDragOver = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDay(dayKey);
  };

  // Handle drag leave
  const handleDragLeave = () => {
    setDragOverDay(null);
  };

  // Handle drop
  const handleDrop = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    setDragOverDay(null);
    
    if (draggedEvent && onEventUpdate) {
      // Update event date to the dropped day
      const newDate = format(parseISO(dayKey), "yyyy-MM-dd'T'HH:mm:ss");
      onEventUpdate(draggedEvent.id, dateColumn, newDate);
    }
    
    setDraggedEvent(null);
  };

  // Handle day click to add event
  const handleDayClick = (day: Date, e: React.MouseEvent) => {
    // Only trigger if clicking empty space (not an event)
    if ((e.target as HTMLElement).closest('.calendar-event')) return;
    onAddEvent?.(day);
  };

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)]">
        <Calendar className="w-12 h-12 mb-2" />
        <p className="text-sm">Нет событий для отображения</p>
        <p className="text-xs mt-1">Добавьте данные в таблицу</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header with navigation */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-primary)]">
        <button 
          onClick={() => setCurrentMonth(m => subMonths(m, 1))}
          className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-[var(--text-secondary)]" />
        </button>
        
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] capitalize">
            {format(currentMonth, 'LLLL yyyy', { locale: ru })}
          </h2>
          <button
            onClick={() => setCurrentMonth(new Date())}
            className="px-2 py-1 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors text-[var(--text-secondary)]"
          >
            Сегодня
          </button>
        </div>
        
        <button 
          onClick={() => setCurrentMonth(m => addMonths(m, 1))}
          className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-[var(--text-secondary)]" />
        </button>
      </div>
      
      {/* Calendar Grid - flex container to fill height */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-[var(--border-primary)] flex-shrink-0 bg-[var(--bg-primary)]">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, idx) => (
            <div 
              key={day}
              className={`p-2 text-center text-xs font-medium bg-[var(--bg-secondary)] border-r border-[var(--border-primary)] last:border-r-0 ${
                idx >= 5 ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              {day}
            </div>
          ))}
        </div>
        
        {/* Days grid - auto rows to fill height evenly */}
        <div 
          className="grid grid-cols-7 flex-1 overflow-auto"
          style={{ gridTemplateRows: `repeat(${Math.ceil(calendarDays.length / 7)}, 1fr)` }}
        >
          {calendarDays.map((day, dayIdx) => {
            const key = format(day, 'yyyy-MM-dd');
            const events = eventsByDate.get(key) || [];
            const isToday = isSameDay(day, new Date());
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isWeekend = dayIdx % 7 >= 5;
            const isExpanded = expandedDay === key;
            const isDragOver = dragOverDay === key;
            
            // Show max events (3 collapsed, all if expanded)
            const maxVisible = isExpanded ? events.length : 3;
            const visibleEvents = events.slice(0, maxVisible);
            const hiddenCount = events.length - maxVisible;
            
            return (
              <div
                key={key}
                onClick={(e) => handleDayClick(day, e)}
                onDragOver={(e) => handleDragOver(e, key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, key)}
                className={`
                  min-h-[60px] sm:min-h-[80px] p-1 sm:p-1.5 border-b border-r border-[var(--border-primary)] relative group flex flex-col
                  transition-colors cursor-pointer overflow-hidden
                  ${!isCurrentMonth ? 'bg-[var(--bg-secondary)]/50' : isWeekend ? 'bg-[var(--bg-secondary)]/30' : 'bg-[var(--bg-primary)]'}
                  ${isDragOver ? 'bg-[var(--color-primary-500)]/10 ring-2 ring-[var(--color-primary-500)]/30 ring-inset' : ''}
                  hover:bg-[var(--bg-secondary)]/50
                `}
              >
                {/* Day number - compact */}
                <div className="flex items-center justify-between mb-0.5 flex-shrink-0">
                  <div className={`
                    text-[10px] sm:text-xs font-medium w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full transition-all
                    ${isToday 
                      ? 'bg-[var(--color-primary-500)] text-white shadow-sm' 
                      : !isCurrentMonth 
                        ? 'text-[var(--text-tertiary)]' 
                        : 'text-[var(--text-primary)]'
                    }
                  `}>
                    {format(day, 'd')}
                  </div>
                  
                  {/* Add event button (on hover) - hidden on mobile */}
                  {onAddEvent && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddEvent(day);
                      }}
                      className="hidden sm:block opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--bg-tertiary)] rounded transition-all"
                      title="Добавить событие"
                    >
                      <Plus className="w-3 h-3 text-[var(--text-tertiary)]" />
                    </button>
                  )}
                </div>
                
                {/* Events - smart display: 2 lines if few events, 1 line if many */}
                <div className="space-y-px overflow-hidden flex-1">
                  {visibleEvents.map((event, idx) => {
                    const eventColor = getEventColor(event, event._rowIndex || idx);
                    const isMultiDay = event._isMultiDay;
                    const isFirstDay = event._isFirstDay;
                    const isLastDay = event._isLastDay;
                    // If more than 2 events, use single line to fit more
                    const useCompactMode = events.length > 2;
                    
                    return (
                      <div
                        key={`${event.id || idx}-${event._dayIndex || 0}`}
                        draggable={!!onEventUpdate}
                        onDragStart={(e) => handleDragStart(e, event)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick?.(event, 'details');
                        }}
                        className={`
                          calendar-event text-[8px] sm:text-[9px] px-0.5 sm:px-1 py-px cursor-pointer leading-[1.15]
                          transition-all hover:opacity-90 hover:shadow-sm
                          ${isMultiDay 
                            ? `${isFirstDay ? 'rounded-l' : 'border-l-0 -ml-0.5'} ${isLastDay ? 'rounded-r' : 'border-r-0 -mr-0.5'}`
                            : 'rounded'
                          }
                        `}
                        style={{
                          background: `linear-gradient(135deg, ${eventColor}25 0%, ${eventColor}15 100%)`,
                          borderLeft: isFirstDay || !isMultiDay ? `2px solid ${eventColor}` : 'none',
                          color: eventColor,
                        }}
                        title={`${event.data?.[titleColumn] || 'Untitled'}${descriptionColumn && event.data?.[descriptionColumn] ? `\n${event.data[descriptionColumn]}` : ''}`}
                      >
                        <span className={`${useCompactMode ? 'line-clamp-1' : 'line-clamp-2'} font-medium break-words`}>
                          {isFirstDay || !isMultiDay 
                            ? (event.data?.[titleColumn] || 'Untitled')
                            : '→'
                          }
                        </span>
                      </div>
                    );
                  })}
                  
                  {/* Show more/less toggle */}
                  {events.length > 3 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedDay(isExpanded ? null : key);
                      }}
                      className="text-[8px] sm:text-[10px] text-[var(--color-primary-500)] hover:underline px-0.5 flex items-center gap-0.5"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                          <span className="hidden sm:inline">Свернуть</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" />
                          +{hiddenCount} ещё
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Footer with stats */}
      <div className="px-3 py-2 border-t border-[var(--border-primary)] flex items-center justify-between text-xs text-[var(--text-tertiary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {data.length} событий
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
        {onEventUpdate && (
          <span className="text-[var(--text-tertiary)]">
            Перетаскивайте события для изменения даты
          </span>
        )}
      </div>
    </div>
  );
}
