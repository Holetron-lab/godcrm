import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderSelectionCheckbox } from '../HeaderSelectionCheckbox';
import { RowSelectionCheckbox } from '../RowSelectionCheckbox';

it.each([false, true])('toggles the table selection with Space (selected: %s)', async selected => {
  const user = userEvent.setup();
  const select = vi.fn();
  const deselect = vi.fn();
  render(<HeaderSelectionCheckbox isAllSelected={selected} isIndeterminate={false} onSelectAll={select} onDeselectAll={deselect} />);
  const bubbled = vi.fn();
  document.addEventListener('click', bubbled);
  const checkbox = screen.getByRole('checkbox', { name: 'Select all rows' });
  expect(checkbox).toHaveAttribute('aria-checked', String(selected));
  checkbox.focus();
  await user.keyboard(' ');
  document.removeEventListener('click', bubbled);
  expect(selected ? deselect : select).toHaveBeenCalledOnce();
  expect(bubbled).not.toHaveBeenCalled();
});

it('exposes mixed selection and clears it without selecting all', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const deselect = vi.fn();
  render(<HeaderSelectionCheckbox isAllSelected={false} isIndeterminate onSelectAll={select} onDeselectAll={deselect} />);
  const checkbox = screen.getByRole('checkbox', { name: 'Select all rows' });
  expect(checkbox).toBePartiallyChecked();
  await user.click(checkbox);
  expect(deselect).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
});

it('selects a row with Space and exposes quick actions to keyboard users', async () => {
  const user = userEvent.setup();
  const toggle = vi.fn();
  const edit = vi.fn();
  render(<><RowSelectionCheckbox rowId={7} isSelected={false} onToggle={toggle} quickActions={[{ icon: '✎', title: 'Edit row', onClick: edit }]} /><button>Outside</button></>);
  await user.tab();
  await user.keyboard(' ');
  expect(toggle).toHaveBeenCalledWith(7);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Edit row' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(edit).toHaveBeenCalledOnce();
  expect(toggle).toHaveBeenCalledOnce();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Edit row' })).not.toBeInTheDocument();
});

it('does not toggle disabled row or header controls', async () => {
  const user = userEvent.setup();
  const action = vi.fn();
  render(<><HeaderSelectionCheckbox isAllSelected={false} isIndeterminate={false} onSelectAll={action} onDeselectAll={action} disabled /><RowSelectionCheckbox rowId={7} isSelected={false} onToggle={action} disabled /></>);
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
  }
  expect(action).not.toHaveBeenCalled();
});
