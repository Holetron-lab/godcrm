import { parseDate } from './DateEditor';
import { useLanguage } from '@/shared/i18n/LanguageContext';

type DateMode = 'date' | 'datetime' | 'month' | 'year' | 'week' | 'quarter';

interface DateCellProps {
  value: unknown;
  showTime?: boolean;
  dateFormat?: string;
  displayFormat?: string;
  rawMode?: boolean;
  storageFormat?: string;
  mode?: DateMode;
  onUpdateFormat?: () => void;
}

// Detect the format of a date value
export const detectDateFormat = (value: unknown): 'iso' | 'eu' | 'us' | 'unix' | 'unix_ms' | 'unknown' => {
  if (value === null || value === undefined || value === '') return 'unknown';
  const str = String(value);
  if (/^\d{10}$/.test(str)) return 'unix';
  if (/^\d{13}$/.test(str)) return 'unix_ms';
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return 'iso';
  if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(str)) return 'eu';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) return 'us';
  return 'unknown';
};

// Parse month value like "2025-12"
export const parseMonth = (value: string): { year: number; month: number } | null => {
  const match = value.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return null;
  return { year: parseInt(match[1]), month: parseInt(match[2]) };
};

// Parse year value like "2025"
export const parseYear = (value: string): number | null => {
  const match = value.match(/^(\d{4})$/);
  if (!match) return null;
  const year = parseInt(match[1]);
  return year >= 1900 && year <= 2200 ? year : null;
};

// Parse week value like "2025-W50"
export const parseWeek = (value: string): { year: number; week: number } | null => {
  const match = value.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const week = parseInt(match[2]);
  return week >= 1 && week <= 53 ? { year: parseInt(match[1]), week } : null;
};

// Parse quarter value like "2025-Q4"
export const parseQuarter = (value: string): { year: number; quarter: number } | null => {
  const match = value.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  return { year: parseInt(match[1]), quarter: parseInt(match[2]) };
};

// Get ISO week date range for display
const getWeekDateRange = (year: number, week: number): { start: Date; end: Date } => {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - dayOfWeek + 1);
  const start = new Date(startOfWeek1);
  start.setDate(startOfWeek1.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
};

const MONTHS_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_SHORT_RU = ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];
const MONTHS_FULL_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_FULL_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT_CAP_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_SHORT_CAP_RU = ['Янв.', 'Фев.', 'Мар.', 'Апр.', 'Май', 'Июн.', 'Июл.', 'Авг.', 'Сен.', 'Окт.', 'Ноя.', 'Дек.'];

// Format month for display
const formatMonthDisplay = (year: number, month: number, displayFormat: string | undefined, lang: string): string => {
  const full = lang === 'ru' ? MONTHS_FULL_RU : MONTHS_FULL_EN;
  const short = lang === 'ru' ? MONTHS_SHORT_CAP_RU : MONTHS_SHORT_CAP_EN;
  switch (displayFormat) {
    case 'short': return `${short[month - 1]} ${year}`;
    case 'numeric': return `${String(month).padStart(2, '0')}.${year}`;
    case 'iso': return `${year}-${String(month).padStart(2, '0')}`;
    default: return `${full[month - 1]} ${year}`;
  }
};

// Format year for display
const formatYearDisplay = (year: number, displayFormat: string | undefined, lang: string): string => {
  switch (displayFormat) {
    case 'full': return lang === 'ru' ? `${year} г.` : `${year}`;
    default: return String(year);
  }
};

// Format week for display
const formatWeekDisplay = (year: number, week: number, displayFormat: string | undefined, lang: string): string => {
  const weekLabel = lang === 'ru' ? 'Неделя' : 'Week';
  const weekShort = lang === 'ru' ? 'Нед.' : 'W';
  const monthsShort = lang === 'ru' ? MONTHS_SHORT_RU : MONTHS_SHORT_EN;
  switch (displayFormat) {
    case 'short': return `${weekShort} ${week}`;
    case 'iso': return `${year}-W${String(week).padStart(2, '0')}`;
    case 'range': {
      const { start, end } = getWeekDateRange(year, week);
      const startDay = start.getDate();
      const endDay = end.getDate();
      if (start.getMonth() === end.getMonth()) {
        return `${startDay}-${endDay} ${monthsShort[start.getMonth()]} ${year}`;
      }
      return `${startDay} ${monthsShort[start.getMonth()]} - ${endDay} ${monthsShort[end.getMonth()]} ${year}`;
    }
    default: return `${weekLabel} ${week}, ${year}`;
  }
};

// Format quarter for display
const formatQuarterDisplay = (year: number, quarter: number, displayFormat: string | undefined, lang: string): string => {
  const qLabel = lang === 'ru' ? 'квартал' : 'quarter';
  switch (displayFormat) {
    case 'short': return `Q${quarter} ${year}`;
    case 'numeric': return `${quarter}/${year}`;
    default: return `${quarter} ${qLabel} ${year}`;
  }
};

// Format date for display with nice localized output
const formatForDisplay = (date: Date, showTime: boolean, displayFormat: string | undefined, lang: string): string => {
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (displayFormat === 'relative') {
    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        if (minutes < 1) return lang === 'ru' ? 'только что' : 'just now';
        if (minutes < 0) return lang === 'ru' ? 'скоро' : 'soon';
        return lang === 'ru' ? `${minutes} мин. назад` : `${minutes} min. ago`;
      }
      if (hours < 0) return lang === 'ru' ? 'скоро' : 'soon';
      return lang === 'ru' ? `${hours} ч. назад` : `${hours} h. ago`;
    } else if (days === 1) {
      return lang === 'ru' ? 'вчера' : 'yesterday';
    } else if (days === -1) {
      return lang === 'ru' ? 'завтра' : 'tomorrow';
    } else if (days < 0) {
      return lang === 'ru' ? `через ${Math.abs(days)} дн.` : `in ${Math.abs(days)} d.`;
    } else if (days < 7) {
      return lang === 'ru' ? `${days} дн. назад` : `${days} d. ago`;
    } else if (days < 30) {
      const weeks = Math.floor(days / 7);
      return lang === 'ru' ? `${weeks} нед. назад` : `${weeks} w. ago`;
    } else if (days < 365) {
      const months = Math.floor(days / 30);
      return lang === 'ru' ? `${months} мес. назад` : `${months} mo. ago`;
    } else {
      const years = Math.floor(days / 365);
      return lang === 'ru' ? `${years} г. назад` : `${years} y. ago`;
    }
  }

  if (displayFormat === 'iso_date') {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  if (displayFormat === 'full') {
    const dateStr = date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = showTime ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
    return timeStr ? `${dateStr}, ${timeStr}` : dateStr;
  }

  if (displayFormat === 'short') {
    const dateStr = date.toLocaleDateString(locale, { year: '2-digit', month: '2-digit', day: '2-digit' });
    const timeStr = showTime ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
    return timeStr ? `${dateStr} ${timeStr}` : dateStr;
  }

  // Default format
  const dateStr = date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = showTime ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
  return timeStr ? `${dateStr} ${timeStr}` : dateStr;
};

export const DateCell = ({ value, showTime = false, dateFormat, displayFormat, rawMode, storageFormat, mode, onUpdateFormat }: DateCellProps) => {
  const { language } = useLanguage();

  // Detect format mismatch
  const detectedFormat = detectDateFormat(value);
  const expectedFormat = storageFormat || 'iso';
  const formatMismatch = detectedFormat !== 'unknown' && detectedFormat !== expectedFormat;

  // RAW mode - show ISO string as-is
  if (rawMode) {
    if (value === null || value === undefined || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {String(value)}
      </span>
    );
  }

  // Formatted mode (default)
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--text-tertiary)] italic text-sm">Date...</span>;
  }

  // Mode-based rendering for non-date/datetime modes (ADR-070)
  const effectiveMode: DateMode = mode || (showTime ? 'datetime' : 'date');
  const strValue = String(value);

  if (effectiveMode === 'month') {
    const parsed = parseMonth(strValue);
    if (!parsed) return <span className="text-[var(--text-tertiary)]">Invalid month</span>;
    return <span className="text-sm text-[var(--text-primary)]">{formatMonthDisplay(parsed.year, parsed.month, displayFormat, language)}</span>;
  }

  if (effectiveMode === 'year') {
    const parsed = parseYear(strValue);
    if (parsed === null) return <span className="text-[var(--text-tertiary)]">Invalid year</span>;
    return <span className="text-sm text-[var(--text-primary)]">{formatYearDisplay(parsed, displayFormat, language)}</span>;
  }

  if (effectiveMode === 'week') {
    const parsed = parseWeek(strValue);
    if (!parsed) return <span className="text-[var(--text-tertiary)]">Invalid week</span>;
    return <span className="text-sm text-[var(--text-primary)]">{formatWeekDisplay(parsed.year, parsed.week, displayFormat, language)}</span>;
  }

  if (effectiveMode === 'quarter') {
    const parsed = parseQuarter(strValue);
    if (!parsed) return <span className="text-[var(--text-tertiary)]">Invalid quarter</span>;
    return <span className="text-sm text-[var(--text-primary)]">{formatQuarterDisplay(parsed.year, parsed.quarter, displayFormat, language)}</span>;
  }

  // date / datetime modes — existing logic
  try {
    const date = parseDate(strValue);

    if (!date) {
      return <span className="text-[var(--text-tertiary)]">Invalid date</span>;
    }

    const displayStr = formatForDisplay(date, showTime, displayFormat, language);

    // If format mismatch, show warning with update button
    if (formatMismatch && onUpdateFormat) {
      return (
        <div className="flex items-center gap-1.5 group">
          <span
            className="text-sm text-[var(--text-primary)] border border-red-300 dark:border-red-500/50 rounded px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20"
            title={`Expected ${expectedFormat}, detected ${detectedFormat}`}
          >
            {displayStr}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateFormat();
            }}
            className="opacity-0 group-hover:opacity-100 text-xs px-1.5 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-all"
            title="Update format"
          >
            ↻
          </button>
        </div>
      );
    }

    return (
      <span className="text-sm text-[var(--text-primary)]">
        {displayStr}
      </span>
    );
  } catch {
    return <span className="text-[var(--text-tertiary)]">Invalid date</span>;
  }
};
