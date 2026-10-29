import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberColumnSettings } from '../NumberColumnSettings';
import type { ColumnModel, NumberColumnConfig } from '@/features/tables/types/table.types';

const column: ColumnModel = {
  id: 'amount', tableId: '1', name: 'amount', displayName: 'Amount', type: 'number',
  config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 150, isVisible: true,
};

describe('NumberColumnSettings accessibility', () => {
  it.each<NonNullable<NumberColumnConfig['displayStyle']>>(['default', 'progress', 'badge', 'rating', 'slider'])(
    'names every native control in the %s editor', (displayStyle) => {
      const { container } = render(<NumberColumnSettings
        draft={{ ...column, config: { number: { displayStyle, showStepButtons: true, stepButtonColorType: 'fixed' } } }}
        setDraft={vi.fn()}
      />);
      for (const control of container.querySelectorAll('input, select, button')) {
        expect(control).toHaveAccessibleName();
      }
    },
  );

  it('keeps the labels attached when selecting column-based values', () => {
    render(<NumberColumnSettings draft={{ ...column, config: { number: {
      minType: 'column', maxType: 'column', prefixType: 'column', suffixType: 'column',
      showStepButtons: true, stepButtonColorType: 'column',
    } } }} setDraft={vi.fn()} />);
    for (const label of ['Минимум', 'Максимум', 'Префикс', 'Суффикс', 'Колонка цвета кнопок']) {
      expect(screen.getByLabelText(label)).toHaveRole('combobox');
    }
  });

  it('uses unique labels for simultaneous editors and preserves updates', () => {
    const setDraft = vi.fn();
    const { container } = render(<>
      <NumberColumnSettings draft={column} setDraft={setDraft} />
      <NumberColumnSettings draft={column} setDraft={vi.fn()} />
    </>);
    const ids = [...container.querySelectorAll('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.change(screen.getAllByLabelText('Минимум')[0], { target: { value: '12' } });
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ config: { number: { min: 12 } } }));
    const toggle = screen.getAllByRole('button', { name: 'Кнопки увеличения и уменьшения' })[0];
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(setDraft).toHaveBeenLastCalledWith(expect.objectContaining({ config: { number: { showStepButtons: true } } }));
  });
});
