/**
 * TicketRefAtom — embedded "ticket-as-atom" renderer (ADR-0012 Phase 5 / M4).
 *
 * Reads a ticket_ref atom row from `atoms_v2` (table 3574) by id, then renders
 * it according to the atom's `props.display_mode` × `props.mode`. Three
 * display modes (`card` | `inline` | `status-only`) × three data modes
 * (`live` | `snapshot` | `hybrid`) — see ./types.ts for the canonical
 * contract.
 *
 * Snapshot persistence is handled here: every successful background refresh
 * writes the freshly-resolved snapshot back into the atom row via
 * `updateAtomRow`. The query itself lives in `useTicketRefResolve`.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  Loader2,
  RefreshCcw,
  Settings2,
  Ticket,
  User,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { useDocumentsContext } from '../../DocumentsContext';
import { isTicketRefAtomPayload, useAtomMutations, useAtomRow } from './useAtomRow';
import {
  DEFAULT_TICKET_ATOM_DISPLAY,
  DEFAULT_TICKET_ATOM_MODE,
  type TicketRefAtomPayload,
  type TicketRefDisplayMode,
  type TicketRefMode,
  type TicketRefSnapshot,
} from './types';
import { useTicketRefResolve } from './useTicketRefResolve';

interface TicketRefAtomProps {
  /** atoms_v2 row id (the value stored in DocumentItem.atom_ref). */
  atomId: number;
}

const MODE_LABELS: Record<TicketRefMode, string> = {
  live: 'Live',
  snapshot: 'Snapshot',
  hybrid: 'Hybrid',
};

const MODE_DESCRIPTIONS: Record<TicketRefMode, string> = {
  live: 'Всегда подгружать актуальные данные тикета.',
  snapshot: 'Показывать застывший снимок без сетевых запросов.',
  hybrid: 'Мгновенный снимок + фоновое обновление.',
};

/** Coarse status-color map. Mirrors getStateColor in ticketUtils.ts but works
 *  off a free-form status string instead of a dictionary id, so the atom can
 *  render before dictionaries load. */
function statusBadgeClass(status: string | undefined): string {
  if (!status) return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  const s = status.toLowerCase();
  if (s.includes('done') || s.includes('closed') || s.includes('resolved')) {
    return 'bg-green-500/20 text-green-400 border-green-500/30';
  }
  if (s.includes('progress') || s.includes('review') || s.includes('open')) {
    return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  }
  if (s.includes('hold') || s.includes('block')) {
    return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  }
  if (s.includes('backlog') || s.includes('todo')) {
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
  return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function TicketRefAtom({ atomId }: TicketRefAtomProps) {
  const ctx = useDocumentsContext();
  const atomQuery = useAtomRow(atomId);
  const { updateAtomRow } = useAtomMutations({ isReadOnly: ctx.isReadOnly });

  const payload: TicketRefAtomPayload | undefined = useMemo(() => {
    if (!atomQuery.data?.data) return undefined;
    if (isTicketRefAtomPayload(atomQuery.data.data)) return atomQuery.data.data;
    return undefined;
  }, [atomQuery.data]);

  const ticketId = payload?.props.ticket_id ?? null;
  const mode: TicketRefMode = payload?.props.mode ?? DEFAULT_TICKET_ATOM_MODE;
  const displayMode: TicketRefDisplayMode = payload?.props.display_mode ?? DEFAULT_TICKET_ATOM_DISPLAY;
  const widgetRef = payload?.widget_ref ?? null;

  const persistAtomPayload = useCallback(
    async (next: TicketRefAtomPayload) => {
      try {
        await updateAtomRow({ atomId, data: next as unknown as Record<string, unknown> });
      } catch (error) {
        logger.error('TicketRefAtom: persistAtomPayload failed', { error, atomId });
      }
    },
    [updateAtomRow, atomId],
  );

  const handleSnapshotRefresh = useCallback(
    async (snapshot: TicketRefSnapshot) => {
      if (!payload) return;
      const next: TicketRefAtomPayload = {
        ...payload,
        props: { ...payload.props, snapshot },
      };
      await persistAtomPayload(next);
    },
    [payload, persistAtomPayload],
  );

  const { query, effectiveSnapshot, refreshNow } = useTicketRefResolve({
    widgetId: widgetRef ?? ctx.widgetId,
    ticketId,
    mode,
    snapshot: payload?.props.snapshot,
    onSnapshotRefresh: ctx.isReadOnly ? undefined : handleSnapshotRefresh,
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleModeChange = useCallback(
    async (next: TicketRefMode) => {
      if (ctx.isReadOnly || !payload || next === mode) return;
      const nextPayload: TicketRefAtomPayload = {
        ...payload,
        props: { ...payload.props, mode: next },
      };
      await persistAtomPayload(nextPayload);
      setMenuOpen(false);
    },
    [ctx.isReadOnly, mode, payload, persistAtomPayload],
  );

  const handleDisplayModeChange = useCallback(
    async (next: TicketRefDisplayMode) => {
      if (ctx.isReadOnly || !payload || next === displayMode) return;
      const nextPayload: TicketRefAtomPayload = {
        ...payload,
        props: { ...payload.props, display_mode: next },
      };
      await persistAtomPayload(nextPayload);
      setMenuOpen(false);
    },
    [ctx.isReadOnly, displayMode, payload, persistAtomPayload],
  );

  const handleManualRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshNow();
    } finally {
      setRefreshing(false);
    }
  }, [refreshNow, refreshing]);

  // Loading the atom row itself (not the resolve)
  if (atomQuery.isLoading) {
    return <TicketRefSkeleton displayMode="card" />;
  }

  if (atomQuery.isError || !atomQuery.data) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400 flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Не удалось загрузить atom #{atomId}</span>
      </div>
    );
  }

  if (!payload) {
    // Atom row exists but isn't a ticket_ref payload — render a hint.
    return (
      <div className="rounded-lg border border-dashed border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-400 flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5" />
        Атом #{atomId} не относится к типу ticket_ref.
      </div>
    );
  }

  if (!ticketId) {
    return (
      <div className="rounded-lg border border-dashed border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-400 flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5" />
        Ticket id не задан в атоме
      </div>
    );
  }

  // === Loading / error states for the resolve fetch (live + hybrid only) ===
  const showSkeleton =
    !effectiveSnapshot &&
    (mode === 'live' || mode === 'hybrid') &&
    (query.isLoading || query.isFetching);

  const showError = !effectiveSnapshot && mode === 'live' && query.isError;

  if (showSkeleton) {
    return <TicketRefSkeleton displayMode={displayMode} />;
  }

  if (showError) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400 flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5" />
        <span className="flex-1">
          Не удалось загрузить тикет #{ticketId}
          {query.error instanceof Error && query.error.message ? `: ${query.error.message}` : ''}
        </span>
        <button
          type="button"
          onClick={() => query.refetch()}
          className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px]"
        >
          Повторить
        </button>
      </div>
    );
  }

  // === Body — depends on display_mode ===
  let body: React.ReactNode;
  switch (displayMode) {
    case 'inline':
      body = <TicketRefInline ticketId={ticketId} snapshot={effectiveSnapshot} />;
      break;
    case 'status-only':
      body = <TicketRefStatusOnly ticketId={ticketId} snapshot={effectiveSnapshot} />;
      break;
    case 'card':
    default:
      body = <TicketRefCard ticketId={ticketId} snapshot={effectiveSnapshot} mode={mode} />;
  }

  return (
    <div
      className={cn(
        'group relative',
        displayMode === 'card' ? 'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]' : 'inline-block',
      )}
      data-testid={`ticket-ref-atom-${atomId}`}
      data-ticket-mode={mode}
      data-ticket-display={displayMode}
    >
      {body}

      {/* Per-atom menu (mode/display-mode/refresh) */}
      {!ctx.isReadOnly && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
          {(mode === 'snapshot' || mode === 'hybrid') && (
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshing || (!widgetRef && !ctx.widgetId)}
              className="p-1 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
              title="Обновить снимок"
              data-testid="ticket-ref-atom-refresh"
            >
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              className={cn(
                'p-1 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]',
                menuOpen && 'bg-[var(--bg-tertiary)]',
              )}
              title="Настройки атома"
              data-testid="ticket-ref-atom-menu"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute top-full right-0 mt-1 z-20 min-w-[200px] rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg py-1 text-xs">
                <div className="px-3 py-1.5 text-[10px] uppercase text-[var(--text-tertiary)] font-mono">Режим данных</div>
                {(['live', 'snapshot', 'hybrid'] as TicketRefMode[]).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleModeChange(m)}
                    className={cn(
                      'w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[var(--bg-secondary)]',
                      m === mode && 'bg-[var(--bg-tertiary)]',
                    )}
                  >
                    <span className="font-medium">{MODE_LABELS[m]}{m === mode ? ' ✓' : ''}</span>
                    <span className="text-[10px] text-[var(--text-tertiary)] leading-tight">
                      {MODE_DESCRIPTIONS[m]}
                    </span>
                  </button>
                ))}

                <div className="my-1 h-px bg-[var(--border-secondary)]" />

                <div className="px-3 py-1.5 text-[10px] uppercase text-[var(--text-tertiary)] font-mono">Внешний вид</div>
                {(['card', 'inline', 'status-only'] as TicketRefDisplayMode[]).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleDisplayModeChange(d)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-[var(--bg-secondary)]',
                      d === displayMode && 'bg-[var(--bg-tertiary)]',
                    )}
                  >
                    <span>{d}</span>
                    {d === displayMode && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Display-mode sub-renderers ============

function TicketRefCard({
  ticketId,
  snapshot,
  mode,
}: {
  ticketId: number;
  snapshot: TicketRefSnapshot | undefined;
  mode: TicketRefMode;
}) {
  const status = String(snapshot?.status ?? 'unknown');
  const title = snapshot?.title || `Тикет #${ticketId}`;
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Ticket className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">#{ticketId}</span>
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-medium border',
                statusBadgeClass(status),
              )}
            >
              {status}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
              {MODE_LABELS[mode]}
            </span>
          </div>
          <div className="mt-1 text-sm font-medium text-[var(--text-primary)] truncate" title={title}>
            {title}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--text-tertiary)] flex-wrap">
            {snapshot?.assigned_to != null && (
              <span className="inline-flex items-center gap-1">
                <User className="w-3 h-3" />
                {String(snapshot.assigned_to)}
              </span>
            )}
            {snapshot?.updated_at && (
              <span title={`Обновлён: ${formatDate(snapshot.updated_at)}`}>
                upd: {formatDate(snapshot.updated_at)}
              </span>
            )}
            {snapshot?.snapshotted_at && mode !== 'live' && (
              <span
                className="text-[10px] font-mono"
                title={`Снимок от: ${formatDate(snapshot.snapshotted_at)}`}
              >
                snap: {formatDate(snapshot.snapshotted_at)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketRefInline({
  ticketId,
  snapshot,
}: {
  ticketId: number;
  snapshot: TicketRefSnapshot | undefined;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs">
      <Ticket className="w-3 h-3 text-blue-400" />
      <span className="font-mono text-[var(--text-tertiary)]">#{ticketId}</span>
      <span className="text-[var(--text-primary)] truncate max-w-[40ch]">{snapshot?.title || `Тикет #${ticketId}`}</span>
      <span className="text-[var(--text-tertiary)]">({snapshot?.status != null ? String(snapshot.status) : '?'})</span>
    </span>
  );
}

function TicketRefStatusOnly({
  ticketId,
  snapshot,
}: {
  ticketId: number;
  snapshot: TicketRefSnapshot | undefined;
}) {
  const status = String(snapshot?.status ?? 'unknown');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium',
        statusBadgeClass(status),
      )}
      title={snapshot?.title || `Тикет #${ticketId}`}
    >
      <Ticket className="w-3 h-3" />
      <span className="font-mono opacity-70">#{ticketId}</span>
      <span>{status}</span>
    </span>
  );
}

function TicketRefSkeleton({ displayMode }: { displayMode: TicketRefDisplayMode }) {
  if (displayMode === 'inline' || displayMode === 'status-only') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs animate-pulse">
        <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
        <span className="text-[var(--text-tertiary)]">загрузка…</span>
      </span>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2.5 animate-pulse">
      <div className="flex items-start gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-blue-400 mt-0.5" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2 w-1/4 rounded bg-[var(--bg-tertiary)]" />
          <div className="h-3 w-3/4 rounded bg-[var(--bg-tertiary)]" />
          <div className="h-2 w-1/3 rounded bg-[var(--bg-tertiary)]" />
        </div>
      </div>
    </div>
  );
}
