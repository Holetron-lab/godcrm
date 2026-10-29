import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '@/features/tables/api/tablesApi';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { ColumnSettingsDrawer } from '../ColumnSettingsDrawer';
import { createSelectColumn, openTab, renderWithProviders, TABS } from './columnSettingsTestUtils';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
vi.mock('@/features/projects/hooks/useProjectTables', () => ({ useProjectTables: () => ({ data: [] }) }));
vi.mock('@/features/tables/hooks/useAllTables', () => ({ useAllTables: () => ({ data: undefined }) }));

const phases = Array.from({ length: 8 }, (_, index) => `Phase ${index}`);
const legacyOptions = [...phases, { label: 'Cycle', color: '#ef4444' }, {
  label: 'Run', value: 'run', color: '#14b8a6',
  children: [{ label: 'Child', value: 'child', color: '#22c55e' }, 'Nested legacy'],
}];
const expectedOptions = [
  ...phases.map(value => ({ label: value, value })),
  { label: 'Cycle', value: 'Cycle', color: '#ef4444' },
  { label: 'Run', value: 'run', color: '#14b8a6', children: [
    { label: 'Child', value: 'child', color: '#22c55e' },
    { label: 'Nested legacy', value: 'Nested legacy' },
  ] },
];
const backendColumn = (options: unknown) => ({
  id: 18901, table_id: 1708, name: 'phase', column_type: 'select', config: { options },
});
const page = (number: number, values: string[]) => ({ data: {
  rows: values.map((phase, index) => ({ id: `${number}-${index}`, data: { phase } })),
  pagination: { page: number, limit: 500, total: 827, pages: 2 },
} });

describe('QA-3660 persisted legacy options', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem('god-crm-language', 'en');
  });

  it.each([false, true])('normalizes API config (JSON string: %s), preserving nested metadata and valid empty/zero values', async (serialized) => {
    const config = { options: [...legacyOptions, 0, '', { label: '', value: 0 }, { label: 'Empty', value: '' }], storageFormat: 'json' };
    const original = JSON.stringify(config);
    vi.mocked(apiClient.request).mockResolvedValue({ data: [{ ...backendColumn([]), config: serialized ? original : config }] });
    const { columns } = await tablesApi.getColumns('1708');
    expect(columns[0].config).toEqual({ storageFormat: 'json', options: [
      ...expectedOptions, { label: '0', value: '0' }, { label: '', value: '' },
      { label: '', value: '0' }, { label: 'Empty', value: '' },
    ] });
    expect(JSON.stringify(config)).toBe(original);
  });

  it.each(['api', 'schema'] as const)('renders and collects legacy options through the %s entry without duplicates or draft loss', async (entry) => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({ data: [backendColumn(legacyOptions)] });
    // Schema/table editors can supply parsed config directly instead of using tablesApi.
    const column = entry === 'api' ? (await tablesApi.getColumns('1708')).columns[0] : createSelectColumn({
      id: '18901', tableId: '1708', name: 'phase',
      config: { options: legacyOptions } as unknown as ColumnModel['config'],
    });
    vi.mocked(apiClient.request).mockReset();
    const original = JSON.stringify(column);
    const onSave = vi.fn();
    renderWithProviders(<ColumnSettingsDrawer column={column} open onOpenChange={vi.fn()} onSave={onSave} />);
    await openTab(TABS.TYPE);
    const labels = () => screen.getAllByRole('textbox', { name: 'Label' });
    expect(labels()).toHaveLength(12);
    phases.forEach((phase, index) => expect(labels()[index]).toHaveValue(phase));
    const cycleLabel = labels()[8];
    await userEvent.clear(cycleLabel);
    await userEvent.type(cycleLabel, 'Edited cycle');
    const collect = () => screen.getByRole('button', { name: /Collect from entire table/ });
    vi.mocked(apiClient.request).mockResolvedValueOnce(page(1, [...phases, 'new']))
      .mockRejectedValueOnce(new Error('late page failure'));
    await userEvent.click(collect());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not collect');
    expect(labels()).toHaveLength(12);
    for (let attempt = 0; attempt < 2; attempt++) {
      vi.mocked(apiClient.request).mockResolvedValueOnce(page(1, [...phases, 'new']))
        .mockResolvedValueOnce(page(2, ['Cycle', 'child', 'Nested legacy', 'new']));
      await userEvent.click(collect());
      await waitFor(() => expect(labels()).toHaveLength(13));
      await waitFor(() => expect(collect()).toBeEnabled());
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('18901', expect.objectContaining({ config: expect.objectContaining({ options: [
      ...expectedOptions.slice(0, 8), { ...expectedOptions[8], label: 'Edited cycle' }, expectedOptions[9],
      expect.objectContaining({ label: 'new', value: 'new' }),
    ] }) }));
    expect(JSON.stringify(column)).toBe(original);
    expect(apiClient.request).toHaveBeenCalledTimes(6);
  });
});
