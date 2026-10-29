import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { WidgetColumnChecklist } from '../components/presets/WidgetColumnVisibility';

describe('widget visibility checklist', () => {
  it('shows hidden columns in edit settings and restores a legacy excluded column', () => {
    const onChange = vi.fn();
    renderWithProviders(<WidgetColumnChecklist columns={[{name:'title'},{name:'status'},{name:'notes'}]} config={{visible_columns:['title','status'],hidden_columns:['status']}} onChange={onChange} />);
    expect(screen.getByRole('checkbox',{name:'title'})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:'status'})).not.toBeChecked();
    expect(screen.getByRole('checkbox',{name:'notes'})).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox',{name:'notes'}));
    expect(onChange).toHaveBeenCalledWith({visible_columns:[],hidden_columns:['status']});
  });
  it('allows hiding the last visible column without treating it as show all', () => {
    const onChange = vi.fn();
    renderWithProviders(<WidgetColumnChecklist columns={[{name:'title'}]} config={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox',{name:'title'}));
    expect(onChange).toHaveBeenCalledWith({visible_columns:[],hidden_columns:['title']});
  });
});
