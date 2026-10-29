import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AutomationModal } from '../AutomationModal';

const create = vi.fn();
vi.mock('@/features/automations/api/automationsApi', () => ({
  automationsApi: { create: (...args: unknown[]) => create(...args) },
}));

describe('TableFilters AutomationModal', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: '1' });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('offers only triggers the engine executes for a field change (row_update, not column_change)', () => {
    render(<AutomationModal open onOpenChange={vi.fn()} tableId="101024" />);
    const select = screen.getByLabelText('Триггер (когда запускать)') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).not.toContain('column_change');
    expect(values).toContain('row_update');
    expect(select.value).toBe('row_update');
  });

  it('creates a row_update automation carrying the watched column key', async () => {
    render(<AutomationModal open onOpenChange={vi.fn()} tableId="101024" />);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Статус → webhook' } });
    fireEvent.change(screen.getByLabelText('Отслеживаемое поле (ключ колонки)'), { target: { value: 'status' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      table_id: 101024,
      trigger_type: 'row_update',
      trigger_config: { watch_field: 'status' },
    });
  });
});
