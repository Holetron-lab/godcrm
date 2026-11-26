import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DragEndEvent } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { showToast } from '@/shared/hooks/useToast';
import type { Widget } from '../../../types/widget.types';
import { KanbanWidget } from './KanbanWidget';
import type { ColumnInfo, KanbanCardData, KanbanWidgetProps, RelationDataMap } from './kanban-types';
import type { OccurrenceEvent } from '../_shared/ticket-events';

/** ADR-209 WP-2 — the events table as a second source of the board. */

const dnd = vi.hoisted(() => ({ onDragEnd: undefined as ((event: DragEndEvent) => void) | undefined }));

vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getRows: vi.fn(), batchUpdateRows: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));
// jsdom has no layout, so a pointer drag cannot be simulated: capture the handler instead.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dnd.onDragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

const EVENTS_TABLE = 900;
const BACKLOG = 1;
const REVIEW = 4;
const DONE = 7;

const columnsInfo: ColumnInfo[] = [
  { name: 'what', type: 'text' },
  { name: 'duration', type: 'number' },
  { name: 'state', type: 'relation', config: { relation: { enabled: true, tableId: 50 } } },
  { name: 'priority', type: 'select', config: { options: [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] } },
];
const relationData: RelationDataMap = new Map([['50', new Map([
  [String(BACKLOG), { label: 'Backlog', color: '#6b7280', order: 1 }],
  [String(REVIEW), { label: 'Review', color: '#a855f7', order: 4 }],
  [String(DONE), { label: 'Done', color: '#22c55e', order: 7 }],
])]]);

const at = (day: number, hour = 18) => new Date(2026, 10, day, hour, 0).toISOString();
const occurrence = (id: number, ticketId: number, day: number, state: number | null, extra: Record<string, unknown> = {}): OccurrenceEvent => ({
  id: String(id),
  data: { ticket_id: ticketId, state, status: 'confirmed', original_start: at(day), start_datetime: at(day), end_datetime: at(day, 19), ...extra },
});

const series: KanbanCardData = {
  id: 7,
  data: { what: 'English', state: BACKLOG, priority: 'high', repeat: '0 18 * * 1', duration: 60, scheduled_date: '2026-11-01', due_date: '2026-12-25' },
};
const seriesEvents = () => [
  occurrence(101, 7, 13, BACKLOG), occurrence(102, 7, 11, BACKLOG), occurrence(103, 7, 16, BACKLOG),
  occurrence(104, 7, 9, REVIEW), occurrence(105, 7, 4, DONE), occurrence(106, 7, 18, BACKLOG, { status: 'cancelled' }),
];

/** Rows of the events table as the server holds them; a successful batch update writes through. */
let serverEvents: OccurrenceEvent[] = [];

function board(tickets: KanbanCardData[], overrides: Partial<KanbanWidgetProps> & { config?: Record<string, unknown>; readOnly?: boolean } = {}) {
  const { config, readOnly = false, ...props } = overrides;
  const widget = { id: 99, config: { statusColumn: 'state', card_title_column: 'what', kanban: { eventsTableId: EVENTS_TABLE }, ...config } } as unknown as Widget;
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <PublicViewProvider readOnly={readOnly} publicSlug={null}>
          <KanbanWidget widget={widget} data={tickets} columnsInfo={columnsInfo} relationData={relationData} showToolbar={false} {...props} />
        </PublicViewProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

let queryClient: QueryClient;
const lane = (label: string) => screen.getByRole('heading', { name: label }).parentElement!.parentElement!;
const countIn = (label: string) => within(lane(label)).queryByText(/^×\d+$/)?.textContent ?? null;
const drop = (cardId: string, toState: number) =>
  act(async () => dnd.onDragEnd?.({ active: { id: cardId }, over: { id: String(toState) } } as unknown as DragEndEvent));

beforeEach(() => {
  localStorage.setItem('god-crm-language', 'en');
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  serverEvents = seriesEvents();
  vi.mocked(tablesApi.getRows).mockImplementation(async () => ({ rows: serverEvents, pagination: { page: 1, limit: 2000, total: serverEvents.length, pages: 1 } }) as never);
  vi.mocked(tablesApi.batchUpdateRows).mockImplementation(async (_tableId, updates) => {
    serverEvents = serverEvents.map((row) => {
      const update = updates.find((candidate) => String(candidate.rowId) === String(row.id));
      return update ? { ...row, data: { ...row.data, ...update.data } } : row;
    });
    return { success: true, updated: updates.length };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Kanban second source (ADR-209 D6)', () => {
  it('does not read the events table without eventsTableId: one card per ticket', async () => {
    render(board([series], { config: { kanban: {} } }));
    expect(within(lane('Backlog')).getByText('English')).toBeInTheDocument();
    expect(screen.getAllByText('English')).toHaveLength(1);
    expect(tablesApi.getRows).not.toHaveBeenCalled();
    expect(screen.queryByText(/^×\d+$/)).not.toBeInTheDocument();
  });

  it('does not read the events table under a public read-only scope', () => {
    render(board([series], { readOnly: true }));
    expect(tablesApi.getRows).not.toHaveBeenCalled();
    expect(screen.getAllByText('English')).toHaveLength(1);
  });

  it('shows a series as one card with a counter in every column that has occurrences', async () => {
    render(board([series]));
    await waitFor(() => expect(screen.getAllByText('English')).toHaveLength(3));
    expect(tablesApi.getRows).toHaveBeenCalledWith(String(EVENTS_TABLE), 1, 2000, true);
    expect([countIn('Backlog'), countIn('Review'), countIn('Done')]).toEqual(['×3', '×1', '×1']);
    expect(within(lane('Backlog')).getByText(/1 h$/)).toBeInTheDocument();
  });

  it('moves the earliest occurrence of the source column on a drag without marks', async () => {
    render(board([series]));
    await waitFor(() => expect(countIn('Backlog')).toBe('×3'));
    await drop(`7@${BACKLOG}`, REVIEW);

    expect(tablesApi.batchUpdateRows).toHaveBeenCalledExactlyOnceWith(String(EVENTS_TABLE), [{ rowId: '102', data: { state: REVIEW } }]);
    await waitFor(() => expect([countIn('Backlog'), countIn('Review')]).toEqual(['×2', '×2']));
  });

  it('moves every date marked in the mini-calendar', async () => {
    const user = userEvent.setup();
    render(board([series]));
    await waitFor(() => expect(countIn('Backlog')).toBe('×3'));

    await user.click(within(lane('Backlog')).getByTitle('Expand'));
    const calendar = within(lane('Backlog')).getByRole('group', { name: 'Occurrences' });
    const day = (number: number) => within(calendar).getAllByRole('button').find((button) => button.textContent === String(number))!;
    expect(within(calendar).queryByRole('button', { name: /18/ })).not.toBeInTheDocument(); // cancelled occurrence
    for (const number of [9, 13, 16]) await user.click(day(number));
    expect(day(13)).toHaveAttribute('aria-pressed', 'true');
    expect(day(11)).toHaveAttribute('aria-pressed', 'false');
    expect(within(calendar).getByText(/Marked: 3/)).toBeInTheDocument();

    await drop(`7@${BACKLOG}`, DONE);
    const [, updates] = vi.mocked(tablesApi.batchUpdateRows).mock.calls[0];
    expect(updates.map((update) => update.rowId).sort()).toEqual(['101', '103', '104']);
    expect(updates.every((update) => update.data.state === DONE)).toBe(true);
    await waitFor(() => expect([countIn('Backlog'), countIn('Review'), countIn('Done')]).toEqual(['×1', null, '×4']));
  });

  it('puts the cards back and reports it when the write fails', async () => {
    vi.mocked(tablesApi.batchUpdateRows).mockRejectedValue(new Error('boom'));
    render(board([series]));
    await waitFor(() => expect(countIn('Backlog')).toBe('×3'));
    await drop(`7@${BACKLOG}`, REVIEW);

    await waitFor(() => expect(showToast).toHaveBeenCalledExactlyOnceWith('Could not move the occurrences. Nothing was changed', 'error'));
    expect([countIn('Backlog'), countIn('Review')]).toEqual(['×3', '×1']);
  });

  it('never moves the ticket itself when a series card is dragged', async () => {
    const onMoveCard = vi.fn();
    render(board([series], { onMoveCard }));
    await waitFor(() => expect(countIn('Backlog')).toBe('×3'));
    await drop(`7@${BACKLOG}`, REVIEW);
    expect(onMoveCard).not.toHaveBeenCalled();
  });

  it('routes open, chat and quick edit of a series card to the ticket id', async () => {
    const user = userEvent.setup();
    const onCardDoubleClick = vi.fn();
    const onOpenRowChat = vi.fn();
    const onCardUpdate = vi.fn();
    render(board([series], { onCardDoubleClick, onOpenRowChat, onCardUpdate }));
    await waitFor(() => expect(countIn('Review')).toBe('×1'));
    const card = within(lane('Review'));

    await user.click(card.getByTitle('Open full'));
    expect(onCardDoubleClick).toHaveBeenCalledExactlyOnceWith(series, 'details');
    await user.click(card.getByTitle('Chat'));
    expect(onOpenRowChat).toHaveBeenCalledExactlyOnceWith('7');
    await user.dblClick(card.getByText('English'));
    await user.keyboard('!{Enter}');
    expect(onCardUpdate).toHaveBeenCalledExactlyOnceWith('7', 'what', expect.stringContaining('English'));
    expect(card.getByText('#7')).toBeInTheDocument();
  });

  it('keeps a one-off ticket as one card in its own column and shows the time of its event', async () => {
    const single: KanbanCardData = { id: 8, data: { what: 'Call', state: REVIEW, duration: 60, scheduled_date: at(12, 15) } };
    serverEvents = [occurrence(201, 8, 12, null, { start_datetime: at(12, 15), original_start: at(12, 15), end_datetime: at(12, 16) })];
    render(board([single]));

    expect(await within(lane('Review')).findByText(/15:00 · 1 h$/)).toBeInTheDocument();
    expect(screen.getAllByText('Call')).toHaveLength(1);
    expect(screen.queryByText(/^×\d+$/)).not.toBeInTheDocument();
  });

  it('shows a ticket without repeat as one card even when occurrences of a former series remain', async () => {
    const former: KanbanCardData = { id: 9, data: { what: 'Former series', state: BACKLOG } };
    serverEvents = [occurrence(301, 9, 4, DONE), occurrence(302, 9, 6, REVIEW)];
    render(board([former]));
    await waitFor(() => expect(tablesApi.getRows).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.getAllByText('Former series')).toHaveLength(1);
    expect(within(lane('Backlog')).getByText('Former series')).toBeInTheDocument();
  });

  it('shows one card per ticket when the board is not grouped by status', async () => {
    render(board([series], { config: { group_by_column: 'priority' } }));
    await waitFor(() => expect(tablesApi.getRows).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.getAllByText('English')).toHaveLength(1);
    expect(within(lane('High')).getByText('English')).toBeInTheDocument();
    expect(screen.queryByText(/^×\d+$/)).not.toBeInTheDocument();
  });

  it('edits the duration of the ticket from the expanded card, never the length of single events', async () => {
    const user = userEvent.setup();
    const onCardUpdate = vi.fn();
    render(board([series], { onCardUpdate }));
    await waitFor(() => expect(countIn('Review')).toBe('×1'));
    await user.click(within(lane('Review')).getByTitle('Expand'));

    const field = within(lane('Review')).getByRole('spinbutton', { name: 'Duration, min' });
    expect(field).toHaveValue(60);
    await user.clear(field);
    await user.type(field, '0{Enter}');
    expect(onCardUpdate).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, '90{Enter}');
    expect(onCardUpdate).toHaveBeenCalledExactlyOnceWith('7', 'duration', 90);
    expect(tablesApi.batchUpdateRows).not.toHaveBeenCalled();
  });

  it('offers the duration field on a one-off ticket and none without the second source', async () => {
    const user = userEvent.setup();
    const single: KanbanCardData = { id: 8, data: { what: 'Call', state: REVIEW, scheduled_date: at(12, 15) } };
    serverEvents = [];
    const view = render(board([single], { onCardUpdate: vi.fn() }));
    await user.click(within(lane('Review')).getByTitle('Expand'));
    expect(within(lane('Review')).getByRole('spinbutton', { name: 'Duration, min' })).toHaveValue(null);

    view.unmount();
    render(board([single], { onCardUpdate: vi.fn(), config: { kanban: {} } }));
    await user.click(within(lane('Review')).getByTitle('Expand'));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('re-reads the events and updates the badge after the duration of the ticket changes', async () => {
    const { rerender } = render(board([series]));
    await waitFor(() => expect(countIn('Backlog')).toBe('×3'));
    expect(tablesApi.getRows).toHaveBeenCalledTimes(1);

    rerender(board([{ ...series, data: { ...series.data, duration: 90 } }]));
    await waitFor(() => expect(tablesApi.getRows).toHaveBeenCalledTimes(2));
    expect(within(lane('Backlog')).getByText(/1\.5 h$/)).toBeInTheDocument();
  });
});
