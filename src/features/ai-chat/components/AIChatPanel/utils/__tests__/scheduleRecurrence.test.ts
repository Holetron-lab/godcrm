import { describe, expect, it } from 'vitest';
import {
  buildCron, describeCron, formatCronLabel, isCronShapeValid, isValidTimezone,
  type RecurrenceForm,
} from '../scheduleRecurrence';

const base: RecurrenceForm = { preset: 'none', hour: 9, minute: 0, weekdays: [], monthDay: 1, cron: '' };
const form = (patch: Partial<RecurrenceForm>): RecurrenceForm => ({ ...base, ...patch });

// ADR-208 AC 10: presets assemble a correct cron string.
describe('buildCron presets', () => {
  const presets: Array<[string, RecurrenceForm]> = [
    ['none', form({ preset: 'none' })],
    ['daily 09:00', form({ preset: 'daily' })],
    ['daily 18:30', form({ preset: 'daily', hour: 18, minute: 30 })],
    ['weekdays 09:00', form({ preset: 'weekdays' })],
    ['weekly Mon/Wed/Fri 10:15', form({ preset: 'weekly', hour: 10, minute: 15, weekdays: [1, 3, 5] })],
    ['weekly Sun maps to cron 0', form({ preset: 'weekly', weekdays: [7, 6] })],
    ['weekly no days', form({ preset: 'weekly', weekdays: [] })],
    ['monthly 1st 09:00', form({ preset: 'monthly', monthDay: 1 })],
    ['monthly 15th 23:45', form({ preset: 'monthly', monthDay: 15, hour: 23, minute: 45 })],
    ['cron free-form', form({ preset: 'cron', cron: '  */15  *  * * *  ' })],
    ['cron invalid', form({ preset: 'cron', cron: 'every day' })],
  ];

  it('matches the recorded cron table', () => {
    expect(Object.fromEntries(presets.map(([label, f]) => [label, buildCron(f)]))).toMatchSnapshot();
  });

  it('builds the documented shapes', () => {
    expect(buildCron(form({ preset: 'daily' }))).toBe('0 9 * * *');
    expect(buildCron(form({ preset: 'weekdays', hour: 8, minute: 5 }))).toBe('5 8 * * 1-5');
    expect(buildCron(form({ preset: 'weekly', weekdays: [5, 1, 3, 1] }))).toBe('0 9 * * 1,3,5');
    expect(buildCron(form({ preset: 'weekly', weekdays: [7] }))).toBe('0 9 * * 0');
    expect(buildCron(form({ preset: 'monthly', monthDay: 31 }))).toBe('0 9 31 * *');
    expect(buildCron(form({ preset: 'none' }))).toBeNull();
    expect(buildCron(form({ preset: 'weekly' }))).toBeNull();
    expect(buildCron(form({ preset: 'cron', cron: '0 */2 * * *' }))).toBe('0 */2 * * *');
    expect(buildCron(form({ preset: 'cron', cron: '0 9 * *' }))).toBeNull();
  });

  it('round-trips every preset through describeCron', () => {
    for (const [, f] of presets) {
      const cron = buildCron(f);
      if (cron === null || f.preset === 'cron') continue;
      const described = describeCron(cron);
      expect(described, cron).not.toBeNull();
      expect(described?.key).toContain(f.preset === 'weekly' ? 'cronWeekly' : `cron${f.preset[0].toUpperCase()}${f.preset.slice(1)}`);
    }
  });
});

describe('describeCron / formatCronLabel', () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    `${key.replace(/^.*\./, '')}${params ? JSON.stringify(params) : ''}`;

  it('describes preset shapes with time and days', () => {
    expect(describeCron('0 9 * * *')).toEqual({ key: 'aiChat.ui.cronDaily', params: { time: '09:00' } });
    expect(describeCron('30 18 * * 1-5')).toEqual({ key: 'aiChat.ui.cronWeekdays', params: { time: '18:30' } });
    expect(describeCron('0 9 * * 0,3')).toEqual({ key: 'aiChat.ui.cronWeekly', params: { time: '09:00' }, weekdays: [3, 7] });
    expect(describeCron('0 9 15 * *')).toEqual({ key: 'aiChat.ui.cronMonthly', params: { day: 15, time: '09:00' } });
    expect(describeCron('*/15 * * * *')).toEqual({ key: 'aiChat.ui.cronEveryMinutes', params: { count: 15 } });
    expect(describeCron('* * * * *')).toEqual({ key: 'aiChat.ui.cronEveryMinute' });
    expect(describeCron('5 */2 * * *')).toEqual({ key: 'aiChat.ui.cronEveryHours', params: { count: 2, minute: '05' } });
  });

  it('falls back to the raw expression for non-preset crons', () => {
    expect(describeCron('0 9 1 6 *')).toBeNull();
    expect(describeCron('0 9,18 * * *')).toBeNull();
    expect(describeCron('0 9 * * 1-3')).toBeNull();
    expect(formatCronLabel('0 9,18 * * *', t)).toBe('0 9,18 * * *');
  });

  it('renders weekday labels through the translator', () => {
    expect(formatCronLabel('0 9 * * 1,5', t)).toBe('cronWeekly{"time":"09:00","days":"mon, fri"}');
    expect(formatCronLabel('0 9 * * *', t)).toBe('cronDaily{"time":"09:00"}');
  });
});

describe('validation helpers', () => {
  it('checks the 5-field cron shape only', () => {
    expect(isCronShapeValid('0 9 * * 1-5')).toBe(true);
    expect(isCronShapeValid('0 9 * *')).toBe(false);
    expect(isCronShapeValid('0 9 * * MON')).toBe(false);
    expect(isCronShapeValid('rm -rf /')).toBe(false);
  });

  it('accepts IANA zones and rejects garbage', () => {
    expect(isValidTimezone('Europe/Moscow')).toBe(true);
    expect(isValidTimezone('Asia/Almaty')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});
