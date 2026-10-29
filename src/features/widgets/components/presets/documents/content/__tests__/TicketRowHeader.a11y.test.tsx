import { expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TicketRowHeader } from '../TicketRowHeader';
import type { ColumnModel } from '@/features/tables/types/table.types';

it('toggles a ticket with Enter and Space without mixing chat, status and colour actions', async () => {
  const user = userEvent.setup(), toggle = vi.fn(), chat = vi.fn(), color = vi.fn(), status = vi.fn(), submit = vi.fn();
  const { container } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}><TicketRowHeader
    ticket={{ id: 3, title: 'Fix keyboard', state: 1 }} ticketConfig={{ table_id: 1708, columns: { title: 'title', state: 'state' } }}
    tableColumns={[{ id: 'color', name: 'color', type: 'color' } as ColumnModel]}
    types={[]} states={[{ id: 1, name: 'Open' }, { id: 2, name: 'Done' }]} priorities={[]}
    isExpanded={false} onToggle={toggle} onOpenChat={chat} onStatusChange={status} onPriorityChange={vi.fn()} onColorChange={color}
  /></form>);
  const heading = screen.getByRole('button', { name: 'Fix keyboard' });
  heading.focus(); await user.keyboard('{Enter} '); expect(toggle).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('button', { name: 'Открыть чат' })); expect(chat).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await user.click(screen.getByRole('button', { name: 'Done' })); expect(status).toHaveBeenCalledWith(2);
  const swatch = screen.getByRole('button', { name: 'Цвет' });
  swatch.focus(); await user.keyboard(' ');
  let picker = screen.getByRole('dialog', { name: 'Цвет тикета' });
  expect(picker.contains(document.activeElement)).toBe(true);
  await user.keyboard('{Escape}'); await waitFor(() => expect(swatch).toHaveFocus());
  await user.keyboard('{Enter}'); picker = screen.getByRole('dialog', { name: 'Цвет тикета' });
  await user.click(within(picker).getByRole('button', { name: '#ef4444' })); expect(color).toHaveBeenCalledWith('#ef4444');
  expect(toggle).toHaveBeenCalledTimes(2); expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('button button')).toBeNull();
});
