// @vitest-environment node
import '../../../../test/setup.js';
import { describe, expect, it, vi } from 'vitest';
import { dispatchRowChange, subscribeTable } from '../tableRowEventsController.js';

const envelope = (table_id, row_id, action) =>
  JSON.stringify({ table_id, row_id, action, source: 'api', ts: '2026-10-20T06:00:00Z' });

describe('row-events SSE dispatch — one NOTIFY reaches exactly the table’s subscribers', () => {
  it('writes an `event: row.<action>` frame to every subscriber of that table only', () => {
    const seven = vi.fn();
    const sevenToo = vi.fn();
    const eight = vi.fn();
    const off7 = subscribeTable('7', seven);
    const off7b = subscribeTable(7, sevenToo);
    const off8 = subscribeTable(8, eight);

    expect(dispatchRowChange(envelope(7, 1, 'updated'))).toBe(2);
    const frame = seven.mock.calls[0][0];
    expect(frame.startsWith('event: row.updated\ndata: ')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(JSON.parse(frame.slice(frame.indexOf('data: ') + 6).trim())).toMatchObject({ table_id: 7, row_id: '1' });
    expect(sevenToo).toHaveBeenCalledTimes(1);
    expect(eight).not.toHaveBeenCalled();

    off7(); off7b(); off8();
    expect(dispatchRowChange(envelope(7, 1, 'updated'))).toBe(0);
  });

  it('drops malformed payloads and survives a dead subscriber', () => {
    const dead = vi.fn(() => { throw new Error('socket closed'); });
    const alive = vi.fn();
    const offDead = subscribeTable(9, dead);
    const offAlive = subscribeTable(9, alive);
    expect(dispatchRowChange('{"table_id":9}')).toBe(0);
    expect(dispatchRowChange(envelope(9, 5, 'deleted'))).toBe(1);
    expect(alive).toHaveBeenCalledTimes(1);
    offDead(); offAlive();
  });
});
