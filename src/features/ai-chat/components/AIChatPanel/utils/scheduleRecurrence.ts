/**
 * scheduleRecurrence — ADR-208 D8 client-side cron helpers for recurring scheduled messages.
 *
 * Presets are assembled into 5-field cron strings without a library, and described back
 * from a cron string for the series badge. Anything outside the preset shapes is shown raw
 * (ponytail: ADR-208 D8 allows the raw cron instead of pulling in cronstrue).
 */

export type RecurrencePreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron';

export interface RecurrenceForm {
  preset: RecurrencePreset;
  hour: number;
  minute: number;
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  /** Day of month 1…31. */
  monthDay: number;
  /** Free-form 5-field cron (preset 'cron'). */
  cron: string;
}

/** ISO weekday → translation key (shared with the calendar headers). */
export const WEEKDAY_KEYS: Record<number, string> = {
  1: 'dateSettings.weekdays.mon',
  2: 'dateSettings.weekdays.tue',
  3: 'dateSettings.weekdays.wed',
  4: 'dateSettings.weekdays.thu',
  5: 'dateSettings.weekdays.fri',
  6: 'dateSettings.weekdays.sat',
  7: 'dateSettings.weekdays.sun',
};

const CRON_FIELD = /^[\d*,/-]+$/;
const INTEGER = /^\d+$/;
const EVERY_N = /^\*\/(\d+)$/;

const pad = (n: number | string) => String(n).padStart(2, '0');
/** ISO weekday (1…7) → cron day-of-week (0 = Sunday … 6 = Saturday). */
const isoToCronDow = (iso: number) => iso % 7;
const cronToIsoDow = (dow: number) => (dow === 0 || dow === 7 ? 7 : dow);

/** Loose structural check; the backend (croner) is the authority on validity. */
export function isCronShapeValid(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  return fields.length === 5 && fields.every(f => CRON_FIELD.test(f));
}

/** Build the cron string for the form; `null` means one-time (no recurrence) or an incomplete form. */
export function buildCron(form: RecurrenceForm): string | null {
  const time = `${form.minute} ${form.hour}`;
  switch (form.preset) {
    case 'none':
      return null;
    case 'daily':
      return `${time} * * *`;
    case 'weekdays':
      return `${time} * * 1-5`;
    case 'weekly': {
      const days = [...new Set(form.weekdays.map(isoToCronDow))].sort((a, b) => a - b);
      return days.length > 0 ? `${time} * * ${days.join(',')}` : null;
    }
    case 'monthly':
      return `${time} ${form.monthDay} * *`;
    case 'cron': {
      const cron = form.cron.trim().replace(/\s+/g, ' ');
      return isCronShapeValid(cron) ? cron : null;
    }
  }
}

export interface CronDescription {
  /** aiChat.ui.* translation key. */
  key: string;
  params?: Record<string, string | number>;
  /** ISO weekdays to be rendered through WEEKDAY_KEYS and passed as `days`. */
  weekdays?: number[];
}

/** Recognise the preset shapes; returns `null` for anything else (caller shows the raw cron). */
export function describeCron(cron: string): CronDescription | null {
  if (!isCronShapeValid(cron)) return null;
  const [minute, hour, dom, month, dow] = cron.trim().split(/\s+/);
  if (month !== '*') return null;

  const everyMinutes = minute.match(EVERY_N);
  if (everyMinutes && hour === '*' && dom === '*' && dow === '*') {
    return { key: 'aiChat.ui.cronEveryMinutes', params: { count: Number(everyMinutes[1]) } };
  }
  if (minute === '*' && hour === '*' && dom === '*' && dow === '*') {
    return { key: 'aiChat.ui.cronEveryMinute' };
  }
  const everyHours = hour.match(EVERY_N);
  if (INTEGER.test(minute) && everyHours && dom === '*' && dow === '*') {
    return { key: 'aiChat.ui.cronEveryHours', params: { count: Number(everyHours[1]), minute: pad(minute) } };
  }

  if (!INTEGER.test(minute) || !INTEGER.test(hour)) return null;
  const time = `${pad(hour)}:${pad(minute)}`;
  if (dom === '*' && dow === '*') return { key: 'aiChat.ui.cronDaily', params: { time } };
  if (dom === '*' && dow === '1-5') return { key: 'aiChat.ui.cronWeekdays', params: { time } };
  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
    const weekdays = [...new Set(dow.split(',').map(d => cronToIsoDow(Number(d))))].sort((a, b) => a - b);
    return { key: 'aiChat.ui.cronWeekly', params: { time }, weekdays };
  }
  if (INTEGER.test(dom) && dow === '*') return { key: 'aiChat.ui.cronMonthly', params: { day: Number(dom), time } };
  return null;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Human-readable label for a cron, falling back to the raw expression. */
export function formatCronLabel(cron: string, t: Translate): string {
  const described = describeCron(cron);
  if (!described) return cron;
  const days = described.weekdays?.map(d => t(WEEKDAY_KEYS[d])).join(', ');
  return t(described.key, { ...described.params, ...(days !== undefined && { days }) });
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function listTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}
