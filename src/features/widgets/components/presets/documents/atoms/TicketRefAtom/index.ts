/**
 * TicketRefAtom — public exports for the ticket-as-atom feature
 * (ADR-0012 Phase 5 / M4 frontend).
 */
export { TicketRefAtom } from './TicketRefAtom';
export { InsertTicketAtomModal } from './InsertTicketAtomModal';
export { useTicketRefResolve, ticketRefResolveKeys } from './useTicketRefResolve';
export {
  useAtomRow,
  useAtomMutations,
  isTicketRefAtomPayload,
  atomsV2Keys,
} from './useAtomRow';
export {
  ATOMS_V2_TABLE_ID,
  TICKET_REF_TYPE,
  DEFAULT_TICKET_ATOM_DISPLAY,
  DEFAULT_TICKET_ATOM_MODE,
} from './types';
export type {
  TicketRefAtomPayload,
  TicketRefDisplayMode,
  TicketRefMode,
  TicketRefResolveResponse,
  TicketRefSnapshot,
} from './types';
