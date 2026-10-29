import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationModal } from '../AutomationModal';

// The engine (backend/services/AutomationTriggerService.js) executes only
// row_create, row_update and schedule. `column_change` was offered first in
// the UI but never fired — chat 3660, 2026-10-20.

vi.mock('@/features/projects/hooks/useProjectTables', () => ({
  useProjectTables: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({
  useSpacesQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/projects/store/projectStore', () => ({
  useProjectStore: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] }),
}));

const renderModal = (onSave = vi.fn()) => {
  render(<AutomationModal tableId="101024" onClose={vi.fn()} onSave={onSave} language="ru" />);
  return { onSave };
};

describe('AutomationModal trigger choices', () => {
  it('does not offer the dead column_change trigger and defaults to row_update', () => {
    renderModal();
    const select = screen.getByLabelText('Триггер (когда запускать)') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).not.toContain('column_change');
    expect(select.value).toBe('row_update');
    // The watched-field input belongs to row_update and is visible straight away.
    expect(screen.getByLabelText('Отслеживаемое поле (ключ колонки)')).toBeInTheDocument();
  });

  it('saves a new automation as row_update with the watched field', () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Отправить в n8n|Например/), { target: { value: 'Статус → цвет' } });
    fireEvent.change(screen.getByLabelText('Отслеживаемое поле (ключ колонки)'), { target: { value: 'status' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      triggerType: 'row_update',
      triggerConfig: { watch_field: 'status' },
    });
  });
});
