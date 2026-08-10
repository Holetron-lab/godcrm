/**
 * useTicketsResolve — TanStack Query hook for the `tickets_list` preset.
 *
 * Calls POST /api/v3/widgets/:widgetId/resolve-tickets with an empty body.
 * The server reads `widget.config.filter` and decides:
 *   - filter active   → column-filter (rows where data[col] === value)
 *   - filter inactive → all rows from the configured tickets table
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { TicketRow } from '../../../types/documents.types';

export type TicketsFilterMode = 'column-filter' | 'manual-ids' | 'all';

export interface TicketsResolveAppliedFilter {
  space_id: number | null;
  column?: string;
  value?: string;
  /** Present in manual-ids mode (ADR-0012 §4.8). Order = render order. */
  ids?: number[];
}

export interface TicketsResolveResponse {
  tickets: TicketRow[];
  total: number;
  filter_mode: TicketsFilterMode;
  applied_filter: TicketsResolveAppliedFilter;
}

/**
 * ADR-0012 Phase 3 query-key namespace. Kept stable so TanStack can invalidate
 * exactly the tickets-list preset data without touching the legacy inline
 * doc-tickets query (`['tickets', tableId]`).
 */
export const ticketsResolveKeys = {
  all: ['tickets-resolve'] as const,
  byWidget: (widgetId: number) => ['tickets-resolve', widgetId] as const,
};

interface UseTicketsResolveOptions {
  /** Enable polling; default: just refetch on mount / when widgetId changes. */
  enabled?: boolean;
  staleTime?: number;
}

export function useTicketsResolve(
  widgetId: number | null | undefined,
  options: UseTicketsResolveOptions = {},
): UseQueryResult<TicketsResolveResponse, Error> {
  const { enabled = true, staleTime = 30_000 } = options;

  return useQuery<TicketsResolveResponse, Error>({
    queryKey: widgetId ? ticketsResolveKeys.byWidget(widgetId) : ticketsResolveKeys.all,
    queryFn: async () => {
      if (!widgetId) {
        // Shouldn't reach here thanks to `enabled` guard, but satisfies types.
        throw new Error('useTicketsResolve: widgetId is required');
      }
      // Backend reads filter_mode and binding from widget.config — body stays empty
      // so the client stays dumb and the server is the single source of truth.
      const response = await apiClient.post<{ data: TicketsResolveResponse } | TicketsResolveResponse>(
        `/widgets/${widgetId}/resolve-tickets`,
        {},
      );
      // apiClient normalizes `.data`; be defensive about either shape.
      const payload = response as unknown as { data?: TicketsResolveResponse } & Partial<TicketsResolveResponse>;
      if (payload?.data && Array.isArray(payload.data.tickets)) {
        return payload.data;
      }
      if (Array.isArray(payload?.tickets)) {
        return payload as TicketsResolveResponse;
      }
      // Fallback: empty but well-formed envelope so the UI can render "no tickets".
      return {
        tickets: [],
        total: 0,
        filter_mode: 'all',
        applied_filter: { space_id: null },
      };
    },
    enabled: Boolean(widgetId) && enabled,
    staleTime,
  });
}
