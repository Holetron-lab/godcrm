import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Widget } from '../types/widget.types';
import { CalendarWidget } from '../components/presets/CalendarWidget';
import { QuickLinksWidget } from '../components/presets/QuickLinksWidget';

const widget: Widget = {
  id: 1, dashboard_id: 1, source_widget_id: null, widget_type: 'preset',
  preset_name: 'calendar_widget', code: null, code_version: 1, title: 'Calendar',
  description: null, icon: '', config: { calendar: { tableId: '42', dateColumn: 'date', titleColumn: 'title' } },
  position: { x: 0, y: 0, w: 4, h: 4 }, is_visible: true, is_module: false,
  order_index: 0, created_by: null, created_at: '', updated_at: '', module_id: null,
  sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
};

describe('widget row values', () => {
  it('renders calendar events with ISO strings, numeric timestamps and Date objects', () => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    render(<CalendarWidget widget={widget} data={[
      { id: 1, data: { date: date.toISOString(), title: 'ISO event' } },
      { id: 2, data: { date: date.getTime(), title: 'Timestamp event' } },
      { id: 3, data: { date, title: 'Date event' } },
      { id: 4, data: { date: { invalid: true }, title: 'Invalid event' } },
    ]} />);
    expect(screen.getByText('ISO event')).toBeInTheDocument();
    expect(screen.getByText('Timestamp event')).toBeInTheDocument();
    expect(screen.getByText('Date event')).toBeInTheDocument();
    expect(screen.queryByText('Invalid event')).not.toBeInTheDocument();
  });

  it('uses link fallbacks for non-text fields without crashing', () => {
    render(<QuickLinksWidget widget={widget} data={[
      { id: 1, data: { url: { invalid: true }, name: { invalid: true }, description: { invalid: true } } },
      { id: 2, data: { url: '/tables/42', title: 'Tickets', description: 'Open tickets' } },
    ]} />);
    expect(screen.getByText('Untitled').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'Tickets Open tickets' })).toHaveAttribute('href', '/tables/42');
  });
});
