import { beforeEach, expect, it, vi } from 'vitest';
import { createHandleCreatePresetColumn } from '../useWidgetSettingsHandlers';
import { tablesApi } from '@/features/tables/api/tablesApi';
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getColumns: vi.fn(), createColumn: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
function setup() {
  const deps = { selectedTableId: '17', setCreatingColumn: vi.fn(), setColumns: vi.fn(), setColorColumn: vi.fn(), setStatusColumn: vi.fn(), setAssigneeColumn: vi.fn(), setTimelineDependsOnColumn: vi.fn(), setTimelineGroupByColumn: vi.fn() };
  return { deps, create: createHandleCreatePresetColumn(deps) };
}
it('refreshes columns and selects the new assignee in settings', async () => {
  const { deps, create } = setup();
  vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns: [], userRole: 'owner' });
  await create('assignee');
  expect(deps.setAssigneeColumn).toHaveBeenCalledWith('assignee');
  expect(deps.setColumns).toHaveBeenCalled();
  expect(deps.setCreatingColumn.mock.calls).toEqual([[true], [false]]);
});
it('keeps the previous mapping on failure and enables retry', async () => {
  const { deps, create } = setup();
  vi.mocked(tablesApi.getColumns).mockRejectedValueOnce(new Error('Denied'));
  await create('assignee');
  expect(deps.setAssigneeColumn).not.toHaveBeenCalled();
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Denied'));
  expect(deps.setCreatingColumn).toHaveBeenLastCalledWith(false);
});
