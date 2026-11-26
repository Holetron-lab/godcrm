import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { CalendarWidget } from '../components/presets/CalendarWidget';
import type { OccurrenceEvent } from '../components/presets/_shared/ticket-events';
import type { RelationDataMap } from '../components/presets/_shared/useLaneAxis';
import type { ColumnInfo } from '../components/presets/TableViewWidget';
import type { Widget, WidgetDataRow } from '../types/widget.types';

/** ADR-209 WP-3 — the events table as a second source of the calendar. */

vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getRows: vi.fn() } }));

const EVENTS_TABLE = 900;
const BACKLOG = 1;
const REVIEW = 4;
const DONE = 7;

// `ColumnInfo.config` only types select options; the status relation is what `buildLaneAxis` reads.
const columnsInfo = [
  { name: 'what', type: 'text' },
  { name: 'state', type: 'relation', config: { relation: { enabled: true, tableId: 50 } } },
] as unknown as ColumnInfo[];
const relationData: RelationDataMap = new Map([['50', new Map([
  [String(BACKLOG), { label: 'Backlog', color: '#6b7280', order: 1 }],
  [String(REVIEW), { label: 'Review', color: '#a855f7', order: 4 }],
  [String(DONE), { label: 'Done', color: '#22c55e', order: 7 }],
])]]);

// The calendar opens on the current month, so every date lives in it.
const now = new Date();
const at = (day: number, hour = 18) => new Date(now.getFullYear(), now.getMonth(), day, hour, 0).toISOString();
const occurrence = (id: number, ticketId: number, day: number, state: number | null, extra: Record<string, unknown> = {}): OccurrenceEvent => ({
  id: String(id),
  data: { ticket_id: ticketId, state, status: 'confirmed', original_start: at(day), start_datetime: at(day), end_datetime: at(day, 19), ...extra },
});

const series: WidgetDataRow = {
  id: 7,
  data: { what: 'Английский', state: BACKLOG, repeat: '0 18 * * 1,3,5', duration: 60, scheduled_date: at(1, 0), due_date: at(25, 0) },
} as WidgetDataRow;
const oneOff: WidgetDataRow = {
  id: 8,
  data: { what: 'Созвон', state: REVIEW, duration: 60, scheduled_date: at(12, 15), due_date: at(14, 15) },
} as WidgetDataRow;
const oneOffEvent = occurrence(201, 8, 12, null, { original_start: at(12, 15), start_datetime: at(12, 15), end_datetime: at(12, 16) });

// `eventsTableId: null` = a widget without the events table (undefined would take the default).
function calendar(tickets: WidgetDataRow[], { eventsTableId = EVENTS_TABLE as number | null, readOnly = false, ...props }: {
  eventsTableId?: number | null;
  readOnly?: boolean;
  onEventClick?: (event: { id?: string | number }) => void;
  onEventUpdate?: () => void;
} = {}) {
  const widget = {
    id: 99,
    config: { calendar: { tableId: '1', dateColumn: 'scheduled_date', endDateColumn: 'due_date', titleColumn: 'what', eventsTableId: eventsTableId ?? undefined } },
  } as unknown as Widget;
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PublicViewProvider readOnly={readOnly} publicSlug={null}>
        <CalendarWidget widget={widget} data={tickets} columnsInfo={columnsInfo} relationData={relationData} {...props} />
      </PublicViewProvider>
    </QueryClientProvider>
  );
}

const serveEvents = (events: OccurrenceEvent[]) =>
  vi.mocked(tablesApi.getRows).mockResolvedValue({ rows: events } as Awaited<ReturnType<typeof tablesApi.getRows>>);

beforeEach(() => {
  vi.mocked(tablesApi.getRows).mockReset();
});

describe('CalendarWidget — events table', () => {
  it('draws a series as its occurrences with time, coloured by occurrence status, without the strip', async () => {
    serveEvents([occurrence(101, 7, 10, BACKLOG), occurrence(102, 7, 12, REVIEW), occurrence(103, 7, 14, DONE)]);
    render(calendar([series]));

    const entries = await screen.findAllByRole('button', { name: '18:00–19:00 Английский' });
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveStyle({ color: '#6b7280' });
    expect(entries[1]).toHaveStyle({ color: '#a855f7' });
    expect(entries[2]).toHaveStyle({ color: '#22c55e' });
    expect(screen.queryByRole('button', { name: 'Английский' })).not.toBeInTheDocument();
    expect(tablesApi.getRows).toHaveBeenCalledWith(String(EVENTS_TABLE), 1, 2000, true);
  });

  it('does not draw a cancelled occurrence', async () => {
    serveEvents([occurrence(101, 7, 10, BACKLOG), occurrence(102, 7, 12, BACKLOG, { status: 'cancelled' })]);
    render(calendar([series]));

    expect(await screen.findAllByRole('button', { name: '18:00–19:00 Английский' })).toHaveLength(1);
  });

  it('replaces a one-off ticket with its event on that day and keeps the rest of the strip', async () => {
    serveEvents([oneOffEvent]);
    render(calendar([oneOff]));

    const entry = await screen.findByRole('button', { name: '15:00–16:00 Созвон' });
    expect(entry).toHaveStyle({ color: '#a855f7' });
    expect(screen.getAllByRole('button', { name: 'Созвон' })).toHaveLength(2);
  });

  it('opens the ticket from an occurrence and does not offer to drag it', async () => {
    const user = userEvent.setup();
    const onEventClick = vi.fn();
    serveEvents([occurrence(101, 7, 10, BACKLOG)]);
    render(calendar([series], { onEventClick, onEventUpdate: vi.fn() }));

    const entry = await screen.findByRole('button', { name: '18:00–19:00 Английский' });
    expect(entry).toHaveAttribute('draggable', 'false');
    await user.click(entry);

    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'details');
  });

  it('keeps a ticket without events as it is', async () => {
    serveEvents([]);
    render(calendar([series]));

    await waitFor(() => expect(tablesApi.getRows).toHaveBeenCalled());
    expect(screen.getAllByRole('button', { name: 'Английский' })).toHaveLength(25);
  });

  it('does not read the events table without eventsTableId', () => {
    render(calendar([series], { eventsTableId: null }));

    expect(screen.getAllByRole('button', { name: 'Английский' })).toHaveLength(25);
    expect(tablesApi.getRows).not.toHaveBeenCalled();
  });

  it('does not read the events table under a public read-only scope', () => {
    render(calendar([series], { readOnly: true }));

    expect(screen.getAllByRole('button', { name: 'Английский' })).toHaveLength(25);
    expect(tablesApi.getRows).not.toHaveBeenCalled();
  });
});
