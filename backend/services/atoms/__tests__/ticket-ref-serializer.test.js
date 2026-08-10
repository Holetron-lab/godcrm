// ADR-0012 §Phase 5 (M3 backend) — unit tests for the ticket_ref serializer
// + write-path validator. Pure module, no DB hits — loaders are injected.

import { describe, it, expect } from 'vitest';
import {
  serializeTicketSnapshot,
  validateTicketRefAtom,
  readTicketsTableId,
  isTicketRefAtom,
  DEFAULT_TICKETS_TABLE_ID,
} from '../ticket-ref-serializer.js';

const ATOMS_V2_TABLE_ID = 3574;
const FIXED_NOW = () => new Date('2026-04-25T12:00:00.000Z');

// ----------------------- serializeTicketSnapshot ---------------------------

describe('serializeTicketSnapshot', () => {
  it('builds slim snapshot from a flat ticket object', () => {
    const ticket = {
      id: 131090,
      what: 'Implement ticket_ref atom',
      state: 24276,
      assigned_to: '26283',
      updated_at: '2026-04-25T10:00:00.000Z',
    };
    const snap = serializeTicketSnapshot(ticket, { now: FIXED_NOW });
    expect(snap).toEqual({
      title: 'Implement ticket_ref atom',
      status: 24276,
      assigned_to: '26283',
      updated_at: '2026-04-25T10:00:00.000Z',
      snapshotted_at: '2026-04-25T12:00:00.000Z',
    });
  });

  it('handles a raw table_rows row (data jsonb at row.data)', () => {
    const row = {
      id: 1,
      data: {
        what: 'Raw row',
        state: 'in_progress',
        assigned_to: 'me',
      },
      updated_at: new Date('2026-04-24T08:00:00.000Z'),
    };
    const snap = serializeTicketSnapshot(row, { now: FIXED_NOW });
    expect(snap.title).toBe('Raw row');
    expect(snap.status).toBe('in_progress');
    expect(snap.assigned_to).toBe('me');
    expect(snap.updated_at).toBe('2026-04-24T08:00:00.000Z');
    expect(snap.snapshotted_at).toBe('2026-04-25T12:00:00.000Z');
  });

  it('parses data when stored as JSON string (SQLite mode)', () => {
    const row = {
      id: 9,
      data: JSON.stringify({ what: 'JSON-string row', state: 24278 }),
      updated_at: '2026-04-25T11:00:00.000Z',
    };
    const snap = serializeTicketSnapshot(row, { now: FIXED_NOW });
    expect(snap.title).toBe('JSON-string row');
    expect(snap.status).toBe(24278);
  });

  it('falls back to title when `what` is missing', () => {
    const ticket = { id: 7, title: 'Legacy title field', state: 24275 };
    const snap = serializeTicketSnapshot(ticket, { now: FIXED_NOW });
    expect(snap.title).toBe('Legacy title field');
  });

  it('falls back to status field when `state` is missing', () => {
    const ticket = { id: 7, what: 'No state', status: 'open' };
    const snap = serializeTicketSnapshot(ticket, { now: FIXED_NOW });
    expect(snap.status).toBe('open');
  });

  it('returns nulls for missing fields rather than undefined', () => {
    const snap = serializeTicketSnapshot({ id: 1 }, { now: FIXED_NOW });
    expect(snap.title).toBeNull();
    expect(snap.status).toBeNull();
    expect(snap.assigned_to).toBeNull();
    expect(snap.updated_at).toBeNull();
    expect(snap.snapshotted_at).toBe('2026-04-25T12:00:00.000Z');
  });

  it('snapshotted_at uses live clock when no `now` injection', () => {
    const before = Date.now();
    const snap = serializeTicketSnapshot({ what: 'x' });
    const after = Date.now();
    const ts = Date.parse(snap.snapshotted_at);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ----------------------- readTicketsTableId --------------------------------

describe('readTicketsTableId', () => {
  it('reads tickets_table_id directly', () => {
    expect(readTicketsTableId({ tickets_table_id: 1708 })).toBe(1708);
  });
  it('reads ticket_binding.table_id', () => {
    expect(readTicketsTableId({ ticket_binding: { table_id: '999' } })).toBe(999);
  });
  it('reads ticket_binding.tickets_table_id (legacy alias)', () => {
    expect(readTicketsTableId({ ticket_binding: { tickets_table_id: 555 } })).toBe(555);
  });
  it('returns null when no binding present', () => {
    expect(readTicketsTableId({})).toBeNull();
    expect(readTicketsTableId(null)).toBeNull();
    expect(readTicketsTableId({ registry_table_id: 9 })).toBeNull();
  });
});

// ----------------------- isTicketRefAtom -----------------------------------

describe('isTicketRefAtom', () => {
  it('matches type === ticket_ref', () => {
    expect(isTicketRefAtom({ type: 'ticket_ref' })).toBe(true);
  });
  it('rejects other types', () => {
    expect(isTicketRefAtom({ type: 'widget' })).toBe(false);
    expect(isTicketRefAtom({})).toBe(false);
    expect(isTicketRefAtom(null)).toBe(false);
    expect(isTicketRefAtom('ticket_ref')).toBe(false);
  });
});

// ----------------------- validateTicketRefAtom -----------------------------

function makeWidget(id, config = {}) {
  return { id, preset_name: 'documents', config };
}

function makeTicket(id, data = { what: 'T', state: 24275 }, updated_at = '2026-04-20T00:00:00.000Z') {
  return { id, base_id: 'b', table_id: 1708, data, created_at: updated_at, updated_at };
}

function makeLoaders({ widgets = {}, tickets = {} } = {}) {
  return {
    loadWidget: async (id) => widgets[id] ?? null,
    loadTicket: async (tableId, ticketId) => {
      const key = `${tableId}:${ticketId}`;
      return tickets[key] ?? null;
    },
  };
}

describe('validateTicketRefAtom — short-circuits', () => {
  it('non-atoms_v2 table → ok with data unchanged', async () => {
    const data = { type: 'ticket_ref', props: {} };
    const r = await validateTicketRefAtom({
      tableId: 999,
      data,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      loadWidget: async () => { throw new Error('should not be called'); },
      loadTicket: async () => { throw new Error('should not be called'); },
    });
    expect(r).toEqual({ ok: true, data });
  });

  it('atoms_v2 table + non-ticket_ref atom → ok unchanged', async () => {
    const data = { type: 'widget', widget_ref: 1 };
    const r = await validateTicketRefAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      loadWidget: async () => { throw new Error('should not be called'); },
      loadTicket: async () => { throw new Error('should not be called'); },
    });
    expect(r).toEqual({ ok: true, data });
  });
});

describe('validateTicketRefAtom — props validation', () => {
  const baseLoaders = makeLoaders({
    widgets: { 218: makeWidget(218, { tickets_table_id: 1708 }) },
    tickets: { '1708:131090': makeTicket(131090) },
  });
  const callOpts = (extra) => ({
    tableId: ATOMS_V2_TABLE_ID,
    atomsV2TableId: ATOMS_V2_TABLE_ID,
    ...baseLoaders,
    now: FIXED_NOW,
    ...extra,
  });

  it('missing props → 400 TICKET_REF_INVALID_PROPS', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref', widget_ref: 218 },
    }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.code).toBe('TICKET_REF_INVALID_PROPS');
    expect(r.field).toBe('props');
  });

  it('non-object props → 400', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref', widget_ref: 218, props: 'whoops' },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TICKET_REF_INVALID_PROPS');
  });

  it('missing ticket_id → 400 TICKET_REF_INVALID_TICKET_ID', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref', widget_ref: 218, props: { mode: 'live', display_mode: 'card' } },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TICKET_REF_INVALID_TICKET_ID');
    expect(r.field).toBe('props.ticket_id');
  });

  it('non-numeric ticket_id → 400', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref', widget_ref: 218,
        props: { ticket_id: 'abc', mode: 'live', display_mode: 'card' } },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TICKET_REF_INVALID_TICKET_ID');
  });

  it('invalid mode → 400 TICKET_REF_INVALID_MODE', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref', widget_ref: 218,
        props: { ticket_id: 131090, mode: 'turbo', display_mode: 'card' } },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TICKET_REF_INVALID_MODE');
    expect(r.field).toBe('props.mode');
  });

  it('invalid display_mode → 400 TICKET_REF_INVALID_DISPLAY_MODE', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref', widget_ref: 218,
        props: { ticket_id: 131090, mode: 'live', display_mode: 'mega' } },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TICKET_REF_INVALID_DISPLAY_MODE');
    expect(r.field).toBe('props.display_mode');
  });

  it('missing widget_ref → 400 TICKET_REF_INVALID_WIDGET_REF', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref',
        props: { ticket_id: 131090, mode: 'live', display_mode: 'card' } },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TICKET_REF_INVALID_WIDGET_REF');
  });

  it('widget not found → 400 TICKET_REF_WIDGET_NOT_FOUND', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref', widget_ref: 9999,
        props: { ticket_id: 131090, mode: 'live', display_mode: 'card' } },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TICKET_REF_WIDGET_NOT_FOUND');
  });

  it('ticket not found → 400 TICKET_REF_TICKET_NOT_FOUND', async () => {
    const r = await validateTicketRefAtom(callOpts({
      data: { type: 'ticket_ref', widget_ref: 218,
        props: { ticket_id: 555555, mode: 'live', display_mode: 'card' } },
    }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TICKET_REF_TICKET_NOT_FOUND');
    expect(r.field).toBe('props.ticket_id');
  });
});

describe('validateTicketRefAtom — happy path & snapshot hydration', () => {
  const widget = makeWidget(218, { tickets_table_id: 1708 });
  const ticket = makeTicket(131090, { what: 'Live ticket', state: 24276, assigned_to: '16' },
    '2026-04-25T09:00:00.000Z');
  const loaders = makeLoaders({
    widgets: { 218: widget },
    tickets: { '1708:131090': ticket },
  });

  it('mode=live with no snapshot → ok, data unchanged', async () => {
    const data = {
      type: 'ticket_ref',
      widget_ref: 218,
      props: { ticket_id: 131090, mode: 'live', display_mode: 'card' },
    };
    const r = await validateTicketRefAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      ...loaders,
      now: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.data.props.snapshot).toBeUndefined();
  });

  it('mode=snapshot with no snapshot → backend hydrates one', async () => {
    const data = {
      type: 'ticket_ref',
      widget_ref: 218,
      props: { ticket_id: 131090, mode: 'snapshot', display_mode: 'inline' },
    };
    const r = await validateTicketRefAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      ...loaders,
      now: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.data.props.snapshot).toEqual({
      title: 'Live ticket',
      status: 24276,
      assigned_to: '16',
      updated_at: '2026-04-25T09:00:00.000Z',
      snapshotted_at: '2026-04-25T12:00:00.000Z',
    });
  });

  it('mode=hybrid hydrates snapshot too', async () => {
    const data = {
      type: 'ticket_ref',
      widget_ref: 218,
      props: { ticket_id: 131090, mode: 'hybrid', display_mode: 'status-only' },
    };
    const r = await validateTicketRefAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      ...loaders,
      now: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.data.props.snapshot).toBeDefined();
    expect(r.data.props.snapshot.title).toBe('Live ticket');
  });

  it('client-supplied snapshot is preserved (not overwritten)', async () => {
    const clientSnap = {
      title: 'Frozen at upsert time',
      status: 99,
      assigned_to: null,
      updated_at: '2026-04-01T00:00:00.000Z',
      snapshotted_at: '2026-04-01T00:00:00.000Z',
    };
    const data = {
      type: 'ticket_ref',
      widget_ref: 218,
      props: {
        ticket_id: 131090,
        mode: 'snapshot',
        display_mode: 'card',
        snapshot: clientSnap,
      },
    };
    const r = await validateTicketRefAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      ...loaders,
      now: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.data.props.snapshot).toEqual(clientSnap);
  });

  it('falls back to DEFAULT_TICKETS_TABLE_ID when widget has no binding', async () => {
    const widgetNoBinding = makeWidget(300, { /* no tickets_table_id */ });
    const ticketDefault = makeTicket(42, { what: 'Default-table ticket', state: 24275 });
    const localLoaders = makeLoaders({
      widgets: { 300: widgetNoBinding },
      tickets: { [`${DEFAULT_TICKETS_TABLE_ID}:42`]: ticketDefault },
    });
    const data = {
      type: 'ticket_ref',
      widget_ref: 300,
      props: { ticket_id: 42, mode: 'snapshot', display_mode: 'card' },
    };
    const r = await validateTicketRefAtom({
      tableId: ATOMS_V2_TABLE_ID,
      data,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      ...localLoaders,
      now: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.data.props.snapshot.title).toBe('Default-table ticket');
  });
});
