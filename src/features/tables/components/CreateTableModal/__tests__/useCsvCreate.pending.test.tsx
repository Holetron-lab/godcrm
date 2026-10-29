import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvCreate } from '../useCsvCreate';

const mutation = vi.hoisted(() => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../hooks/useCreateTable', () => ({ useCreateTable: () => mutation }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const params: Parameters<typeof useCsvCreate>[0] = {
  csvFiles: [], csvFilesBeforeNotionImport: null, targetProjectId: 1, useFirstRowAsHeaders: true,
  setCsvCreating: vi.fn(), setCsvStep: vi.fn(), resetState: vi.fn(), onOpenChange: vi.fn(),
  tableType: 'local', basic: { displayName: 'Orders', name: 'orders', description: '', icon: '', color: '' },
  derivedName: 'orders', hierarchy: { mode: 'flat' }, columns: [], selectedDataSource: '',
  selectedExternalTable: '', selectedRelatedTables: [], showInMenu: false, menuWidgetTitle: '',
  menuWidgetIcon: '', menuWidgetDescription: '', slugify: value => value,
};

describe('Table creation pending guard', () => {
  beforeEach(() => { mutation.isPending = false; mutation.mutateAsync.mockClear(); });

  it('does not submit another table while a mutation is pending', async () => {
    mutation.isPending = true;
    const { result } = renderHook(() => useCsvCreate(params));
    await result.current.handleSubmit();
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('allows submission again after the pending mutation settles', async () => {
    mutation.isPending = true;
    const { result, rerender } = renderHook(() => useCsvCreate(params));
    mutation.isPending = false;
    rerender();
    await result.current.handleSubmit();
    expect(mutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'orders', projectId: 1 }));
  });
});
