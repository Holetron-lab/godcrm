import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { loadSupplies } from './loadSupplies';
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getRows: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
describe('complete supply loading', () => {
  it('loads beyond the first page', async () => {
    vi.mocked(tablesApi.getRows).mockResolvedValueOnce({ rows: [{ id: '1', data: {}, tableId: '5', createdAt: '', updatedAt: '', createdBy: '1' }], pagination: { total: 2, page: 1, pages: 2, limit: 1 } }).mockResolvedValueOnce({ rows: [{ id: '2', data: {}, tableId: '5', createdAt: '', updatedAt: '', createdBy: '1' }], pagination: { total: 2, page: 2, pages: 2, limit: 1 } });
    expect(await loadSupplies(5)).toHaveLength(2);
    expect(tablesApi.getRows).toHaveBeenLastCalledWith('5', 2, 500, true, '__row_id', 'asc');
  });
  it('fails closed on a missing page or duplicate rows', async () => {
    vi.mocked(tablesApi.getRows).mockResolvedValue({ rows: [], pagination: { total: 2, page: 1, pages: 1, limit: 500 } });
    await expect(loadSupplies(5)).rejects.toThrow('все поставки');
    vi.mocked(tablesApi.getRows).mockResolvedValue({ rows: [{ id: '1', data: {}, tableId: '5', createdAt: '', updatedAt: '', createdBy: '1' }, { id: '1', data: {}, tableId: '5', createdAt: '', updatedAt: '', createdBy: '1' }], pagination: { total: 2, page: 1, pages: 1, limit: 500 } });
    await expect(loadSupplies(5)).rejects.toThrow('неполные');
  });
  it('does not hide network failures as empty data', async () => {
    vi.mocked(tablesApi.getRows).mockRejectedValue(new Error('Network error'));
    await expect(loadSupplies(5)).rejects.toThrow('Network error');
  });
});
