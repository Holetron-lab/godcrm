import { useRef, useEffect, useState, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { calcCellPortalPosition } from '@/shared/components/ui/CellPortal';
import { ChevronLeft, ChevronRight, Clock, Calendar, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

type DateMode = 'date' | 'datetime' | 'month' | 'year' | 'week' | 'quarter';

interface DateEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: (valueOverride?: string) => void;
  onCancel: () => void;
  showTime?: boolean;
  dateFormat?: string;
  mode?: DateMode;
}

const DATE_FORMATS = {
  iso: { label: 'ISO (2025-12-31)', pattern: 'YYYY-MM-DD', separator: '-' },
  eu: { label: 'EU (31.12.2025)', pattern: 'DD.MM.YYYY', separator: '.' },
  us: { label: 'US (12/31/2025)', pattern: 'MM/DD/YYYY', separator: '/' },
  unix: { label: 'Unix Timestamp', pattern: 'timestamp', separator: '' },
};

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_RU_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTHS_EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const QUARTER_LABELS_RU = [
  { label: 'Q1', description: 'Янв — Мар' },
  { label: 'Q2', description: 'Апр — Июн' },
  { label: 'Q3', description: 'Июл — Сен' },
  { label: 'Q4', description: 'Окт — Дек' },
];
const QUARTER_LABELS_EN = [
  { label: 'Q1', description: 'Jan — Mar' },
  { label: 'Q2', description: 'Apr — Jun' },
  { label: 'Q3', description: 'Jul — Sep' },
  { label: 'Q4', description: 'Oct — Dec' },
];

// Get ISO week number from date
const getISOWeek = (date: Date): number => {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
};

// Get ISO week year (can differ from calendar year at year boundaries)
const getISOWeekYear = (date: Date): number => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  return d.getFullYear();
};

const parseDate = (value: string): Date | null => {
  if (!value) return null;
  if (/^\d{10,13}$/.test(value)) {
    const ts = value.length === 10 ? parseInt(value) * 1000 : parseInt(value);
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  const isoDate = new Date(value);
  if (!isNaN(isoDate.getTime())) return isoDate;
  const euMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (euMatch) {
    const d = new Date(parseInt(euMatch[3]), parseInt(euMatch[2]) - 1, parseInt(euMatch[1]));
    if (!isNaN(d.getTime())) return d;
  }
  const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const d = new Date(parseInt(usMatch[3]), parseInt(usMatch[1]) - 1, parseInt(usMatch[2]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
};

const formatDate = (date: Date, format: string, includeTime: boolean = false): string => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  let result = '';
  switch (format) {
    case 'iso': result = `${year}-${month}-${day}`; break;
    case 'eu': result = `${day}.${month}.${year}`; break;
    case 'us': result = `${month}/${day}/${year}`; break;
    case 'unix': return String(Math.floor(date.getTime() / 1000));
    default: result = `${year}-${month}-${day}`;
  }
  if (includeTime && format !== 'unix') {
    result += ` ${hours}:${minutes}`;
  }
  return result;
};

const detectFormat = (value: string): string => {
  if (!value) return 'iso';
  if (/^\d{10,13}$/.test(value)) return 'unix';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'iso';
  if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(value)) return 'eu';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) return 'us';
  return 'iso';
};

// Shared dropdown style
const dropdownStyle = (position: { top: number; left: number }, width: string) => ({
  top: position.top,
  left: position.left,
  width,
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
});

// ==================== MonthPicker (ADR-070) ====================
const MonthPicker = ({ value, onCommit, onCancel, position }: {
  value: string; onCommit: (v: string) => void; onCancel: () => void; position: { top: number; left: number };
}) => {
  const { language, t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const match = value.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  const [viewYear, setViewYear] = useState(match ? parseInt(match[1]) : new Date().getFullYear());
  const selectedMonth = match ? parseInt(match[2]) : null;
  const selectedYear = match ? parseInt(match[1]) : null;
  const months = language === 'ru' ? MONTHS_RU_SHORT : MONTHS_EN_SHORT;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onCancel();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleKey); };
  }, [onCancel]);

  return (
    <div ref={containerRef} className="fixed z-[9999] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden" style={dropdownStyle(position, '280px')}>
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-secondary)]">
        <button type="button" onClick={() => setViewYear(y => y - 1)} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
        <span className="font-medium text-sm">{viewYear}</span>
        <button type="button" onClick={() => setViewYear(y => y + 1)} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        {months.map((name, idx) => {
          const monthNum = idx + 1;
          const isSelected = selectedYear === viewYear && selectedMonth === monthNum;
          const isCurrent = new Date().getFullYear() === viewYear && new Date().getMonth() === idx;
          return (
            <button key={idx} type="button" onClick={() => onCommit(`${viewYear}-${String(monthNum).padStart(2, '0')}`)}
              className={`px-2 py-2.5 text-sm rounded-lg transition-all ${isCurrent ? 'ring-1 ring-primary-500' : ''} ${isSelected ? 'bg-primary-500 text-white font-semibold shadow-lg' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'}`}>
              {name}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between p-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
        <button type="button" onClick={() => { const now = new Date(); onCommit(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`); }}
          className="px-3 py-1.5 text-xs font-medium text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg">{t('dateSettings.picker.current')}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg">{t('dateSettings.picker.cancel')}</button>
      </div>
    </div>
  );
};

// ==================== YearPicker (ADR-070) ====================
const YearPicker = ({ value, onCommit, onCancel, position }: {
  value: string; onCommit: (v: string) => void; onCancel: () => void; position: { top: number; left: number };
}) => {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const currentValue = value.match(/^\d{4}$/) ? parseInt(value) : null;
  const [decadeStart, setDecadeStart] = useState(() => {
    const base = currentValue || new Date().getFullYear();
    return Math.floor(base / 10) * 10;
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onCancel();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleKey); };
  }, [onCancel]);

  const years = Array.from({ length: 12 }, (_, i) => decadeStart - 1 + i);

  return (
    <div ref={containerRef} className="fixed z-[9999] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden" style={dropdownStyle(position, '280px')}>
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-secondary)]">
        <button type="button" onClick={() => setDecadeStart(d => d - 10)} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
        <span className="font-medium text-sm">{decadeStart} — {decadeStart + 9}</span>
        <button type="button" onClick={() => setDecadeStart(d => d + 10)} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        {years.map((year) => {
          const isSelected = currentValue === year;
          const isCurrent = new Date().getFullYear() === year;
          const isInDecade = year >= decadeStart && year < decadeStart + 10;
          return (
            <button key={year} type="button" onClick={() => onCommit(String(year))}
              className={`px-2 py-2.5 text-sm rounded-lg transition-all ${!isInDecade ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'} ${isCurrent ? 'ring-1 ring-primary-500' : ''} ${isSelected ? 'bg-primary-500 text-white font-semibold shadow-lg' : 'hover:bg-[var(--bg-tertiary)]'}`}>
              {year}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between p-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
        <button type="button" onClick={() => onCommit(String(new Date().getFullYear()))}
          className="px-3 py-1.5 text-xs font-medium text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg">{t('dateSettings.picker.current')}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg">{t('dateSettings.picker.cancel')}</button>
      </div>
    </div>
  );
};

// ==================== WeekPicker (ADR-070) ====================
const WeekPicker = ({ value, onCommit, onCancel, position }: {
  value: string; onCommit: (v: string) => void; onCancel: () => void; position: { top: number; left: number };
}) => {
  const { language, t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const match = value.match(/^(\d{4})-W(\d{2})$/);
  const selectedWeekYear = match ? parseInt(match[1]) : null;
  const selectedWeek = match ? parseInt(match[2]) : null;
  const monthNames = language === 'ru' ? MONTHS_RU : MONTHS_EN;
  const weekdayNames = language === 'ru' ? WEEKDAYS_RU : WEEKDAYS_EN;
  const [viewDate, setViewDate] = useState(() => new Date());

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onCancel();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleKey); };
  }, [onCancel]);

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) days.push({ date: new Date(year, month - 1, prevMonthLastDay - i), isCurrentMonth: false });
    for (let day = 1; day <= lastDay.getDate(); day++) days.push({ date: new Date(year, month, day), isCurrentMonth: true });
    const remaining = 42 - days.length;
    for (let day = 1; day <= remaining; day++) days.push({ date: new Date(year, month + 1, day), isCurrentMonth: false });
    return days;
  }, [viewDate]);

  const weeks = useMemo(() => {
    const result: Array<{ days: typeof calendarDays; weekNum: number; weekYear: number }> = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      const weekDays = calendarDays.slice(i, i + 7);
      const thursday = weekDays[3]?.date;
      if (thursday) result.push({ days: weekDays, weekNum: getISOWeek(thursday), weekYear: getISOWeekYear(thursday) });
    }
    return result;
  }, [calendarDays]);

  return (
    <div ref={containerRef} className="fixed z-[9999] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden" style={dropdownStyle(position, '320px')}>
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-secondary)]">
        <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
        <span className="font-medium text-sm">{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</span>
        <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="p-2">
        <div className="grid grid-cols-8 gap-1 mb-1">
          <div className="text-center text-xs font-medium text-[var(--text-tertiary)] py-1">W</div>
          {weekdayNames.map((day) => <div key={day} className="text-center text-xs font-medium text-[var(--text-tertiary)] py-1">{day}</div>)}
        </div>
        {weeks.map((week, wIdx) => {
          const isSelected = selectedWeekYear === week.weekYear && selectedWeek === week.weekNum;
          const now = new Date();
          const isCurrent = getISOWeekYear(now) === week.weekYear && getISOWeek(now) === week.weekNum;
          return (
            <div key={wIdx} onClick={() => onCommit(`${week.weekYear}-W${String(week.weekNum).padStart(2, '0')}`)}
              className={`grid grid-cols-8 gap-1 cursor-pointer rounded-lg transition-all mb-0.5 ${isSelected ? 'bg-primary-500/20 ring-1 ring-primary-500' : 'hover:bg-[var(--bg-tertiary)]'} ${isCurrent && !isSelected ? 'ring-1 ring-primary-300' : ''}`}>
              <div className={`text-center text-xs py-1.5 font-mono font-semibold ${isSelected ? 'text-primary-500' : 'text-[var(--text-tertiary)]'}`}>{week.weekNum}</div>
              {week.days.map((day, dIdx) => (
                <div key={dIdx} className={`text-center text-sm py-1.5 ${day.isCurrentMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'} ${isSelected ? 'font-medium' : ''}`}>{day.date.getDate()}</div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between p-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
        <button type="button" onClick={() => { const now = new Date(); onCommit(`${getISOWeekYear(now)}-W${String(getISOWeek(now)).padStart(2, '0')}`); }}
          className="px-3 py-1.5 text-xs font-medium text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg">{t('dateSettings.picker.current')}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg">{t('dateSettings.picker.cancel')}</button>
      </div>
    </div>
  );
};

// ==================== QuarterPicker (ADR-070) ====================
const QuarterPicker = ({ value, onCommit, onCancel, position }: {
  value: string; onCommit: (v: string) => void; onCancel: () => void; position: { top: number; left: number };
}) => {
  const { language, t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const match = value.match(/^(\d{4})-Q([1-4])$/);
  const [viewYear, setViewYear] = useState(match ? parseInt(match[1]) : new Date().getFullYear());
  const selectedQuarter = match ? parseInt(match[2]) : null;
  const selectedYear = match ? parseInt(match[1]) : null;
  const quarterLabels = language === 'ru' ? QUARTER_LABELS_RU : QUARTER_LABELS_EN;
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onCancel();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleKey); };
  }, [onCancel]);

  return (
    <div ref={containerRef} className="fixed z-[9999] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden" style={dropdownStyle(position, '260px')}>
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-secondary)]">
        <button type="button" onClick={() => setViewYear(y => y - 1)} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
        <span className="font-medium text-sm">{viewYear}</span>
        <button type="button" onClick={() => setViewYear(y => y + 1)} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3 p-3">
        {quarterLabels.map((q, idx) => {
          const qNum = idx + 1;
          const isSelected = selectedYear === viewYear && selectedQuarter === qNum;
          const isCurrent = new Date().getFullYear() === viewYear && currentQuarter === qNum;
          return (
            <button key={idx} type="button" onClick={() => onCommit(`${viewYear}-Q${qNum}`)}
              className={`flex flex-col items-center gap-1 px-3 py-4 rounded-xl transition-all ${isCurrent ? 'ring-1 ring-primary-500' : ''} ${isSelected ? 'bg-primary-500 text-white shadow-lg' : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'}`}>
              <span className="text-lg font-bold">{q.label}</span>
              <span className={`text-xs ${isSelected ? 'text-white/80' : 'text-[var(--text-tertiary)]'}`}>{q.description}</span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-between p-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
        <button type="button" onClick={() => onCommit(`${new Date().getFullYear()}-Q${currentQuarter}`)}
          className="px-3 py-1.5 text-xs font-medium text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg">{t('dateSettings.picker.current')}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg">{t('dateSettings.picker.cancel')}</button>
      </div>
    </div>
  );
};

// ==================== Main DateEditor ====================
export const DateEditor = ({
  value, onChange, onCommit, onCancel, showTime = false, dateFormat, mode
}: DateEditorProps) => {
  const { language, t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [activeFormat, setActiveFormat] = useState<string>(dateFormat || detectFormat(value));
  const monthNames = language === 'ru' ? MONTHS_RU : MONTHS_EN;
  const weekdayNames = language === 'ru' ? WEEKDAYS_RU : WEEKDAYS_EN;

  useLayoutEffect(() => {
    if (triggerRef.current) {
      const td = triggerRef.current.closest('td');
      const rect = td ? td.getBoundingClientRect() : triggerRef.current.getBoundingClientRect();
      // Use viewport-aware positioning (handles bottom/top/left/right overflow)
      setPosition(calcCellPortalPosition(rect, 320, 550));
    }
  }, []);

  const effectiveMode: DateMode = mode || (showTime ? 'datetime' : 'date');

  // For non-calendar modes, use specialized pickers
  if (effectiveMode === 'month') {
    return (
      <><div ref={triggerRef} className="absolute inset-0" />{createPortal(<MonthPicker value={value} onCommit={(v) => onCommit(v)} onCancel={onCancel} position={position} />, document.body)}</>
    );
  }
  if (effectiveMode === 'year') {
    return (
      <><div ref={triggerRef} className="absolute inset-0" />{createPortal(<YearPicker value={value} onCommit={(v) => onCommit(v)} onCancel={onCancel} position={position} />, document.body)}</>
    );
  }
  if (effectiveMode === 'week') {
    return (
      <><div ref={triggerRef} className="absolute inset-0" />{createPortal(<WeekPicker value={value} onCommit={(v) => onCommit(v)} onCancel={onCancel} position={position} />, document.body)}</>
    );
  }
  if (effectiveMode === 'quarter') {
    return (
      <><div ref={triggerRef} className="absolute inset-0" />{createPortal(<QuarterPicker value={value} onCommit={(v) => onCommit(v)} onCancel={onCancel} position={position} />, document.body)}</>
    );
  }

  // date / datetime modes — existing calendar picker
  const initialDate = parseDate(value) || new Date();
  const [viewDate, setViewDate] = useState<Date>(initialDate);
  const [selectedDate, setSelectedDate] = useState<Date | null>(parseDate(value));
  const [selectedTime, setSelectedTime] = useState({ hours: initialDate.getHours(), minutes: initialDate.getMinutes() });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [rawInputValue, setRawInputValue] = useState<string>(() => {
    const parsed = parseDate(value);
    return parsed ? formatDate(parsed, dateFormat || 'iso', showTime) : (value || '');
  });
  const originalDisplayValue = useMemo(() => {
    const parsed = parseDate(value);
    return parsed ? formatDate(parsed, dateFormat || 'iso', showTime) : (value || '—');
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (selectedDate) {
          onCommit(formatDate(selectedDate, activeFormat, showTime));
        } else {
          onCancel();
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCommit, onCancel, selectedDate, activeFormat, showTime]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      else if (event.key === 'Enter') handleConfirm();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedDate, selectedTime, activeFormat]);

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;
    const days: Array<{ date: Date; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean }> = [];
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLastDay - i);
      days.push({ date: d, isCurrentMonth: false, isToday: false, isSelected: false });
    }
    const today = new Date();
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const d = new Date(year, month, day);
      days.push({ date: d, isCurrentMonth: true, isToday: d.toDateString() === today.toDateString(), isSelected: selectedDate ? d.toDateString() === selectedDate.toDateString() : false });
    }
    const remainingDays = 42 - days.length;
    for (let day = 1; day <= remainingDays; day++) {
      days.push({ date: new Date(year, month + 1, day), isCurrentMonth: false, isToday: false, isSelected: false });
    }
    return days;
  }, [viewDate, selectedDate]);

  const handlePrevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));

  const handleSelectDay = (date: Date) => {
    const newDate = new Date(date);
    if (showTime) newDate.setHours(selectedTime.hours, selectedTime.minutes);
    else newDate.setHours(0, 0, 0, 0);
    setSelectedDate(newDate);
    const formatted = formatDate(newDate, activeFormat, showTime);
    setRawInputValue(formatted);
    onChange(formatted);
  };

  const handleSelectDayDoubleClick = (date: Date) => {
    const newDate = new Date(date);
    if (showTime) newDate.setHours(selectedTime.hours, selectedTime.minutes);
    else newDate.setHours(0, 0, 0, 0);
    onCommit(formatDate(newDate, activeFormat, showTime));
  };

  const handleTimeChange = (hours: number, minutes: number) => {
    setSelectedTime({ hours, minutes });
    if (selectedDate) {
      const newDate = new Date(selectedDate);
      newDate.setHours(hours, minutes);
      setSelectedDate(newDate);
      const formatted = formatDate(newDate, activeFormat, true);
      setRawInputValue(formatted);
      onChange(formatted);
    }
  };

  const handleConfirm = () => {
    if (selectedDate) {
      const finalDate = new Date(selectedDate);
      if (showTime) finalDate.setHours(selectedTime.hours, selectedTime.minutes);
      onCommit(formatDate(finalDate, activeFormat, showTime));
    } else {
      onCommit('');
    }
  };

  const handleClear = () => { setSelectedDate(null); setRawInputValue(''); onChange(''); onCommit(''); };
  const handleToday = () => {
    const today = new Date();
    if (showTime) today.setHours(selectedTime.hours, selectedTime.minutes);
    setSelectedDate(today); setViewDate(today);
    const formatted = formatDate(today, activeFormat, showTime);
    setRawInputValue(formatted); onChange(formatted);
  };

  const dropdownContent = (
    <div ref={containerRef} className="fixed z-[9999] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden"
      style={{ top: position.top, left: position.left, width: '300px', boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1) inset' }}>
      {/* Header */}
      <div className="p-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary-500 flex-shrink-0" />
            <span className="text-sm text-[var(--text-secondary)]"><span className="font-mono">{originalDisplayValue}</span></span>
          </div>
          <button type="button" onClick={handleClear} className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-tertiary)] hover:text-red-500"><X className="w-4 h-4" /></button>
        </div>
      </div>
      {/* RAW input */}
      <div className="px-2 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--border-secondary)]">
        <input type="text" value={rawInputValue}
          onChange={(e) => {
            setRawInputValue(e.target.value);
            const parsed = parseDate(e.target.value);
            if (parsed) { setSelectedDate(parsed); setViewDate(parsed); onChange(formatDate(parsed, activeFormat, showTime)); }
            else { onChange(e.target.value); }
          }}
          placeholder="YYYY-MM-DD" className="w-full text-[11px] font-mono bg-transparent border-none outline-none text-[var(--text-primary)]" />
      </div>
      {/* Month nav */}
      <div className="flex items-center justify-between p-2 border-b border-[var(--border-secondary)]">
        <button type="button" onClick={handlePrevMonth} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
        <span className="font-medium text-sm">{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</span>
        <button type="button" onClick={handleNextMonth} className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg"><ChevronRight className="w-4 h-4" /></button>
      </div>
      {/* Calendar */}
      <div className="p-2">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {weekdayNames.map((day) => <div key={day} className="text-center text-xs font-medium text-[var(--text-tertiary)] py-1">{day}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, idx) => (
            <button key={idx} type="button" onClick={() => handleSelectDay(day.date)} onDoubleClick={() => handleSelectDayDoubleClick(day.date)}
              className={`p-2 text-sm rounded-lg transition-all ${day.isCurrentMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'} ${day.isToday ? 'ring-1 ring-primary-500' : ''} ${day.isSelected ? 'bg-primary-500 text-white font-semibold shadow-lg' : 'hover:bg-[var(--bg-tertiary)]'}`}>
              {day.date.getDate()}
            </button>
          ))}
        </div>
      </div>
      {/* Time picker */}
      {showTime && (
        <div className="p-2 border-t border-[var(--border-secondary)]">
          <button type="button" onClick={() => setShowTimePicker(!showTimePicker)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--text-tertiary)]" />
              <span className="text-sm">{t('dateSettings.picker.time')}</span>
            </div>
            <span className="text-sm font-mono font-medium">{String(selectedTime.hours).padStart(2, '0')}:{String(selectedTime.minutes).padStart(2, '0')}</span>
          </button>
          {showTimePicker && (
            <div className="mt-2 flex items-center justify-center gap-2">
              <input type="number" min={0} max={23} value={selectedTime.hours}
                onChange={(e) => handleTimeChange(parseInt(e.target.value) || 0, selectedTime.minutes)}
                className="w-16 px-2 py-1 text-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]" />
              <span className="text-lg font-bold">:</span>
              <input type="number" min={0} max={59} value={selectedTime.minutes}
                onChange={(e) => handleTimeChange(selectedTime.hours, parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]" />
            </div>
          )}
        </div>
      )}
      {/* Footer */}
      <div className="flex items-center justify-between gap-2 p-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
        <button type="button" onClick={handleToday} className="px-3 py-1.5 text-xs font-medium text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg">
          {t('dateSettings.picker.today')}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg">
            {t('dateSettings.picker.cancel')}
          </button>
          <button type="button" onClick={handleConfirm} className="px-3 py-1.5 text-xs font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-600 shadow">
            OK
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <><div ref={triggerRef} className="absolute inset-0" />{createPortal(dropdownContent, document.body)}</>
  );
};

export { parseDate, formatDate, detectFormat, DATE_FORMATS, getISOWeek, getISOWeekYear };
