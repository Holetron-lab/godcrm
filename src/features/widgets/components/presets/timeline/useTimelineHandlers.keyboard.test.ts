import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTimelineHandlers } from './useTimelineHandlers';
import type { TimelineItem } from './types';

const item: TimelineItem = {
  id: '42', row: { id: 42, data: { starts: '2026-09-10', ends: '2026-09-12' } }, title: 'Task', description: null, group: null,
  color: '#fff', progress: null, startDate: new Date(2026, 8, 10), endDate: new Date(2026, 8, 12),
};
function setup(edgesMode = false) {
  const update = vi.fn();
  const hook = renderHook(() => useTimelineHandlers({
    timeScale: 'day', viewStartDate: new Date(2026, 8, 1), setViewStartDate: vi.fn(), totalUnits: 30,
    timelineRef: { current: null }, startDateColumn: 'starts', endDateColumn: 'ends',
    dependencyColumn: undefined, displayItems: [item], onEventSave: update,
    edgesMode, getPositionForDate: () => 0, currentTime: new Date(2026, 8, 10),
  }));
  return { update, result: hook.result };
}
describe('timeline keyboard dates', () => {
  it('moves both configured date fields without mutating cached data', async () => {
    const { update, result } = setup();
    await act(async () => { await result.current.handleKeyboardUpdate(item, 'move', 1); });
    expect(update.mock.calls).toEqual([['42', { starts: '2026-09-11', ends: '2026-09-13' }]]);
    expect(item.startDate.getDate()).toBe(10);
  });
  it('resizes only one edge and refuses inverted ranges', async () => {
    const { update, result } = setup();
    await act(async () => { await result.current.handleKeyboardUpdate(item, 'resize-start', -1); });
    expect(update.mock.calls).toEqual([['42', { starts: '2026-09-09' }]]);
    update.mockClear();
    result.current.handleKeyboardUpdate({ ...item, startDate: new Date(2026, 8, 11) }, 'resize-start', 1);
    expect(update).not.toHaveBeenCalled();
  });
  it('does not change dates in edge-connection mode', async () => {
    const { update, result } = setup(true);
    await act(async () => { await result.current.handleKeyboardUpdate(item, 'move', 1); });
    expect(update).not.toHaveBeenCalled();
  });
});
