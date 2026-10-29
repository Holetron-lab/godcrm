// @vitest-environment node
/**
 * executeUpdateField `{{now}}` stamp.
 *
 * Guards the "task closed at" automation (Workspace 7826 / tasks 100843):
 * row_update watch_field=статус equals=Готово → update_field закрыто={{now}}.
 * A static `value` is written byte-for-byte as before; only the literal
 * `{{now}}` token resolves to the current ISO timestamp at execution time.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();

vi.mock('../../database/connection.js', () => ({
  dbGet: (...a) => dbGet(...a),
  dbRun: (...a) => dbRun(...a),
  dbAll: (...a) => dbAll(...a),
}));
vi.mock('../../utils/logger.js', () => ({ apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../SkillEnrichmentService.js', () => ({ enrichSkill: vi.fn() }));
vi.mock('../TelegramService.js', () => ({ sendMessage: vi.fn(), sendAdminAlert: vi.fn() }));
vi.mock('../schedule-trigger/pipeline-executors.js', () => ({ executeTicketRouting: vi.fn() }));

const { executeUpdateField } = await import('../AutomationTriggerService.js');

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  dbGet.mockResolvedValue({ id: 7, data: { 'статус': 'Готово' } });
  dbRun.mockResolvedValue({ changes: 1 });
});

function writtenData() {
  return JSON.parse(dbRun.mock.calls[0][1][0]);
}

describe('executeUpdateField {{now}}', () => {
  it('stamps the current ISO timestamp when value is the {{now}} token', async () => {
    const before = Date.now();
    const res = await executeUpdateField(100843, 7, { column_id: 'закрыто', value: '{{now}}' });
    const after = Date.now();

    expect(res.success).toBe(true);
    const stamped = writtenData()['закрыто'];
    expect(stamped).not.toBe('{{now}}');
    const ts = Date.parse(stamped);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    expect(res.updated['закрыто']).toBe(stamped);
  });

  it('stamps a YYYY-MM-DD Europe/Moscow date when value is the {{today}} token', async () => {
    // 21:30Z on Oct 1 is already Oct 2 in Moscow — the date column validator
    // (ColumnService.validateDate) accepts only YYYY-MM-DD, never an ISO stamp.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T21:30:00.000Z'));
    try {
      const res = await executeUpdateField(100855, 7, { column_id: 'закрыто', value: '{{today}}' });
      expect(res.success).toBe(true);
      expect(writtenData()['закрыто']).toBe('2026-10-02');
      expect(res.updated).toEqual({ 'закрыто': '2026-10-02' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes a static value unchanged', async () => {
    const res = await executeUpdateField(100843, 7, { column_id: 'статус', value: 'Готово' });
    expect(res.success).toBe(true);
    expect(writtenData()['статус']).toBe('Готово');
    expect(res.updated).toEqual({ 'статус': 'Готово' });
  });
});
