/**
 * TicketRefAtom — type contract (ADR-0012 Phase 5 / M4 frontend).
 *
 * The "ticket-as-atom" feature embeds individual tickets as inline atoms inside
 * documents. Atoms live in the universal `atoms_v2` table (id 3574) — see
 * `backend/services/atoms/ticket-ref-serializer.js` for the canonical backend
 * contract. A document item references the atom row via its existing
 * `atom_ref` integer column.
 *
 * Atom row payload shape (table_rows.data for table 3574):
 *
 *   {
 *     type: 'ticket_ref',
 *     widget_ref: <documents-widget id>,
 *     doc_id?: <owning-document id>,
 *     props: {
 *       ticket_id:   <int>,                       // FK → tickets table 1708
 *       mode:        'live' | 'snapshot' | 'hybrid',
 *       display_mode: 'card' | 'inline' | 'status-only',
 *       snapshot?:   TicketRefSnapshot            // hydrated by backend on create
 *     }
 *   }
 */

export const ATOMS_V2_TABLE_ID = 3574;
export const TICKET_REF_TYPE = 'ticket_ref' as const;

export type TicketRefDisplayMode = 'card' | 'inline' | 'status-only';

export type TicketRefMode = 'live' | 'snapshot' | 'hybrid';

export interface TicketRefSnapshot {
  title: string | null;
  status: string | number | null;
  assigned_to?: string | number | null;
  /** ISO timestamp from the ticket row at snapshot time. */
  updated_at: string | null;
  /** ISO timestamp when the snapshot itself was captured. */
  snapshotted_at: string;
}

/** Canonical atom payload (the value of `data` for the atoms_v2 row). */
export interface TicketRefAtomPayload {
  type: typeof TICKET_REF_TYPE;
  widget_ref: number;
  doc_id?: number;
  props: {
    ticket_id: number;
    mode: TicketRefMode;
    display_mode: TicketRefDisplayMode;
    snapshot?: TicketRefSnapshot;
  };
}

/** Backend resolve response (ADR-0012 §M3). */
export interface TicketRefResolveResponse {
  ticket: {
    id: number;
    [key: string]: unknown;
  };
  snapshot: TicketRefSnapshot;
}

export const DEFAULT_TICKET_ATOM_DISPLAY: TicketRefDisplayMode = 'card';
export const DEFAULT_TICKET_ATOM_MODE: TicketRefMode = 'live';
