/**
 * useTicketRefResolve — TanStack Query hook for the ticket-as-atom feature
 * (ADR-0012 Phase 5 / M4 frontend).
 *
 * Backend contract (M3, already shipped):
 *
 *   GET /api/v3/widgets/:widgetId/tickets/:ticketId/resolve
 *
 *   200 OK → { ticket, snapshot: { title, status, assigned_to?, updated_at, snapshotted_at } }
 *   400    → { error, code: 'WIDGET_NOT_TICKETS_LINKED' }
 *   404    → ticket not found in widget's tickets table
 *
 * Mode behaviour
 * --------------
 *  - `live`     — always fetch, no placeholder, full skeleton state.
 *  - `snapshot` — never fetch (returns the frozen snapshot via `enabled: false`).
 *  - `hybrid`   — fetch in the background, but seed the query cache with the
 *                 frozen snapshot (`placeholderData`) so the card renders
 *                 instantly. On `onSuccess` the new snapshot is persisted back
 *                 onto the atoms_v2 row via `onSnapshotRefresh`.
 *
 * The hook is intentionally agnostic of *how* the snapshot is persisted — the
 * `onSnapshotRefresh` callback is wired by the caller (TicketRefAtom) using
 * `updateAtomRow({ atomId, data })`. Keeps the hook reusable and unit testable.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type {
  TicketRefMode,
  TicketRefResolveResponse,
  TicketRefSnapshot,
} from './types';

export const ticketRefResolveKeys = {
  all: ['ticket-ref-resolve'] as const,
  byPair: (widgetId: number, ticketId: number) =>
    ['ticket-ref-resolve', widgetId, ticketId] as const,
};

interface UseTicketRefResolveOptions {
  widgetId: number | null | undefined;
  ticketId: number | null | undefined;
  mode: TicketRefMode;
  /** Snapshot already persisted on the atom (hybrid placeholder + snapshot-mode source). */
  snapshot?: TicketRefSnapshot;
  /**
   * Persist a fresh snapshot back to the atom row. Called once per successful
   * background refresh — caller awaits `updateAtomRow(...)` inside.
   */
  onSnapshotRefresh?: (snapshot: TicketRefSnapshot) => void | Promise<void>;
  /** Default 30s staleTime (per brief); override for tests. */
  staleTime?: number;
}

export interface UseTicketRefResolveResult {
  query: UseQueryResult<TicketRefResolveResponse, Error>;
  /**
   * Effective snapshot to render: query.data?.snapshot in live/hybrid (when
   * present) else the frozen snapshot from props. Lets the renderer stay dumb.
   */
  effectiveSnapshot: TicketRefSnapshot | undefined;
  /** Triggers a refetch + persist; used by the "Refresh snapshot now" button. */
  refreshNow: () => Promise<TicketRefSnapshot | undefined>;
}

async function fetchResolve(widgetId: number, ticketId: number): Promise<TicketRefResolveResponse> {
  const response = await apiClient.get<
    { data: TicketRefResolveResponse } | TicketRefResolveResponse
  >(`/widgets/${widgetId}/tickets/${ticketId}/resolve`);
  const payload = response as unknown as
    & { data?: TicketRefResolveResponse }
    & Partial<TicketRefResolveResponse>;
  if (payload?.data && payload.data.snapshot) return payload.data;
  if (payload?.snapshot) return payload as TicketRefResolveResponse;
  throw new Error('Malformed resolve response');
}

export function useTicketRefResolve(
  options: UseTicketRefResolveOptions,
): UseTicketRefResolveResult {
  const { widgetId, ticketId, mode, snapshot, onSnapshotRefresh, staleTime = 30_000 } = options;
  const queryClient = useQueryClient();

  const enabled = Boolean(widgetId && ticketId) && (mode === 'live' || mode === 'hybrid');

  // Hybrid: seed the cache with the frozen snapshot so the first render shows
  // the card instantly. Live: skeleton until the network resolves.
  const placeholderData =
    mode === 'hybrid' && snapshot
      ? ({
          ticket: { id: ticketId ?? 0 },
          snapshot,
        } satisfies TicketRefResolveResponse)
      : undefined;

  const query = useQuery<TicketRefResolveResponse, Error>({
    queryKey:
      widgetId && ticketId
        ? ticketRefResolveKeys.byPair(widgetId, ticketId)
        : ticketRefResolveKeys.all,
    queryFn: () => fetchResolve(widgetId as number, ticketId as number),
    enabled,
    placeholderData,
    staleTime,
  });

  // Persist freshly-resolved snapshot back onto the atom row so the next mount
  // stays warm. Only fires when snapshotted_at actually changes.
  const lastPersistedRef = useRef<string | null>(snapshot?.snapshotted_at ?? null);
  useEffect(() => {
    if (!onSnapshotRefresh) return;
    if (mode !== 'live' && mode !== 'hybrid') return;
    const fresh = query.data?.snapshot;
    if (!fresh) return;
    if (lastPersistedRef.current === fresh.snapshotted_at) return;
    lastPersistedRef.current = fresh.snapshotted_at;
    void onSnapshotRefresh(fresh);
  }, [mode, onSnapshotRefresh, query.data?.snapshot]);

  const refreshNow = useCallback(async () => {
    if (!widgetId || !ticketId) return undefined;
    const result = await queryClient.fetchQuery<TicketRefResolveResponse, Error>({
      queryKey: ticketRefResolveKeys.byPair(widgetId, ticketId),
      queryFn: () => fetchResolve(widgetId, ticketId),
      staleTime: 0,
    });
    if (onSnapshotRefresh && result.snapshot) {
      lastPersistedRef.current = result.snapshot.snapshotted_at;
      await onSnapshotRefresh(result.snapshot);
    }
    return result.snapshot;
  }, [widgetId, ticketId, queryClient, onSnapshotRefresh]);

  // For `snapshot` mode we never fetch; for hybrid prefer fresh data when
  // present; for live always use query data (snapshot prop ignored).
  const effectiveSnapshot: TicketRefSnapshot | undefined =
    mode === 'snapshot'
      ? snapshot
      : query.data?.snapshot ?? snapshot;

  return { query, effectiveSnapshot, refreshNow };
}
