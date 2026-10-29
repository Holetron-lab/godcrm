import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTimelineHandlers } from './useTimelineHandlers';
import type { TimelineItem } from './types';

const original = { starts: '2026-09-30T09:00:00.000Z', ends: '2026-10-02T09:00:00.000Z' };
function item(data = original): TimelineItem {
  return { id: '42', row: { id: 42, data }, title: 'Task', description: null, group: null,
    color: '#fff', progress: null, startDate: new Date(data.starts), endDate: new Date(data.ends) };
}
function setup(save: (id: string, fields: Record<string, unknown>) => Promise<void>) {
  const update = vi.fn();
  const timeline = document.createElement('div');
  vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect);
  const hook = renderHook(() => useTimelineHandlers({
    timeScale: 'day', viewStartDate: new Date('2026-09-01'), setViewStartDate: vi.fn(), totalUnits: 30,
    timelineRef: { current: timeline }, startDateColumn: 'starts', endDateColumn: 'ends',
    dependencyColumn: undefined, displayItems: [], onEventUpdate: update, onEventSave: save,
    edgesMode: false, getPositionForDate: () => 0, currentTime: new Date('2026-09-30'),
  }));
  return { ...hook, update };
}
describe('timeline persistence', () => {
  it('saves both timestamps together across two moves and reopening', async () => {
    let stored = { ...original };
    const save = vi.fn(async (_id: string, fields: Record<string, unknown>) => { stored = { ...stored, ...fields }; });
    const first = setup(save);
    await act(async () => { await first.result.current.handleKeyboardUpdate(item(stored), 'move', -1); });
    expect(stored).toEqual({ starts: '2026-09-29T09:00:00.000Z', ends: '2026-10-01T09:00:00.000Z' });
    first.unmount();
    const reopened = setup(save);
    await act(async () => { await reopened.result.current.handleKeyboardUpdate(item(stored), 'move', -1); });
    expect(stored).toEqual({ starts: '2026-09-28T09:00:00.000Z', ends: '2026-09-30T09:00:00.000Z' });
    expect(new Date(stored.ends).getTime() - new Date(stored.starts).getTime()).toBe(2 * 86400000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(first.update).not.toHaveBeenCalled();
  });
  it('blocks rapid repeated actions synchronously and allows a later move', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result } = setup(save);
    let pending: unknown;
    act(() => {
      pending = result.current.handleKeyboardUpdate(item(), 'move', -1);
      void result.current.handleKeyboardUpdate(item(), 'move', -1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.isSaving).toBe(true);
    await act(async () => { finish(); await pending; });
    expect(result.current.isSaving).toBe(false);
    act(() => { void result.current.handleKeyboardUpdate(item(), 'move', -1); });
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
  });
  it('reports a rejected save, preserves cached dates, and permits retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = setup(save);
    const cached = item();
    await act(async () => { await result.current.handleKeyboardUpdate(cached, 'move', -1); });
    expect(result.current.saveError).toBeTruthy();
    expect(result.current.isSaving).toBe(false);
    expect(cached.startDate.toISOString()).toBe(original.starts);
    await act(async () => { await result.current.handleKeyboardUpdate(cached, 'move', -1); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.saveError).toBeNull();
  });
  it('persists a drag as one range without mutating cached dates', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, update } = setup(save);
    const cached = item();
    act(() => result.current.handleMouseDown({ clientX: 100, preventDefault() {}, stopPropagation() {} } as React.MouseEvent, cached, 'move'));
    act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 90 })));
    await act(async () => { window.dispatchEvent(new MouseEvent('mouseup')); });
    expect(save.mock.calls).toEqual([['42', { starts: '2026-09-29T09:00:00.000Z', ends: '2026-10-01T09:00:00.000Z' }]]);
    expect(cached.startDate.toISOString()).toBe(original.starts);
    expect(update).not.toHaveBeenCalled();
  });
});
