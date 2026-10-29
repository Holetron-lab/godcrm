import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import type { Widget } from '../../../types/widget.types';
import { KanbanWidget } from './KanbanWidget';
import type { ColumnInfo } from './kanban-types';

beforeEach(() => localStorage.setItem('god-crm-language', 'en'));
afterEach(cleanup);
const edit = vi.fn();
function Fixture({ readOnly = false, column = { name: 'colour', type: 'color' }, configured }: { readOnly?: boolean; column?: ColumnInfo; configured?: string }) {
  const [data, setData] = useState<Record<string, unknown>>({ title: 'Ticket', status: 'todo' });
  return <QueryClientProvider client={new QueryClient()}><LanguageProvider><PublicViewProvider readOnly={readOnly} publicSlug={null}>
    <KanbanWidget widget={{ id: 99, config: { statusColumn: 'status', kanban: { colorColumn: configured } } } as Widget}
      data={[{ id: 42, data }]} columnsInfo={[{ name: 'status', type: 'select', config: { options: [{ value: 'todo', label: 'Todo' }] } }, column]}
      columnOptions={[{ value: 'todo', label: 'Todo' }]} showToolbar={false}
      onOpenRowChat={vi.fn()} onAttachRowToMessage={vi.fn()}
      onCardUpdate={(id, field, value) => { edit(id, field, value); setData(current => ({ ...current, [field]: value })); }} />
  </PublicViewProvider></LanguageProvider></QueryClientProvider>;
}
it('auto-detects the existing colour field, selects and clears a color, and restores focus', async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  const trigger = screen.getByRole('button', { name: 'Card color' });
  trigger.focus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: '#ef4444' }));
  expect(edit).toHaveBeenLastCalledWith('42', 'colour', '#ef4444');
  expect(screen.getByText('Ticket').closest('.group')).toHaveStyle({ borderLeftColor: '#ef4444', borderLeftWidth: '4px' });
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard(' ');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: 'No color' }));
  expect(edit).toHaveBeenLastCalledWith('42', 'colour', null);
  expect(screen.getByText('Ticket').closest('.group')).not.toHaveStyle({ borderLeftWidth: '4px' });
  expect(screen.getByTitle('Chat')).toBeInTheDocument();
  expect(screen.getByTitle('Attach to message')).toBeInTheDocument();
});
it('saves custom hex using the native picker', async () => {
  render(<Fixture configured="colour" />);
  fireEvent.click(screen.getByRole('button', { name: 'Card color' }));
  fireEvent.change(screen.getByLabelText('Custom color'), { target: { value: '#123456' } });
  expect(edit).toHaveBeenLastCalledWith('42', 'colour', '#123456');
});
it('preserves select option values instead of writing raw hex', async () => {
  const user = userEvent.setup();
  render(<Fixture configured="label" column={{ name: 'label', type: 'select', config: { options: [{ value: 'urgent', label: 'Urgent', color: '#ef4444' }] } }} />);
  await user.click(screen.getByRole('button', { name: 'Card color' }));
  await user.click(screen.getByRole('button', { name: 'Urgent' }));
  expect(edit).toHaveBeenLastCalledWith('42', 'label', 'urgent');
  expect(screen.getByText('Ticket').closest('.group')).toHaveStyle({ borderLeftColor: '#ef4444' });
});
it('hides color editing on public boards', () => {
  render(<Fixture readOnly />);
  expect(screen.queryByRole('button', { name: 'Card color' })).not.toBeInTheDocument();
});
it('does not invent a color field when the table has none', () => {
  render(<Fixture column={{ name: 'description', type: 'text' }} />);
  expect(screen.queryByRole('button', { name: 'Card color' })).not.toBeInTheDocument();
});
