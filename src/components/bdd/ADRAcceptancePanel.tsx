/**
 * ADRAcceptancePanel — ADR-156 Phase 5D (Frontend scaffold)
 *
 * Top-of-document panel shown on ADRs that have linked BDD specs. Lists each
 * criterion with its current status; for criteria in `agent_claimed` where
 * the current user owns the spec, mounts an inline ACConfirmationCard.
 *
 * Live updates via SSE: GET /api/v3/bdd/events
 *   - bdd.criterion.claimed
 *   - bdd.criterion.confirmed
 *   - bdd.criterion.waived
 *   - bdd.criterion.failed
 *   On any event referencing a doc in `specs`, refetch via TanStack Query.
 *
 * Gracefully hidden when the backend API is not yet deployed (404).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Circle, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { getAccessToken, getBaseUrlSync } from '@/shared/utils/apiClient';
import { ACConfirmationCard, type ACCriterion } from './ACConfirmationCard';

export type CriterionStatus =
  | 'pending'
  | 'in_progress'
  | 'agent_claimed'
  | 'human_confirmed'
  | 'waived'
  | 'failed';

export interface BddCriterion extends ACCriterion {
  status?: CriterionStatus | string;
  owner_user_id?: number | null;
  spec_owner_user_id?: number | null;
}

export interface BddSpec {
  id: number;
  code: string;
  owner_user_id?: number | null;
  criteria: BddCriterion[];
}

export interface ADRAcceptancePanelProps {
  docId: number;
  specs: BddSpec[];
  /** Current viewer's user id — used to decide who sees Confirm actions. */
  currentUserId?: number | null;
}

/* ------------------------------ utilities ------------------------------ */

function statusIcon(status?: string) {
  switch (status) {
    case 'human_confirmed':
      return <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" aria-label="confirmed" />;
    case 'agent_claimed':
      return <Clock className="w-4 h-4 text-amber-500 dark:text-amber-400" aria-label="agent claimed" />;
    case 'waived':
      return <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" aria-label="waived" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" aria-label="failed" />;
    case 'in_progress':
      return <Clock className="w-4 h-4 text-blue-500 dark:text-blue-400" aria-label="in progress" />;
    case 'pending':
    default:
      return <Circle className="w-4 h-4 text-gray-400 dark:text-gray-500" aria-label="pending" />;
  }
}

async function fetchSpecs(
  docId: number,
  signal?: AbortSignal,
): Promise<{ specs: BddSpec[] | null; available: boolean }> {
  const baseUrl = getBaseUrlSync();
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(
    `${baseUrl}/bdd/specs?source_doc_id=${encodeURIComponent(String(docId))}`,
    { credentials: 'include', headers, signal },
  );
  if (res.status === 404) {
    // Backend not deployed yet — graceful hide.
    logger.debug('[ADRAcceptancePanel] /bdd/specs not available (404)');
    return { specs: null, available: false };
  }
  if (!res.ok) {
    throw new Error(`Failed to load BDD specs (${res.status})`);
  }
  const data = (await res.json()) as { data?: { specs?: BddSpec[] }; specs?: BddSpec[] };
  const specs = data?.data?.specs ?? data?.specs ?? [];
  return { specs, available: true };
}

/* ------------------------------ component ------------------------------ */

export function ADRAcceptancePanel({
  docId,
  specs: initialSpecs,
  currentUserId = null,
}: ADRAcceptancePanelProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['bdd', 'specs', docId] as const, [docId]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchSpecs(docId, signal),
    initialData: { specs: initialSpecs, available: true },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const specs = data?.specs ?? initialSpecs;
  const available = data?.available !== false;

  /* ------------------------- SSE live updates ------------------------- */
  useEffect(() => {
    if (!available) return;
    const baseUrl = getBaseUrlSync();
    const token = getAccessToken();
    // EventSource does not support custom headers; pass token via query if present.
    const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${baseUrl}/bdd/events${tokenQs}`, { withCredentials: true });
    } catch (err) {
      logger.debug('[ADRAcceptancePanel] failed to open EventSource', err);
      return;
    }

    const handle = (e: MessageEvent) => {
      try {
        const payload = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const eventDocId = payload?.doc_id ?? payload?.source_doc_id;
        const eventName = payload?.event ?? e.type;
        if (!eventName || !String(eventName).startsWith('bdd.criterion.')) return;
        if (eventDocId && Number(eventDocId) !== Number(docId)) return;
        queryClient.invalidateQueries({ queryKey });
      } catch (err) {
        logger.debug('[ADRAcceptancePanel] SSE parse error', err);
      }
    };

    es.addEventListener('message', handle);
    es.addEventListener('bdd.criterion.claimed', handle as EventListener);
    es.addEventListener('bdd.criterion.confirmed', handle as EventListener);
    es.addEventListener('bdd.criterion.waived', handle as EventListener);
    es.addEventListener('bdd.criterion.failed', handle as EventListener);
    es.onerror = () => {
      // Silently close — EventSource will attempt to reconnect automatically
      // if the server is reachable; otherwise we just give up.
      logger.debug('[ADRAcceptancePanel] SSE error, closing');
    };

    return () => {
      es?.close();
    };
  }, [available, docId, queryClient, queryKey]);

  /* ------------------------- Derived stats ------------------------- */
  const stats = useMemo(() => {
    let total = 0;
    let confirmed = 0;
    let claimed = 0;
    let pending = 0;
    let mustTotal = 0;
    let mustConfirmed = 0;
    for (const spec of specs || []) {
      for (const c of spec.criteria || []) {
        total++;
        if (c.priority === 'must') mustTotal++;
        if (c.status === 'human_confirmed') {
          confirmed++;
          if (c.priority === 'must') mustConfirmed++;
        } else if (c.status === 'agent_claimed') {
          claimed++;
        } else if (!c.status || c.status === 'pending' || c.status === 'in_progress') {
          pending++;
        }
      }
    }
    return { total, confirmed, claimed, pending, mustTotal, mustConfirmed };
  }, [specs]);

  const allMustConfirmed = stats.mustTotal > 0 && stats.mustConfirmed === stats.mustTotal;

  const handleConfirmed = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  /* ------------------------- Render ------------------------- */
  if (!available) return null; // graceful hide
  if (isLoading && (!specs || specs.length === 0)) return null;
  if (!specs || specs.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 inline-flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
          Acceptance Criteria —{' '}
          <span className="font-mono">
            {stats.confirmed}/{stats.total} confirmed
          </span>
          <span className="mx-1 text-gray-400">·</span>
          <span className="font-mono">{stats.claimed} claimed</span>
          <span className="mx-1 text-gray-400">·</span>
          <span className="font-mono">{stats.pending} pending</span>
        </div>
      </div>

      {/* Resolved banner */}
      {allMustConfirmed && (
        <div className="px-4 py-2 bg-green-50 dark:bg-green-900/30 border-b border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200 inline-flex items-center gap-2 w-full">
          <CheckCircle2 className="w-4 h-4" />
          ADR resolved. Orchestrator notified.
        </div>
      )}

      {/* Criteria list */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {specs.map((spec) => (
          <div key={spec.id} className="px-4 py-2">
            <div className="text-xs font-mono text-gray-500 dark:text-gray-400 mb-1">
              {spec.code}
            </div>
            <div className="space-y-1">
              {(spec.criteria || []).map((c) => {
                const isOwner =
                  currentUserId != null &&
                  (spec.owner_user_id === currentUserId ||
                    c.spec_owner_user_id === currentUserId ||
                    c.owner_user_id === currentUserId);
                const showConfirm = c.status === 'agent_claimed' && isOwner;
                // ADR-0002 §8 Phase 2 (G7.1) — fall back to legacy
                // `description` when canonical G/W/T are all empty.
                const cAny = c as { given?: string | null; when?: string | null; then?: string | null; description?: string | null; title?: string | null };
                const hasGwt = !!(cAny.given || cAny.when || cAny.then);
                const headline = hasGwt
                  ? (cAny.then || cAny.given || cAny.when || '')
                  : (cAny.description || cAny.title || cAny.then || '');
                return (
                  <div key={c.id}>
                    <div className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 flex-shrink-0">{statusIcon(c.status)}</span>
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 w-24 truncate">
                        {c.code}
                      </span>
                      <span
                        className={cn(
                          'flex-1 text-gray-800 dark:text-gray-200 truncate',
                          c.status === 'human_confirmed' && 'line-through text-gray-500',
                        )}
                        title={hasGwt ? [cAny.given && `Given ${cAny.given}`, cAny.when && `When ${cAny.when}`, cAny.then && `Then ${cAny.then}`].filter(Boolean).join('\n') : (headline || '')}
                      >
                        {headline}
                      </span>
                    </div>
                    {showConfirm && (
                      <ACConfirmationCard criterion={c} onConfirmed={handleConfirmed} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ADRAcceptancePanel;
