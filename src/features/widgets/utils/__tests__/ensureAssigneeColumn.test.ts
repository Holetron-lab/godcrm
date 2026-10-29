import { beforeEach, expect, it, vi } from 'vitest';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { ensureAssigneeColumn } from '../ensureAssigneeColumn';
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getColumns: vi.fn(), createColumn: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
it('creates a person column when missing', async () => {
  vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns: [], userRole: 'owner' });
  await expect(ensureAssigneeColumn('17')).resolves.toBe('assignee');
  expect(tablesApi.createColumn).toHaveBeenCalledWith('17', expect.objectContaining({ name: 'assignee', type: 'user' }));
});
it('reuses an existing assignee without changing its schema', async () => {
  vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns: [{ name: 'assigned_to', type: 'multi-select' }] as never, userRole: 'owner' });
  await expect(ensureAssigneeColumn('17')).resolves.toBe('assigned_to');
  expect(tablesApi.createColumn).not.toHaveBeenCalled();
});
it('propagates failure without claiming a mapping exists', async () => {
  vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns: [], userRole: 'owner' });
  vi.mocked(tablesApi.createColumn).mockRejectedValueOnce(new Error('Forbidden'));
  await expect(ensureAssigneeColumn('17')).rejects.toThrow('Forbidden');
});
it('avoids collisions and reuses the generated name on retry', async () => {
  vi.mocked(tablesApi.getColumns).mockResolvedValueOnce({ columns: [{ name: 'assignee', type: 'number' }] as never, userRole: 'owner' });
  await expect(ensureAssigneeColumn('17')).resolves.toBe('assignee_2');
  vi.mocked(tablesApi.getColumns).mockResolvedValueOnce({ columns: [{ name: 'assignee', type: 'number' }, { name: 'assignee_2', type: 'user' }] as never, userRole: 'owner' });
  await expect(ensureAssigneeColumn('17')).resolves.toBe('assignee_2');
  expect(tablesApi.createColumn).toHaveBeenCalledTimes(1);
});
