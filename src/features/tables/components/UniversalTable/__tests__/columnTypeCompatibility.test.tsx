import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { COLUMN_TYPE_ALIASES } from '../../../../../../shared/column-types.js';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { renderCellValue } from '../renderCellValue';
import { ColumnSettingsDrawer } from '../ColumnSettingsDrawer';
import { createMockColumn, renderWithProviders, openTab, TABS } from './columnSettingsTestUtils';

vi.mock('@/features/projects/hooks/useProjectTables', () => ({
  useProjectTables: () => ({ tables: [], isLoading: false }),
}));

describe('column type reader compatibility', () => {
  it.each(Object.entries(COLUMN_TYPE_ALIASES))('renders %s like %s without rewriting the column', (alias, canonical) => {
    const column = createMockColumn({ type: alias as ColumnModel['type'] });
    const options = { column, value: '{"text":"first\\nsecond"}', rawMode: true, rows: [], rowMutation: {} };
    expect(renderCellValue(options)).toEqual(renderCellValue({ ...options, column: { ...column, type: canonical as ColumnModel['type'] } }));
    expect(column.type).toBe(alias);
  });

  it.each(['person', 'user'])('opens person settings for persisted %s', async type => {
    renderWithProviders(<ColumnSettingsDrawer column={createMockColumn({ type: type as ColumnModel['type'] })}
      open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await openTab(TABS.TYPE);
    expect(screen.getByRole('heading', { name: /Настройки пользователя/ })).toBeVisible();
  });

  it.each(['checkbox', 'boolean'])('opens checkbox settings for persisted %s', async type => {
    renderWithProviders(<ColumnSettingsDrawer column={createMockColumn({ type: type as ColumnModel['type'] })}
      open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    await openTab(TABS.TYPE);
    expect(screen.getByText(/Checkbox settings|Настройки чекбокса/)).toBeVisible();
  });
});
