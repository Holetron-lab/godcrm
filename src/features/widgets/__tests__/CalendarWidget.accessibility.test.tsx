import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';
import { CalendarWidget } from '../components/presets/CalendarWidget';
import type { Widget } from '../types/widget.types';

const today = new Date();
const date = format(today, 'yyyy-MM-dd');
const widget: Widget = {
  id: 1, dashboard_id: 1, source_widget_id: null,
  widget_type: 'preset', preset_name: 'calendar_widget',
  code: null, code_version: 1, title: 'Календарь', description: null, icon: 'calendar',
  config: { calendar: { tableId: '1', dateColumn: 'date', titleColumn: 'title' } },
  position: { x: 0, y: 0, w: 4, h: 4 },
  is_visible: true, is_module: false, order_index: 0, created_by: null,
  created_at: '2026-01-01', updated_at: '2026-01-01',
  module_id: null, sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
};
const data = [{ id: 'event-1', data: { title: 'Встреча', date } }];

describe('CalendarWidget keyboard controls', () => {
  it.each(['{Enter}', ' '])('opens events with %s without creating or submitting', async key => {
    const user = userEvent.setup();
    const onEventClick = vi.fn();
    const onAddEvent = vi.fn();
    const onSubmit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={onSubmit}><CalendarWidget widget={widget} data={data}
      onEventClick={onEventClick} onAddEvent={onAddEvent} /></form>);
    screen.getByRole('button', { name: 'Встреча' }).focus();
    await user.keyboard(key);
    expect(onEventClick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(data[0]), 'details');
    expect(onAddEvent).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['{Enter}', ' '])('creates on the named date with %s', async key => {
    const user = userEvent.setup();
    const onAddEvent = vi.fn();
    render(<CalendarWidget widget={widget} data={data} onAddEvent={onAddEvent} />);
    screen.getByRole('button', { name: `Добавить событие: ${date}` }).focus();
    await user.keyboard(key);
    expect(onAddEvent).toHaveBeenCalledTimes(1);
    expect(format(onAddEvent.mock.calls[0][0], 'yyyy-MM-dd')).toBe(date);
  });

  it('does not expose add controls without a creation callback', () => {
    render(<CalendarWidget widget={widget} data={data} />);
    expect(screen.queryByRole('button', { name: /Добавить событие/ })).toBeNull();
  });

  it('preserves drag and drop to the day containing the create button', () => {
    const onEventUpdate = vi.fn();
    render(<CalendarWidget widget={widget} data={data} onEventClick={vi.fn()}
      onAddEvent={vi.fn()} onEventUpdate={onEventUpdate} />);
    const dataTransfer = { effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Встреча' }), { dataTransfer });
    const target = screen.getByRole('button', { name: `Добавить событие: ${date}` });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(onEventUpdate).toHaveBeenCalledExactlyOnceWith('event-1', 'date', `${date}T00:00:00`);
  });

  it('expands hidden events without creating an event', async () => {
    const user = userEvent.setup();
    const onAddEvent = vi.fn();
    const events = Array.from({ length: 4 }, (_, index) => ({
      id: String(index), data: { title: `Встреча ${index}`, date },
    }));
    render(<CalendarWidget widget={widget} data={events} onAddEvent={onAddEvent} onEventClick={vi.fn()} />);
    const expand = screen.getByRole('button', { name: /ещё/ });
    expand.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Встреча 3' })).toBeVisible();
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(onAddEvent).not.toHaveBeenCalled();
  });
});
