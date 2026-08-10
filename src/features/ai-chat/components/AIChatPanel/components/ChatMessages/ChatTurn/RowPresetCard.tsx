/**
 * RowPresetCard — T-141688 / ADR-0031 §Y / WP-22.
 *
 * Expanded view of a single row_reference attachment, replacing the collapsed
 * full-width strip when the user clicks the chevron. Driven by an active
 * preset (see `resolveActivePreset` in `chatSourcePresets.ts`) that decides
 * which columns to show as title / status / priority / description / icon.
 *
 * Lazy-loads the row+columns via TanStack Query, gated behind an
 * IntersectionObserver — a card scrolled out of view never issues a SELECT.
 * Off-screen → ref attached, observer watching, no fetch.
 * In-view  → 1 SELECT to GET /tables/:id/rows/:rowId + 1 SELECT to
 *            GET /tables/:id/columns. Both cached by TanStack Query.
 *
 * States: loading skeleton → data card → error pill (kept short, never
 * breaks the surrounding bubble).
 *
 * Note: relation columns (status, priority) are looked up via a single extra
 * SELECT on the relation table only when the resolved value is a numeric id
 * AND the column config carries `relationTableId`. We don't want to drag
 * `useTicketData` in for a chip — that hook fetches all rows + relations
 * up-front, which is overkill here.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Eye, Link2, MessageCirclePlus, Paperclip } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { useInView } from '@/features/widgets/components/presets/documents/content/useInView';
import { resolvePreset, type ChatSourcePreset } from '../../../../../utils/chatSourcePresets';

interface ColumnInfo {
  column_name: string;
  display_name?: string;
  type: string;
  config?: string;
}

interface RowFetchResult {
  data: Record<string, unknown>;
}

interface RelationOption {
  id: string | number;
  label: string;
  color?: string;
}

export interface RowPresetCardProps {
  preset: ChatSourcePreset;
  tableId: number;
  rowId: number;
  /** Static reference shipped with the attachment (table name, icon, fallback row title). */
  rowReference: {
    table_id: number;
    row_id: number;
    table_name: string;
    table_icon?: string;
    row_title?: string;
  };
  /** Open the row in CardDetailModal (kanban-style detail). */
  onOpenDetail: () => void;
  /** Open the row in the legacy edit form (full row dialog). */
  onOpenEdit: () => void;
  /** Bind row to current chat (sets convBoundRow). */
  onBindToChat: () => void;
  /** Attach row to next outgoing message. */
  onAttachToMessage: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────

function parseColumnConfig(raw: string | undefined): { relationTableId?: number; options?: Array<{ value: string; label: string; color?: string }> } | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

// ── component ────────────────────────────────────────────────────────────

export function RowPresetCard({
  preset,
  tableId,
  rowId,
  rowReference,
  onOpenDetail,
  onOpenEdit,
  onBindToChat,
  onAttachToMessage,
}: RowPresetCardProps) {
  const { ref: ioRef, isInView } = useInView<HTMLDivElement>({ rootMargin: '200px 0px', enabled: true });
  const enabled = isInView && tableId > 0 && rowId > 0;

  // Single row.
  const rowQuery = useQuery<RowFetchResult>({
    queryKey: ['row', tableId, rowId],
    queryFn: async () => {
      const resp = await apiClient.get<{ row?: { id: number; data: Record<string, unknown> }; data?: { row?: { data: Record<string, unknown> } } }>(`/tables/${tableId}/rows/${rowId}`);
      // Endpoint shape historically varies — handle both `{ row: { data } }`
      // and `{ data: { row: { data } } }`.
      const r = (resp as unknown as { row?: { data?: Record<string, unknown> } }).row
        ?? (resp as unknown as { data?: { row?: { data?: Record<string, unknown> } } }).data?.row;
      const data = r?.data || {};
      return { data };
    },
    enabled,
    staleTime: 30_000,
  });

  // Columns (for relation resolution).
  const columnsQuery = useQuery<ColumnInfo[]>({
    queryKey: ['table-columns-for-preset-card', tableId],
    queryFn: async () => {
      const resp = await apiClient.get<{ success: boolean; data: ColumnInfo[] }>(`/tables/${tableId}/columns`);
      return resp.success ? (resp.data || []) : [];
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  // Resolve preset → actual column names (handles `$find:a|b|c`).
  const resolved = useMemo(() => {
    if (!columnsQuery.data) return {} as Record<string, string | undefined>;
    return resolvePreset(preset, columnsQuery.data.map(c => ({ column_name: c.column_name })));
  }, [preset, columnsQuery.data]);

  // Identify relation table ids for status/priority columns (so we can
  // resolve the numeric value → human label).
  const statusRelationTableId = useMemo(() => {
    const colName = resolved.statusColumn;
    if (!colName || !columnsQuery.data) return undefined;
    const col = columnsQuery.data.find(c => c.column_name === colName);
    return parseColumnConfig(col?.config)?.relationTableId;
  }, [resolved.statusColumn, columnsQuery.data]);

  const priorityRelationTableId = useMemo(() => {
    const colName = resolved.priorityColumn;
    if (!colName || !columnsQuery.data) return undefined;
    const col = columnsQuery.data.find(c => c.column_name === colName);
    return parseColumnConfig(col?.config)?.relationTableId;
  }, [resolved.priorityColumn, columnsQuery.data]);

  // Lazy-fetch the relation tables only if we have an id-typed value to
  // resolve. Each relation table is its own cache key — shared with anything
  // else in the app that fetches the same dictionary.
  const statusDictQuery = useQuery<RelationOption[]>({
    queryKey: ['relation-options', statusRelationTableId],
    queryFn: () => fetchRelationOptions(statusRelationTableId!),
    enabled: enabled && !!statusRelationTableId,
    staleTime: 5 * 60_000,
  });
  const priorityDictQuery = useQuery<RelationOption[]>({
    queryKey: ['relation-options', priorityRelationTableId],
    queryFn: () => fetchRelationOptions(priorityRelationTableId!),
    enabled: enabled && !!priorityRelationTableId,
    staleTime: 5 * 60_000,
  });

  const isLoading = enabled && (rowQuery.isLoading || columnsQuery.isLoading);
  const isError = rowQuery.isError || columnsQuery.isError;

  // ── extracted display values ─────────────────────────────────────────
  const rowData = rowQuery.data?.data || {};

  const titleColName = resolved.displayColumn;
  const title = (titleColName && asString(rowData[titleColName])) || rowReference.row_title || `#${rowId}`;

  const iconColName = resolved.iconColumn;
  const icon = (iconColName && asString(rowData[iconColName])) || rowReference.table_icon;

  const descriptionColName = resolved.descriptionColumn;
  const description = descriptionColName ? asString(rowData[descriptionColName]) : undefined;

  const statusColName = resolved.statusColumn;
  const statusRaw = statusColName ? rowData[statusColName] : undefined;
  const statusOption = useMemo(() => resolveOption(statusRaw, statusDictQuery.data), [statusRaw, statusDictQuery.data]);

  const priorityColName = resolved.priorityColumn;
  const priorityRaw = priorityColName ? rowData[priorityColName] : undefined;
  const priorityOption = useMemo(() => resolveOption(priorityRaw, priorityDictQuery.data), [priorityRaw, priorityDictQuery.data]);

  // ── render ───────────────────────────────────────────────────────────

  return (
    <div
      ref={ioRef}
      className="w-full rounded-lg bg-[rgba(59,130,246,0.06)] border border-[rgba(59,130,246,0.2)] p-2.5 space-y-2"
    >
      {!isInView ? (
        // Off-screen placeholder — same height as skeleton to avoid jump.
        <RowPresetCardSkeleton />
      ) : isLoading ? (
        <RowPresetCardSkeleton />
      ) : isError ? (
        <div className="flex items-center gap-2 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">Не удалось загрузить строку #{rowId}</span>
        </div>
      ) : (
        <>
          {/* Header row */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base flex-shrink-0">{icon || <Link2 className="w-4 h-4 text-blue-400 inline" />}</span>
            <button
              type="button"
              onClick={onOpenDetail}
              className="flex-1 min-w-0 text-left text-sm font-medium truncate text-blue-300 hover:text-blue-200 hover:underline"
              title={title}
            >
              {title}
            </button>
            {statusOption && (
              <span
                className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{
                  backgroundColor: statusOption.color ? hexToRgba(statusOption.color, 0.15) : 'rgba(255,255,255,0.08)',
                  color: statusOption.color || 'var(--text-secondary)',
                }}
              >
                {statusOption.label}
              </span>
            )}
            {priorityOption && (
              <span
                className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: priorityOption.color ? hexToRgba(priorityOption.color, 0.15) : 'rgba(255,255,255,0.08)',
                  color: priorityOption.color || 'var(--text-tertiary)',
                }}
              >
                {priorityOption.label}
              </span>
            )}
          </div>

          {/* Body — description preview, clamped to 2 lines */}
          {description && (
            <button
              type="button"
              onClick={onOpenDetail}
              className="block w-full text-left text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
              title={description}
            >
              {description}
            </button>
          )}

          {/* Footer — 4 inline action icons */}
          <div className="flex items-center gap-1 pt-1">
            <ActionIconButton title="Открыть карточку" onClick={onOpenDetail}>
              <Eye className="w-3.5 h-3.5" />
            </ActionIconButton>
            <ActionIconButton title="Открыть полный диалог" onClick={onOpenEdit}>
              <ExternalLink className="w-3.5 h-3.5" />
            </ActionIconButton>
            <ActionIconButton title="Привязать к чату" onClick={onBindToChat}>
              <MessageCirclePlus className="w-3.5 h-3.5" />
            </ActionIconButton>
            <ActionIconButton title="Прикрепить к сообщению" onClick={onAttachToMessage}>
              <Paperclip className="w-3.5 h-3.5" />
            </ActionIconButton>
            <span className="ml-auto text-[10px] text-[var(--text-tertiary)] truncate">
              {rowReference.table_name} #{rowId}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── sub-components ──────────────────────────────────────────────────────

function RowPresetCardSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded bg-white/10 flex-shrink-0" />
        <div className="flex-1 h-4 rounded bg-white/10" />
        <div className="w-12 h-4 rounded bg-white/10 flex-shrink-0" />
      </div>
      <div className="h-3 rounded bg-white/5 w-11/12" />
      <div className="h-3 rounded bg-white/5 w-2/3" />
      <div className="flex items-center gap-1 pt-1">
        <div className="w-6 h-6 rounded bg-white/10" />
        <div className="w-6 h-6 rounded bg-white/10" />
        <div className="w-6 h-6 rounded bg-white/10" />
        <div className="w-6 h-6 rounded bg-white/10" />
      </div>
    </div>
  );
}

function ActionIconButton({
  title, onClick, children,
}: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
    >
      {children}
    </button>
  );
}

// ── helpers (data) ──────────────────────────────────────────────────────

async function fetchRelationOptions(tableId: number): Promise<RelationOption[]> {
  // Fetch the dictionary table's rows. Standard /rows endpoint paginates —
  // dict tables are tiny (status/priority typically <20 entries), so a
  // generous limit is safe.
  const resp = await apiClient.get<{ rows?: Array<{ id: number; data: Record<string, unknown> }>; data?: { rows?: Array<{ id: number; data: Record<string, unknown> }> } }>(
    `/tables/${tableId}/rows?limit=200`,
  );
  const rows = (resp as unknown as { rows?: Array<{ id: number; data: Record<string, unknown> }> }).rows
    ?? (resp as unknown as { data?: { rows?: Array<{ id: number; data: Record<string, unknown> }> } }).data?.rows
    ?? [];
  return rows.map(r => ({
    id: r.id,
    label: asString(r.data?.label) || asString(r.data?.name) || asString(r.data?.title) || asString(r.data?.value) || `#${r.id}`,
    color: typeof r.data?.color === 'string' ? r.data.color as string : undefined,
  }));
}

function resolveOption(rawValue: unknown, options: RelationOption[] | undefined): RelationOption | null {
  if (rawValue == null || rawValue === '') return null;
  if (!options || options.length === 0) {
    // No dictionary fetched (column isn't a relation, or fetch hasn't
    // resolved yet). Fall back to the raw value as-is.
    const s = asString(rawValue);
    return s ? { id: s, label: s } : null;
  }
  const key = String(rawValue);
  const hit = options.find(o => String(o.id) === key);
  return hit || null;
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6 && cleaned.length !== 3) return `rgba(255,255,255,${alpha})`;
  const full = cleaned.length === 3
    ? cleaned.split('').map(c => c + c).join('')
    : cleaned;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default RowPresetCard;
