/**
 * BddCompanionPanel — ADR-0003 §C-1 + §C-7 + §C-8
 *
 * Mounts in the document header (NOT as a body atom) for widgets where
 * `config.bdd_enabled === true`. Lists acceptance criteria with:
 *   • priority chip (must/should/could/wont)
 *   • state badge (pending / agent_claimed / verified / regressed / failed / waived)
 *   • linked-ticket count (when criterion.linked_tickets present)
 *   • must-progress bar: `verified / total_must` — green 100%, amber partial, red if any regressed
 *   • filter chips: all | locked (verified) | unlocked (pending/failed/claimed) | regressed
 *   • URL-persisted filter (?bddFilter=regressed)
 *   • keyboard navigation across chips (ArrowLeft/ArrowRight + Enter)
 *   • live updates via SSE (/api/v3/bdd/events)
 *
 * Click on a criterion row fires `onCriterionClick(criterion)` — parent wires
 * this to C-8 scoped conversation sidebar. When no handler, row is read-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  Circle,
  AlertTriangle,
  XCircle,
  RotateCcw,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { getAccessToken, getBaseUrlSync } from '@/shared/utils/apiClient';

export type BddCriterionStatus =
  | 'pending'
  | 'in_progress'
  | 'agent_claimed'
  // ADR-156 legacy state (equivalent to `verified` in ADR-0003)
  | 'human_confirmed'
  // ADR-0003 §C-4 canonical state
  | 'verified'
  | 'waived'
  | 'failed'
  // ADR-0003 §C-3
  | 'regressed';

export type BddPriority = 'must' | 'should' | 'could' | 'wont';

export interface BddCriterion {
  id: number;
  code?: string | null;
  /** ADR-0002 §8 Phase 2 — canonical Given/When/Then split. */
  given?: string | null;
  /** Backend may serve as `when` (mapped from column `when_clause`); legacy alias kept. */
  when?: string | null;
  then?: string | null;
  /** ADR-0002 §8 Phase 2 (G7.1) — legacy markdown fallback for rows authored
   *  before the G/W/T split. Hidden once any of given/when/then is non-empty. */
  description?: string | null;
  /** Title is the short summary; rendered as the row label when G/W/T are empty. */
  title?: string | null;
  priority?: BddPriority | string | null;
  status?: BddCriterionStatus | string | null;
  claimed_at?: string | null;
  owner_user_id?: number | null;
  spec_owner_user_id?: number | null;
  enrolled?: boolean;
  /** Optional — number of tickets linked to this criterion (null when backend didn't provide). */
  linked_tickets_count?: number | null;
}

export interface BddSpec {
  id: number;
  code: string;
  owner_user_id?: number | null;
  criteria: BddCriterion[];
}

export type BddFilter = 'all' | 'locked' | 'unlocked' | 'regressed';

export interface BddCompanionPanelProps {
  docId: number;
  /** Called when user clicks a criterion row. When omitted, rows are read-only. */
  onCriterionClick?: (criterion: BddCriterion, spec: BddSpec) => void;
  /** Optional initial filter (e.g. from URL on mount). Falls back to 'all'. */
  initialFilter?: BddFilter;
}

/* --------------------------- utilities --------------------------- */

const FILTERS: BddFilter[] = ['all', 'locked', 'unlocked', 'regressed'];
const FILTER_LABELS: Record<BddFilter, string> = {
  all: 'All',
  locked: 'Locked',
  unlocked: 'Unlocked',
  regressed: 'Regressed',
};

function isVerified(status?: string | null): boolean {
  return status === 'verified' || status === 'human_confirmed';
}

function isRegressed(status?: string | null): boolean {
  return status === 'regressed';
}

function matchesFilter(status: string | null | undefined, filter: BddFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'locked':
      return isVerified(status);
    case 'regressed':
      return isRegressed(status);
    case 'unlocked':
      // Anything not verified and not regressed is "unlocked" — pending, in_progress,
      // agent_claimed, failed, waived.
      return !isVerified(status) && !isRegressed(status);
    default:
      return true;
  }
}

function statusIcon(status?: string | null) {
  if (isVerified(status)) {
    return <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" aria-label="verified" />;
  }
  if (isRegressed(status)) {
    return <RotateCcw className="w-4 h-4 text-red-600 dark:text-red-400" aria-label="regressed" />;
  }
  switch (status) {
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

function stateBadge(status?: string | null): { label: string; cls: string } {
  if (isVerified(status)) return { label: 'verified', cls: 'bg-green-500/20 text-green-700 dark:text-green-300' };
  if (isRegressed(status)) return { label: 'regressed', cls: 'bg-red-500/20 text-red-700 dark:text-red-300' };
  switch (status) {
    case 'agent_claimed':
      return { label: 'claimed', cls: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' };
    case 'failed':
      return { label: 'failed', cls: 'bg-red-500/20 text-red-700 dark:text-red-300' };
    case 'waived':
      return { label: 'waived', cls: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' };
    case 'in_progress':
      return { label: 'in progress', cls: 'bg-blue-500/20 text-blue-700 dark:text-blue-300' };
    case 'pending':
    default:
      return { label: 'pending', cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' };
  }
}

function priorityBadge(priority?: string | null): { label: string; cls: string } | null {
  if (!priority) return null;
  const key = String(priority).toLowerCase();
  switch (key) {
    case 'must':
      return { label: 'must', cls: 'bg-red-500/20 text-red-700 dark:text-red-300' };
    case 'should':
      return { label: 'should', cls: 'bg-orange-500/20 text-orange-700 dark:text-orange-300' };
    case 'could':
      return { label: 'could', cls: 'bg-blue-500/20 text-blue-700 dark:text-blue-300' };
    case 'wont':
    case "won't":
      return { label: "won't", cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' };
    default:
      return { label: key, cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' };
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
    `${baseUrl}/bdd/specs?source_doc_id=${encodeURIComponent(String(docId))}&with_criteria=true`,
    { credentials: 'include', headers, signal },
  );
  if (res.status === 404) {
    logger.debug('[BddCompanionPanel] /bdd/specs not available (404)');
    return { specs: null, available: false };
  }
  if (!res.ok) throw new Error(`Failed to load BDD specs (${res.status})`);
  const data = (await res.json()) as { data?: { specs?: BddSpec[] }; specs?: BddSpec[] };
  const specs = data?.data?.specs ?? data?.specs ?? [];
  return { specs, available: true };
}

/* --------------------------- component --------------------------- */

export function BddCompanionPanel({
  docId,
  onCriterionClick,
  initialFilter,
}: BddCompanionPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['bdd', 'specs', docId] as const, [docId]);

  // --- URL-persisted filter (?bddFilter=...) ---
  const [filter, setFilter] = useState<BddFilter>(() => {
    if (typeof window === 'undefined') return initialFilter || 'all';
    const url = new URL(window.location.href);
    const f = url.searchParams.get('bddFilter');
    if (f && (FILTERS as string[]).includes(f)) return f as BddFilter;
    return initialFilter || 'all';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (filter === 'all') url.searchParams.delete('bddFilter');
    else url.searchParams.set('bddFilter', filter);
    window.history.replaceState({}, '', url.toString());
  }, [filter]);

  // --- Data ---
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchSpecs(docId, signal),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const specs = data?.specs ?? [];
  const available = data?.available !== false;

  // --- SSE live updates (mirrors ADRAcceptancePanel) ---
  useEffect(() => {
    if (!available) return;
    const baseUrl = getBaseUrlSync();
    const token = getAccessToken();
    const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${baseUrl}/bdd/events${tokenQs}`, { withCredentials: true });
    } catch (err) {
      logger.debug('[BddCompanionPanel] failed to open EventSource', err);
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
        logger.debug('[BddCompanionPanel] SSE parse error', err);
      }
    };

    es.addEventListener('message', handle);
    for (const ch of [
      'bdd.criterion.claimed',
      'bdd.criterion.verified',
      'bdd.criterion.confirmed',
      'bdd.criterion.waived',
      'bdd.criterion.failed',
      'bdd.criterion.regressed',
    ]) {
      es.addEventListener(ch, handle as EventListener);
    }
    es.onerror = () => {
      logger.debug('[BddCompanionPanel] SSE error');
    };
    return () => { es?.close(); };
  }, [available, docId, queryClient, queryKey]);

  // --- Aggregate stats for must-progress bar ---
  const stats = useMemo(() => {
    let total = 0;
    let verified = 0;
    let mustTotal = 0;
    let mustVerified = 0;
    let regressedCount = 0;
    for (const spec of specs) {
      for (const c of spec.criteria || []) {
        total++;
        if (isVerified(c.status)) verified++;
        if (isRegressed(c.status)) regressedCount++;
        if (c.priority === 'must') {
          mustTotal++;
          if (isVerified(c.status)) mustVerified++;
        }
      }
    }
    return { total, verified, mustTotal, mustVerified, regressedCount };
  }, [specs]);

  const mustPct = stats.mustTotal > 0 ? Math.round((stats.mustVerified / stats.mustTotal) * 100) : 0;
  const progressColor =
    stats.regressedCount > 0
      ? 'bg-red-500'
      : stats.mustTotal > 0 && stats.mustVerified === stats.mustTotal
        ? 'bg-green-500'
        : 'bg-amber-500';

  // --- Filtered specs (client-side, no re-fetch) ---
  const filteredSpecs = useMemo(() => {
    if (filter === 'all') return specs;
    return specs
      .map(s => ({ ...s, criteria: (s.criteria || []).filter(c => matchesFilter(c.status, filter)) }))
      .filter(s => s.criteria.length > 0);
  }, [specs, filter]);

  // --- Keyboard navigation across chips ---
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleChipKeyDown = (idx: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const next = (idx + delta + FILTERS.length) % FILTERS.length;
      chipRefs.current[next]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setFilter(FILTERS[idx]);
    }
  };

  /* ------------------------- render ------------------------- */
  if (!available) return null;
  if (isLoading && specs.length === 0) return null;
  if (specs.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* ===== Header with progress + stats ===== */}
      <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3 flex-wrap">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 inline-flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
          Acceptance Criteria
        </div>
        {stats.mustTotal > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 min-w-[180px] flex-1 max-w-[320px]">
            <span className="font-mono whitespace-nowrap">
              must {stats.mustVerified}/{stats.mustTotal}
            </span>
            <div className="flex-1 h-2 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
              <div
                role="progressbar"
                aria-valuenow={mustPct}
                aria-valuemin={0}
                aria-valuemax={100}
                className={cn('h-full transition-all', progressColor)}
                style={{ width: `${mustPct}%` }}
              />
            </div>
            <span className="font-mono whitespace-nowrap">{mustPct}%</span>
          </div>
        )}
        <div className="text-xs text-gray-500 dark:text-gray-400 ml-auto font-mono whitespace-nowrap">
          {stats.verified}/{stats.total} verified
          {stats.regressedCount > 0 && (
            <span className="ml-2 text-red-600 dark:text-red-400">{stats.regressedCount} regressed</span>
          )}
        </div>
      </div>

      {/* ===== Toolbar: filter chips ===== */}
      <div
        role="tablist"
        aria-label="BDD filter"
        className="px-4 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2 flex-wrap"
      >
        {FILTERS.map((f, i) => {
          const active = filter === f;
          return (
            <button
              key={f}
              ref={(el) => { chipRefs.current[i] = el; }}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setFilter(f)}
              onKeyDown={handleChipKeyDown(i)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                active
                  ? 'bg-[var(--color-primary-500)] text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
              )}
            >
              {FILTER_LABELS[f]}
            </button>
          );
        })}
      </div>

      {/* ===== Criteria list ===== */}
      {filteredSpecs.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          No criteria match this filter.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {filteredSpecs.map((spec) => (
            <div key={spec.id} className="px-4 py-2">
              <div className="text-xs font-mono text-gray-500 dark:text-gray-400 mb-1">
                {spec.code}
              </div>
              <ul className="space-y-1">
                {spec.criteria.map((c) => {
                  const pb = priorityBadge(c.priority);
                  const sb = stateBadge(c.status);
                  const clickable = !!onCriterionClick;
                  // ADR-0002 §8 Phase 2 (G7.1) — render G/W/T block when at
                  // least one of the canonical fields is populated; otherwise
                  // fall back to legacy `description` (or `then`/title).
                  const hasGwt = !!(c.given || c.when || c.then);
                  const fallbackLabel = c.description || c.title || `#${c.id}`;
                  const headlineLabel = hasGwt ? (c.then || c.given || c.when || '—') : fallbackLabel;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={clickable ? () => onCriterionClick!(c, spec) : undefined}
                        disabled={!clickable}
                        className={cn(
                          'w-full flex flex-col items-stretch text-left text-sm rounded px-1 py-1',
                          clickable && 'hover:bg-gray-50 dark:hover:bg-gray-800/60 cursor-pointer',
                          !clickable && 'cursor-default',
                        )}
                        title={hasGwt ? [c.given && `Given ${c.given}`, c.when && `When ${c.when}`, c.then && `Then ${c.then}`].filter(Boolean).join('\n') : (fallbackLabel || c.code || '')}
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex-shrink-0">{statusIcon(c.status)}</span>
                          <span className="font-mono text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 w-20 truncate">
                            {c.code || `#${c.id}`}
                          </span>
                          {pb && (
                            <span className={cn('flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide', pb.cls)}>
                              {pb.label}
                            </span>
                          )}
                          <span
                            className={cn(
                              'flex-1 text-gray-800 dark:text-gray-200 truncate',
                              isVerified(c.status) && 'line-through text-gray-500',
                            )}
                          >
                            {headlineLabel}
                          </span>
                          <span className={cn('flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide', sb.cls)}>
                            {sb.label}
                          </span>
                          {typeof c.linked_tickets_count === 'number' && c.linked_tickets_count > 0 && (
                            <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[11px] text-gray-500 dark:text-gray-400" title={`${c.linked_tickets_count} linked ticket(s)`}>
                              <MessageSquare className="w-3 h-3" />
                              {c.linked_tickets_count}
                            </span>
                          )}
                        </div>
                        {hasGwt && (c.given || c.when) && (
                          <div className="mt-1 ml-7 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                            {c.given && (
                              <div className="truncate"><span aria-hidden="true">📍</span> <span className="font-semibold">Given</span> {c.given}</div>
                            )}
                            {c.when && (
                              <div className="truncate"><span aria-hidden="true">⚡</span> <span className="font-semibold">When</span> {c.when}</div>
                            )}
                            {c.then && (c.given || c.when) && (
                              <div className="truncate"><span aria-hidden="true">✅</span> <span className="font-semibold">Then</span> {c.then}</div>
                            )}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default BddCompanionPanel;
