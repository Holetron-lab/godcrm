import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { useWidgetTableControls } from '../hooks/useWidgetTableControls';
import type { Widget } from '../types/widget.types';

const mocks = vi.hoisted(() => ({ getColumns: vi.fn(), updateRow: vi.fn(), updateWidget: vi.fn(), toast: vi.fn(), readOnly: false }));
vi.mock('@/features/public/PublicViewContext', () => ({ useIsPublicReadOnly: () => mocks.readOnly }));
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getColumns: mocks.getColumns, updateRow: mocks.updateRow } }));
vi.mock('../api/widgetsApi', () => ({ updateWidget: mocks.updateWidget }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: mocks.toast }));
const widget = { id: 12, preset_name: 'table_view', config: { table_id: 45, editable_columns: ['name'], filters: [{column:'state',operator:'eq',value:'open'}] } } as Widget;
beforeEach(() => {
  vi.clearAllMocks(); mocks.readOnly = false;
  mocks.getColumns.mockResolvedValue({columns:[{name:'name',type:'text'}]});
  mocks.updateRow.mockResolvedValue({});
  mocks.updateWidget.mockResolvedValue(widget);
});
describe('widget column writes', () => {
  it('persists visibility in widget config, preserving unrelated settings', async () => {
    const {result} = renderHook(() => useWidgetTableControls(widget), {wrapper:ProvidersWrapper});
    await act(() => result.current.onConfigChange({hidden_columns:['name']}));
    expect(mocks.updateWidget).toHaveBeenCalledWith(12,{config:{...widget.config,hidden_columns:['name']}});
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it('rechecks the schema and patches only the edited field', async () => {
    const {result} = renderHook(() => useWidgetTableControls(widget), {wrapper:ProvidersWrapper});
    await result.current.onCellUpdate('7','name','New');
    expect(mocks.getColumns).toHaveBeenCalledWith('45');
    expect(mocks.updateRow).toHaveBeenCalledWith('45','7',{name:'New'});
  });
  it('refuses a column that became readonly and propagates save failures', async () => {
    const {result} = renderHook(() => useWidgetTableControls(widget), {wrapper:ProvidersWrapper});
    mocks.getColumns.mockResolvedValue({columns:[{name:'name',type:'text',isReadonly:true}]});
    await expect(result.current.onCellUpdate('7','name','New')).rejects.toThrow('только для чтения');
    expect(mocks.updateRow).not.toHaveBeenCalled();
    mocks.getColumns.mockRejectedValue(new Error('Schema unavailable'));
    await expect(result.current.onCellUpdate('7','name','New')).rejects.toThrow('Schema unavailable');
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it('prevents public writes even with saved active columns', async () => {
    mocks.readOnly = true;
    const {result} = renderHook(() => useWidgetTableControls(widget), {wrapper:ProvidersWrapper});
    await result.current.onConfigChange({hidden_columns:['name']});
    await expect(result.current.onCellUpdate('7','name','New')).rejects.toThrow('заблокировано');
    expect(mocks.updateWidget).not.toHaveBeenCalled();
    expect(mocks.getColumns).not.toHaveBeenCalled();
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it('reports config save failure and clears pending state', async () => {
    mocks.updateWidget.mockRejectedValue(new Error('Denied'));
    const {result} = renderHook(() => useWidgetTableControls(widget), {wrapper:ProvidersWrapper});
    await act(() => result.current.onConfigChange({hidden_columns:['name']}));
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('Не удалось'), 'error');
    expect(result.current.saving).toBe(false);
  });
});
