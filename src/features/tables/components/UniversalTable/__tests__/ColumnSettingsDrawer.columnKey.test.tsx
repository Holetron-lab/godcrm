import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ColumnSettingsDrawer } from '../ColumnSettingsDrawer';
import { createMockColumn, renderWithProviders } from './columnSettingsTestUtils';

vi.mock('@/features/projects/hooks/useProjectTables', () => ({
  useProjectTables: vi.fn(() => ({ tables: [], isLoading: false })),
}));

describe('ColumnSettingsDrawer column key', () => {
  const onSave = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  const renderDrawer = () => {
    const column = createMockColumn({ name: 'цууца', displayName: 'efefef' });
    renderWithProviders(<ColumnSettingsDrawer column={column} open={true} onOpenChange={vi.fn()} onSave={onSave} />);
    return column;
  };

  it('sends the edited key in the save payload', async () => {
    const column = renderDrawer();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Allow editing' }));
    const keyInput = screen.getByPlaceholderText('column_key');
    await userEvent.clear(keyInput);
    await userEvent.type(keyInput, 'efefef');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(column.id, expect.objectContaining({ name: 'efefef', displayName: 'efefef' }));
  });

  it('omits the key when it was not changed', async () => {
    const column = renderDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(column.id, expect.not.objectContaining({ name: expect.anything() }));
  });
});
