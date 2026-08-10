// schedule-trigger/cron.js — Cron expression matching

/**
 * Check whether a single cron field matches the given value.
 *
 * Supported syntax per field:
 *   *        — any value
 *   5        — exact match
 *   1,3,5    — list
 *   1-5      — range (inclusive)
 *   * /10     — step (every N) — note: written without space, spaced here to avoid comment issues
 *
 * @param {string} field  - One segment of the cron expression
 * @param {number} value  - Current time component value
 * @param {number} min    - Minimum allowed value for this field
 * @param {number} max    - Maximum allowed value for this field
 * @returns {boolean}
 */
function cronFieldMatches(field, value, min, max) {
  if (field === '*') return true;

  // Step: */N or N/M
  if (field.includes('/')) {
    const [rangePart, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    let start = min;
    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [lo, hi] = rangePart.split('-').map(Number);
        // value must be in range and on step boundary from lo
        return value >= lo && value <= hi && (value - lo) % step === 0;
      }
      start = parseInt(rangePart, 10);
    }
    return value >= start && (value - start) % step === 0;
  }

  // List: 1,3,5
  if (field.includes(',')) {
    return field.split(',').map(s => parseInt(s.trim(), 10)).includes(value);
  }

  // Range: 1-5
  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(Number);
    return value >= lo && value <= hi;
  }

  // Exact match
  return parseInt(field, 10) === value;
}

/**
 * Convert a Date to a specific timezone and extract time components.
 * @param {Date} date
 * @param {string} timezone - IANA timezone name (e.g. 'Europe/Moscow')
 * @returns {{ minute: number, hour: number, dayOfMonth: number, month: number, dayOfWeek: number }}
 */
function dateInTimezone(date, timezone) {
  try {
    const parts = {};
    const fmt = (opt) => new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...opt }).format(date);
    parts.minute = parseInt(fmt({ minute: 'numeric' }), 10);
    parts.hour = parseInt(fmt({ hour: 'numeric', hour12: false }), 10);
    // Intl may return 24 for midnight in some locales — normalise to 0
    if (parts.hour === 24) parts.hour = 0;
    parts.dayOfMonth = parseInt(fmt({ day: 'numeric' }), 10);
    parts.month = parseInt(fmt({ month: 'numeric' }), 10);
    // getDay()-equivalent via Intl: format the date and parse the weekday
    const weekdayStr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    parts.dayOfWeek = dayMap[weekdayStr] ?? date.getDay();
    return parts;
  } catch {
    // Fallback to system-local time if timezone is invalid
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay()
    };
  }
}

/**
 * Check if a standard 5-field cron expression matches the given date.
 *
 * Fields: minute hour day-of-month month day-of-week
 *   minute:       0-59
 *   hour:         0-23
 *   day-of-month: 1-31
 *   month:        1-12
 *   day-of-week:  0-7  (0 and 7 both mean Sunday)
 *
 * @param {string} cronExpression - e.g. "0 8 * * *"
 * @param {Date}   date           - The date/time to check against
 * @param {string} [timezone]     - Optional IANA timezone name
 * @returns {boolean}
 */
function matchesCron(cronExpression, date, timezone) {
  if (!cronExpression || typeof cronExpression !== 'string') return false;

  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  // Use timezone-aware extraction if a timezone is provided
  const { minute, hour, dayOfMonth, month, dayOfWeek } = timezone
    ? dateInTimezone(date, timezone)
    : {
        minute: date.getMinutes(),
        hour: date.getHours(),
        dayOfMonth: date.getDate(),
        month: date.getMonth() + 1,
        dayOfWeek: date.getDay()
      };

  if (!cronFieldMatches(parts[0], minute, 0, 59))       return false;
  if (!cronFieldMatches(parts[1], hour, 0, 23))          return false;
  if (!cronFieldMatches(parts[2], dayOfMonth, 1, 31))    return false;
  if (!cronFieldMatches(parts[3], month, 1, 12))          return false;

  // Day-of-week: normalise 7 to 0 (Sunday) when parsing the cron field
  const dowField = parts[4].replace(/\b7\b/g, '0');
  if (!cronFieldMatches(dowField, dayOfWeek, 0, 6))      return false;

  return true;
}

export {
  cronFieldMatches,
  dateInTimezone,
  matchesCron,
};
