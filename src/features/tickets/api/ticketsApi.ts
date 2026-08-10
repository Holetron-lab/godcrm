/**
 * Tickets API — ADR-098 Phase 2
 *
 * Specialized ticket endpoints with state machine validation.
 * Used by Kanban widget for drag-and-drop status changes on Tickets table (1708).
 */

import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';

const TICKETS_TABLE_ID = 1708;

export interface TicketStatusResponse {
  ticket_id: number;
  old_state: string;
  old_state_id: number;
  new_state: string;
  new_state_id: number;
  chain_id: string | null;
  cascade: Array<{ level: number; action: string }>;
  updated_at: string;
}

export interface TicketDetails {
  id: number;
  what: string;
  why?: string;
  state: number;
  state_name: string;
  allowed_transitions: Array<{ id: number; name: string }>;
  assigned_to?: number;
  priority?: number;
  adr_ref?: string;
  _chain?: Record<string, unknown>;
}

/**
 * State name → ID mapping (must match backend STATE_MAP)
 */
export const TICKET_STATE_MAP: Record<string, number> = {
  backlog: 24275,
  assigned: 43436,
  in_progress: 24276,
  review: 24277,
  control: 43437,
  rejected: 43438,
  done: 24278,
};

export const TICKET_STATE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(TICKET_STATE_MAP).map(([k, v]) => [v, k])
);

/**
 * Check if a table is the Tickets table
 */
export function isTicketsTable(tableId: number | string): boolean {
  return Number(tableId) === TICKETS_TABLE_ID;
}

/**
 * Resolve a select option value to a state name.
 * The Kanban widget passes the option value (state ID as number or string).
 * We need to convert it to a state name for the tickets API.
 */
export function resolveStateName(statusValue: string | number): string | null {
  // If it's already a state name
  const lower = String(statusValue).toLowerCase();
  if (TICKET_STATE_MAP[lower]) return lower;

  // If it's a state ID (number or numeric string)
  const numValue = Number(statusValue);
  if (!isNaN(numValue) && TICKET_STATE_NAMES[numValue]) {
    return TICKET_STATE_NAMES[numValue];
  }

  return null;
}

// ADR-0002 §8 Phase 4 — Ticket seal (TOTP-act).
export interface TicketSealResponse {
  ticket_id: number;
  sealed_at: string;
  sealed_by: number;
}

export interface TicketUnsealResponse {
  ticket_id: number;
  unsealed_at: string;
  unsealed_by: number;
}

/**
 * Error shape thrown by seal/unseal helpers.
 *
 * Surface-area:
 *   - 401 TICKET_SEAL_TOTP_INVALID         — bad TOTP code
 *   - 403 TICKET_SEAL_AGENT_FORBIDDEN      — caller is agent/bot/service
 *   - 404 TICKET_SEAL_USER_NOT_FOUND       — JWT user not resolvable
 *   - 409 MUST_CRITERIA_INCOMPLETE         — gate red (details.failed[])
 *   - 409 TICKET_ALREADY_SEALED            — double-seal attempt
 *   - 409 TICKET_NOT_SEALED                — unseal of non-sealed ticket
 *   - 412 TICKET_SEAL_TOTP_NOT_ENROLLED    — user has no 2FA secret
 */
export interface TicketSealError extends Error {
  code: string;
  status: number;
  details?: {
    must_total?: number;
    must_verified?: number;
    failed?: Array<{
      id: number;
      code?: string | null;
      title?: string | null;
      status?: string;
    }>;
    sealed_at?: string;
    sealed_by?: string | number | null;
  };
}

export const ticketsApi = {
  /**
   * Change ticket status via specialized endpoint with state machine validation.
   * Returns cascade results for UI feedback.
   */
  updateStatus: async (ticketId: number | string, newState: string, notes?: string): Promise<TicketStatusResponse> => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const stateName = resolveStateName(newState);

    logger.debug('[ticketsApi.updateStatus] Sending:', { ticketId, newState, resolvedState: stateName });

    const response = await fetch(`/api/v3/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        new_state: stateName || newState,
        ...(notes ? { notes } : {}),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to update ticket status' }));
      const errorMessage = errorData.message || errorData.error?.message || `Status update failed (${response.status})`;
      logger.error('[ticketsApi.updateStatus] Error:', errorData);
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result.data;
  },

  /**
   * Get ticket details with state_name and allowed_transitions.
   */
  getTicket: async (ticketId: number | string): Promise<TicketDetails> => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`/api/v3/tickets/${ticketId}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to fetch ticket' }));
      throw new Error(errorData.message || `Fetch failed (${response.status})`);
    }

    const result = await response.json();
    return result.data;
  },

  /**
   * ADR-0002 §8 Phase 4 — Seal a ticket with a TOTP code.
   * On non-2xx responses throws a `TicketSealError` carrying the server-side
   * `code`, HTTP `status` and any `details` (gate metadata, sealed_at, …).
   */
  seal: async (
    ticketId: number | string,
    totpCode: string,
    notes?: string,
  ): Promise<TicketSealResponse> => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`/api/v3/tickets/${ticketId}/seal`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ totp_code: totpCode, ...(notes ? { notes } : {}) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(
        body?.error?.message || `Seal failed (${response.status})`,
      ) as TicketSealError;
      err.code = body?.error?.code || 'UNKNOWN';
      err.status = response.status;
      err.details = body?.error?.details;
      logger.error('[ticketsApi.seal] Error:', body);
      throw err;
    }
    return body.data;
  },

  /**
   * ADR-0002 §8 Phase 4 — Unseal a sealed ticket. Reason is required.
   * Same TOTP guard as seal; on success appends an audit row with action='broken'.
   */
  unseal: async (
    ticketId: number | string,
    totpCode: string,
    reason: string,
  ): Promise<TicketUnsealResponse> => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`/api/v3/tickets/${ticketId}/unseal`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ totp_code: totpCode, reason }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(
        body?.error?.message || `Unseal failed (${response.status})`,
      ) as TicketSealError;
      err.code = body?.error?.code || 'UNKNOWN';
      err.status = response.status;
      err.details = body?.error?.details;
      logger.error('[ticketsApi.unseal] Error:', body);
      throw err;
    }
    return body.data;
  },
};
