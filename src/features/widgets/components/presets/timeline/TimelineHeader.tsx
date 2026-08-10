import { useState } from 'react';
import {
  format, addDays, addWeeks, addMonths as addMonthsFn, endOfMonth,
  startOfMonth, startOfWeek, endOfWeek, parseISO, isSameDay
} from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, GitBranch, Calendar, Plus, ZoomIn,
  Filter, Printer, ChevronDown, CalendarDays,
  Layers, Target, Workflow
} from 'lucide-react';
import { TIME_SCALE_OPTIONS } from './timeline-constants';
import type { TimeScale, StepSize, TimelineItem, TimelineRowData } from './types';

interface TimelineHeaderProps {
  viewStartDate: Date;
  timeScale: TimeScale;
  setTimeScale: (scale: TimeScale) => void;
  timeUnits: Date[];
  totalUnits: number;
  viewMode: 'timeline' | 'gantt';
  setViewMode: (mode: 'timeline' | 'gantt') => void;
  edgesMode: boolean;
  setEdgesMode: (mode: boolean) => void;
  allGroups: string[];
  groupLabels?: Record<string, string>;
  selectedGroups: Set<string>;
  setSelectedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  onNavigate: (direction: number) => void;
  onGoToToday: () => void;
  onGoToDate: (dateValue: string) => void;
  onApplyDateRange: (rangeStart: string, rangeEnd: string, setTimeScale: (s: TimeScale) => void) => void;
  onStepNavigate: (direction: number, stepSize: StepSize) => void;
  onPrint: () => void;
  onAddEvent?: (date: Date) => void;
  onEventUpdate?: (eventId: string, field: string, value: unknown) => void;
}

export function TimelineHeader({
  viewStartDate,
  timeScale,
  setTimeScale,
  timeUnits,
  totalUnits,
  viewMode,
  setViewMode,
  edgesMode,
  setEdgesMode,
  allGroups,
  groupLabels,
  selectedGroups,
  setSelectedGroups,
  onNavigate,
  onGoToToday,
  onGoToDate,
  onApplyDateRange,
  onStepNavigate,
  onPrint,
  onAddEvent,
  onEventUpdate,
}: TimelineHeaderProps) {
  const [showScaleMenu, setShowScaleMenu] = useState(false);
  const [showGoToDate, setShowGoToDate] = useState(false);
  const [goToDateValue, setGoToDateValue] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showFilters, setShowFilters] = useState(false);
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [stepSize, setStepSize] = useState<StepSize>('division');

  // Format header label based on scale
  const formatHeaderLabel = () => {
    const actualEndDate = timeUnits[timeUnits.length - 1] || viewStartDate;

    switch (timeScale) {
      case 'minute':
        return format(viewStartDate, 'd MMMM yyyy HH:mm', { locale: ru });
      case 'hour':
        return format(viewStartDate, 'd MMMM yyyy', { locale: ru });
      case 'day': {
        const isMonthStart = viewStartDate.getDate() === 1;
        const monthEnd = endOfMonth(viewStartDate);
        const isFullMonth = isMonthStart && isSameDay(actualEndDate, monthEnd);

        if (isFullMonth) {
          return format(viewStartDate, 'LLLL yyyy', { locale: ru });
        } else {
          const startStr = format(viewStartDate, 'd MMM', { locale: ru });
          const endStr = format(actualEndDate, 'd MMM yyyy', { locale: ru });
          return `${startStr} — ${endStr}`;
        }
      }
      case 'week':
        return `${format(viewStartDate, 'd MMM', { locale: ru })} — ${format(addWeeks(viewStartDate, 8), 'd MMM yyyy', { locale: ru })}`;
      case 'month':
        return `${format(viewStartDate, 'MMM yyyy', { locale: ru })} — ${format(addMonthsFn(viewStartDate, 11), 'MMM yyyy', { locale: ru })}`;
    }
  };

  return (
    <div className="flex items-center justify-between p-3 border-b border-[var(--border-primary)] flex-wrap gap-2">
      {/* Navigation */}
      <div className="flex items-center gap-2">
        <button onClick={() => onNavigate(-1)} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--text-secondary)]" />
        </button>

        <div className="relative">
          <button
            onClick={() => {
              setRangeStartDate(format(viewStartDate, 'yyyy-MM-dd'));
              const endDate = timeUnits[timeUnits.length - 1] || viewStartDate;
              setRangeEndDate(format(endDate, 'yyyy-MM-dd'));
              setShowDateRangePicker(true);
            }}
            className="text-lg font-semibold text-[var(--text-primary)] capitalize min-w-[200px] text-center hover:bg-[var(--bg-secondary)] px-3 py-1 rounded-lg transition-colors cursor-pointer"
            title="Нажмите для выбора диапазона дат"
          >
            {formatHeaderLabel()}
          </button>

          {/* Date Range Picker Dropdown */}
          {showDateRangePicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDateRangePicker(false)} />
              <div
                className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 bg-[var(--bg-primary)] rounded-lg shadow-xl p-4 min-w-[300px] border border-[var(--border-primary)]"
                onClick={e => e.stopPropagation()}
              >
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-[var(--text-secondary)] mb-1">С</label>
                      <input
                        type="date"
                        value={rangeStartDate}
                        onChange={e => setRangeStartDate(e.target.value)}
                        className="w-full px-2 py-1.5 border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-[var(--text-secondary)] mb-1">По</label>
                      <input
                        type="date"
                        value={rangeEndDate}
                        onChange={e => setRangeEndDate(e.target.value)}
                        className="w-full px-2 py-1.5 border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm"
                      />
                    </div>
                  </div>

                  {/* Quick presets */}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => {
                        const now = new Date();
                        setRangeStartDate(format(startOfWeek(now, { locale: ru }), 'yyyy-MM-dd'));
                        setRangeEndDate(format(endOfWeek(now, { locale: ru }), 'yyyy-MM-dd'));
                      }}
                      className="px-2 py-1 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                    >
                      Неделя
                    </button>
                    <button
                      onClick={() => {
                        const now = new Date();
                        setRangeStartDate(format(now, 'yyyy-MM-dd'));
                        setRangeEndDate(format(addDays(now, 14), 'yyyy-MM-dd'));
                      }}
                      className="px-2 py-1 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                    >
                      2 недели
                    </button>
                    <button
                      onClick={() => {
                        const now = new Date();
                        setRangeStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
                        setRangeEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
                      }}
                      className="px-2 py-1 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                    >
                      Месяц
                    </button>
                    <button
                      onClick={() => {
                        const now = new Date();
                        setRangeStartDate(format(now, 'yyyy-MM-dd'));
                        setRangeEndDate(format(addDays(now, 90), 'yyyy-MM-dd'));
                      }}
                      className="px-2 py-1 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                    >
                      Квартал
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-[var(--border-primary)]">
                  <button
                    onClick={() => setShowDateRangePicker(false)}
                    className="px-3 py-1.5 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={() => {
                      onApplyDateRange(rangeStartDate, rangeEndDate, setTimeScale);
                      setShowDateRangePicker(false);
                    }}
                    className="px-3 py-1.5 text-xs bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] rounded text-white"
                  >
                    Применить
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <button onClick={() => onNavigate(1)} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors">
          <ChevronRight className="w-5 h-5 text-[var(--text-secondary)]" />
        </button>

        <button
          onClick={onGoToToday}
          className="px-3 py-1.5 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors text-[var(--text-secondary)]"
        >
          Сегодня
        </button>

        {/* Step navigation */}
        <div className="flex items-center bg-[var(--bg-secondary)] rounded-lg relative">
          <button
            onClick={() => onStepNavigate(-1, stepSize)}
            className="px-2 py-1.5 hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-secondary)] border-r border-[var(--border-primary)]"
            title="Сдвинуть назад"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowStepPicker(!showStepPicker)}
            className="px-2 py-1.5 text-[10px] text-[var(--text-tertiary)] min-w-[40px] text-center hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-0.5"
            title="Выбрать шаг навигации"
          >
            {stepSize === 'division'
              ? (timeScale === 'minute' ? '±1м' : timeScale === 'hour' ? '±1ч' : timeScale === 'day' ? (viewStartDate.getDate() === 1 ? '±1мес' : '±1д') : timeScale === 'week' ? '±1н' : '±1мес')
              : stepSize === 'day' ? '±1д' : stepSize === 'week' ? '±1н' : stepSize === 'month' ? '±1мес' : stepSize === 'quarter' ? '±1кв' : '±1г'
            }
            <ChevronDown className="w-2.5 h-2.5" />
          </button>
          {showStepPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowStepPicker(false)} />
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-[var(--bg-primary)] rounded-lg shadow-xl border border-[var(--border-primary)] py-1 min-w-[100px]">
                {(['division', 'day', 'week', 'month', 'quarter', 'year'] as StepSize[]).map(s => {
                  const labels: Record<StepSize, string> = {
                    division: 'Деление',
                    day: 'День',
                    week: 'Неделя',
                    month: 'Месяц',
                    quarter: 'Квартал',
                    year: 'Год',
                  };
                  return (
                    <button
                      key={s}
                      onClick={() => { setStepSize(s); setShowStepPicker(false); }}
                      className={`w-full px-3 py-1.5 text-xs text-left hover:bg-[var(--bg-secondary)] ${stepSize === s ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-secondary)]'}`}
                    >
                      {labels[s]}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <button
            onClick={() => onStepNavigate(1, stepSize)}
            className="px-2 py-1.5 hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-secondary)] border-l border-[var(--border-primary)]"
            title="Сдвинуть вперёд"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* View mode toggle */}
        <div className="flex bg-[var(--bg-secondary)] rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('timeline')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1 ${
              viewMode === 'timeline' ? 'bg-[var(--color-primary-500)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Timeline
          </button>
          <button
            onClick={() => setViewMode('gantt')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1 ${
              viewMode === 'gantt' ? 'bg-[var(--color-primary-500)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Gantt
          </button>
        </div>

        {/* Time scale selector */}
        <div className="relative">
          <button
            onClick={() => setShowScaleMenu(!showScaleMenu)}
            className="px-3 py-1.5 text-xs bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors flex items-center gap-2"
          >
            <ZoomIn className="w-4 h-4" />
            {TIME_SCALE_OPTIONS.find(o => o.value === timeScale)?.label}
            <ChevronDown className="w-3 h-3" />
          </button>

          {showScaleMenu && (
            <div className="absolute top-full right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
              {TIME_SCALE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => { setTimeScale(option.value); setShowScaleMenu(false); }}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-[var(--bg-tertiary)] ${
                    timeScale === option.value ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-primary)]'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Go to date */}
        <div className="relative">
          <button
            onClick={() => setShowGoToDate(!showGoToDate)}
            className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
            title="Перейти к дате"
          >
            <Target className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>

          {showGoToDate && (
            <div className="absolute top-full right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-3 z-50">
              <input
                type="date"
                value={goToDateValue}
                onChange={e => setGoToDateValue(e.target.value)}
                className="px-3 py-2 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm"
              />
              <button
                onClick={() => {
                  onGoToDate(goToDateValue);
                  setShowGoToDate(false);
                }}
                className="mt-2 w-full px-3 py-1.5 bg-[var(--color-primary-500)] text-white rounded-lg text-sm hover:bg-[var(--color-primary-600)]"
              >
                Перейти
              </button>
            </div>
          )}
        </div>

        {/* Filters */}
        {allGroups.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg transition-colors ${
                selectedGroups.size > 0 ? 'bg-[var(--color-primary-500)] text-white' : 'hover:bg-[var(--bg-secondary)]'
              }`}
              title="Фильтры"
            >
              <Filter className="w-4 h-4" />
            </button>

            {showFilters && (
              <div className="absolute top-full right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-2 z-50 min-w-[180px]">
                <div className="px-3 py-1 text-xs font-medium text-[var(--text-tertiary)] mb-1">Группы</div>
                {allGroups.map(group => (
                  <label
                    key={group}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-tertiary)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroups.size === 0 || selectedGroups.has(group)}
                      onChange={(e) => {
                        setSelectedGroups(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) {
                            if (next.size === allGroups.length - 1) {
                              return new Set();
                            }
                            next.add(group);
                          } else {
                            if (next.size === 0) {
                              allGroups.forEach(g => { if (g !== group) next.add(g); });
                            } else {
                              next.delete(group);
                            }
                          }
                          return next;
                        });
                      }}
                      className="rounded"
                    />
                    <span className="text-sm text-[var(--text-primary)]">{groupLabels?.[group] ?? group}</span>
                  </label>
                ))}
                {selectedGroups.size > 0 && (
                  <button
                    onClick={() => setSelectedGroups(new Set())}
                    className="w-full px-3 py-2 text-xs text-[var(--color-primary-500)] hover:bg-[var(--bg-tertiary)] text-left"
                  >
                    Сбросить фильтры
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Edges mode toggle */}
        {onEventUpdate && (
          <button
            onClick={() => setEdgesMode(!edgesMode)}
            className={`p-2 rounded-lg transition-colors ${
              edgesMode ? 'bg-[var(--color-primary-500)] text-white' : 'hover:bg-[var(--bg-secondary)]'
            }`}
            title={edgesMode ? "Режим соединения (клик для растягивания)" : "Режим растягивания (клик для соединения)"}
          >
            <Workflow className="w-4 h-4" />
          </button>
        )}

        {/* Print */}
        <button
          onClick={onPrint}
          className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
          title="Печать"
        >
          <Printer className="w-4 h-4 text-[var(--text-secondary)]" />
        </button>

        {/* Add event */}
        {onAddEvent && (
          <button
            onClick={() => onAddEvent(new Date())}
            className="px-3 py-1.5 bg-[var(--color-primary-500)] text-white rounded-lg text-xs hover:bg-[var(--color-primary-600)] transition flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Добавить событие
          </button>
        )}
      </div>
    </div>
  );
}
