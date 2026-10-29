// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../database/connection.js', () => ({ dbRun: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({ apiLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { dbRun } = await import('../../../database/connection.js');
const { apiLogger } = await import('../../../utils/logger.js');
const {
  ROW_EVENTS_CHANNEL, buildRowChangePayload, parseRowChangePayload, notifyRowChange, notifyRowChanges,
} = await import('../rowEvents.js');

describe('rowEvents — NOTIFY envelope', () => {
  beforeEach(() => {
    vi.mocked(dbRun).mockReset().mockResolvedValue({});
    vi.mocked(apiLogger.warn).mockClear();
  });

  it('builds a normalised envelope and rejects bad input', () => {
    const payload = buildRowChangePayload({ tableId: '7', rowId: 42, action: 'updated', source: 'automation' });
    expect(payload).toMatchObject({ table_id: 7, row_id: '42', action: 'updated', source: 'automation' });
    expect(typeof payload.ts).toBe('string');
    expect(buildRowChangePayload({ tableId: 7, rowId: 1 }).action).toBe('updated');
    expect(buildRowChangePayload({ tableId: 'x', rowId: 1 })).toBeNull();
    expect(buildRowChangePayload({ tableId: 7, rowId: null })).toBeNull();
    expect(buildRowChangePayload({ tableId: 7, rowId: 1, action: 'exploded' })).toBeNull();
  });

  it('parses what it built and nothing else', () => {
    const raw = JSON.stringify(buildRowChangePayload({ tableId: 7, rowId: 1, action: 'deleted' }));
    expect(parseRowChangePayload(raw)).toMatchObject({ table_id: 7, row_id: '1', action: 'deleted' });
    expect(parseRowChangePayload('{')).toBeNull();
    expect(parseRowChangePayload('"str"')).toBeNull();
    expect(parseRowChangePayload(undefined)).toBeNull();
  });

  it('publishes on the single channel via pg_notify', async () => {
    await expect(notifyRowChange({ tableId: 7, rowId: 1, action: 'created', source: 'api' })).resolves.toBe(true);
    expect(dbRun).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(dbRun).mock.calls[0];
    expect(sql).toBe('SELECT pg_notify($1, $2)');
    expect(params[0]).toBe(ROW_EVENTS_CHANNEL);
    expect(JSON.parse(params[1])).toMatchObject({ table_id: 7, row_id: '1', action: 'created', source: 'api' });
  });

  it('never throws: a failed NOTIFY is logged and the write proceeds', async () => {
    vi.mocked(dbRun).mockRejectedValue(new Error('connection lost'));
    await expect(notifyRowChange({ tableId: 7, rowId: 1 })).resolves.toBe(false);
    expect(apiLogger.warn).toHaveBeenCalledTimes(1);
    await expect(notifyRowChange({ tableId: 'nope', rowId: 1 })).resolves.toBe(false);
    expect(dbRun).toHaveBeenCalledTimes(1);
  });

  it('fans a batch out as one NOTIFY per row', async () => {
    notifyRowChanges(7, [1, 2, 3], 'deleted', 'api');
    await Promise.resolve();
    expect(dbRun).toHaveBeenCalledTimes(3);
    expect(JSON.parse(vi.mocked(dbRun).mock.calls[2][1][1])).toMatchObject({ row_id: '3', action: 'deleted' });
  });
});
