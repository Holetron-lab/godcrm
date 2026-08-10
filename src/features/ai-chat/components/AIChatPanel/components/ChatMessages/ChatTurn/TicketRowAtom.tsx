/**
 * TicketRowAtom — T-141688 / ADR-0031 §Y / WP-22.
 *
 * Renders a single row from a chat `row_reference` attachment using the
 * REAL widget components from the tickets-list preset (TicketRowHeader +
 * TicketCardContent) — exactly the same look as the docs-widget tickets
 * list, just for one row, without the list shell / filters / search.
 *
 * Inputs are minimal: `tableId, rowId`. Everything else (column mapping,
 * dictionaries, color column, assignees) is auto-discovered from the
 * table's column metadata — same logic the widget itself uses
 * (`autoMapColumns` / `autoMapDictionaries` / `useTicketDictionaries`).
 *
 * Lazy-mounts via IntersectionObserver — a card scrolled out of view
 * never fires its first SELECT.
 *
 * Mutations PUT to `/tables/:id/rows/:rowId` then invalidate the local
 * row query so the chat card and any open list view stay in sync.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { TicketRowHeader } from '@/features/widgets/components/presets/documents/content/TicketRowHeader';
import { TicketCardContent } from '@/shared/components/TicketCardContent';
import {
  autoMapColumns,
  autoMapDictionaries,
  useTicketDictionaries,
  getTicketField,
  getTicketTitle,
  type TicketRow,
} from '@/features/widgets/components/presets/documents/content/ticketUtils';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { TicketBindingConfig } from '@/features/widgets/types/documents.types';
import { useInView } from '@/features/widgets/components/presets/documents/content/useInView';

interface ColumnInfoAPI {
  /** API returns column_name AS name */
  name: string;
  display_name?: string;
  /** API returns type AS column_type */
  column_type: string;
  config?: string;
}

export interface TicketRowAtomProps {
  tableId: number;
  rowId: number;
  rowReference: {
    table_id: number;
    row_id: number;
    table_name: string;
    table_icon?: string;
    row_title?: string;
  };
  /** Open the row in the legacy edit form (full row dialog). */
  onOpenEdit: () => void;
  /** Open the row's own task chat thread (chat-bubble icon). */
  onOpenTaskChat: () => void;
  /** Attach row to next outgoing message. */
  onAttachToMessage: () => void;
}

export function TicketRowAtom({
  tableId,
  rowId,
  rowReference,
  onOpenEdit,
  onOpenTaskChat,
  onAttachToMessage,
}: TicketRowAtomProps) {
  const queryClient = useQueryClient();
  const { ref: ioRef, isInView } = useInView<HTMLDivElement>({ rootMargin: '200px 0px', enabled: true });
  const enabled = isInView && tableId > 0 && rowId > 0;

  const [isExpanded, setIsExpanded] = useState(false);

  const rowQueryKey = useMemo(() => ['ticket-row-atom', tableId, rowId] as const, [tableId, rowId]);

  // Single row.
  const rowQuery = useQuery<TicketRow>({
    queryKey: rowQueryKey,
    queryFn: async () => {
      const resp = await apiClient.get<{ row?: { id: number; data: Record<string, unknown> }; data?: { row?: { id: number; data: Record<string, unknown> } } }>(`/tables/${tableId}/rows/${rowId}`);
      const r = (resp as unknown as { row?: { id: number; data?: Record<string, unknown> } }).row
        ?? (resp as unknown as { data?: { row?: { id: number; data?: Record<string, unknown> } } }).data?.row;
      if (!r) throw new Error('Row not found');
      // Flatten: { id, ...data } so getTicketField/getTicketTitle resolveRowData
      // sees both legacy (data.field) and flat (.field) shapes.
      return { id: Number(r.id), ...(r.data || {}) } as TicketRow;
    },
    enabled,
    staleTime: 30_000,
  });

  // Columns — used both for ticket-config mapping and for color/assignee discovery.
  const columnsQuery = useQuery<ColumnInfoAPI[]>({
    queryKey: ['ticket-row-atom-columns', tableId],
    queryFn: async () => {
      const resp = await apiClient.get<{ data: ColumnInfoAPI[] }>(`/tables/${tableId}/columns`);
      return resp.data || [];
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  // Build a TicketBindingConfig from raw columns — same auto-discovery as
  // useTicketConfig but without needing a project_id (we already know the
  // table_id from the chat attachment).
  const ticketConfig = useMemo<TicketBindingConfig | null>(() => {
    if (!columnsQuery.data) return null;
    const cols = columnsQuery.data;
    const mapped = autoMapColumns(cols);
    const dicts = autoMapDictionaries(cols);
    if (!mapped.title) return null; // Need at least a title column.
    return {
      table_id: tableId,
      columns: mapped,
      dictionaries: dicts,
    };
  }, [columnsQuery.data, tableId]);

  const { types, states, priorities } = useTicketDictionaries(ticketConfig);

  // ColumnModel array for TicketRowHeader — it expects normalized shape
  // (.name, .type) but tolerates .column_type via a runtime check.
  const tableColumns = useMemo<ColumnModel[]>(() => {
    return (columnsQuery.data || []).map(c => ({
      name: c.name,
      display_name: c.display_name || c.name,
      type: c.column_type,
      config: c.config,
    } as unknown as ColumnModel));
  }, [columnsQuery.data]);

  // Assignee picker — discover relation table for assigned_to / assigned / assignee.
  const assignedRelTableId = useMemo(() => {
    const col = (columnsQuery.data || []).find(c => ['assigned_to', 'assigned', 'assignee'].includes(c.name));
    if (!col?.config) return null;
    try {
      const cfg = JSON.parse(col.config) as { relation?: { tableId?: number | string }; relatedTableId?: number | string };
      const id = Number(cfg?.relation?.tableId ?? cfg?.relatedTableId);
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }, [columnsQuery.data]);

  const { data: assignedRows } = useQuery<Array<Record<string, unknown>>>({
    queryKey: ['ticket-row-atom-assigned', assignedRelTableId],
    queryFn: async () => {
      const resp = await apiClient.get<{ data: { rows: Array<Record<string, unknown>> } }>(`/tables/${assignedRelTableId}/rows?limit=1000`);
      return resp.data?.rows || [];
    },
    enabled: enabled && !!assignedRelTableId,
    staleTime: 5 * 60_000,
  });

  const assignedOptions = useMemo(() => {
    return (assignedRows || []).map(row => {
      const data = (row.data && typeof row.data === 'object' && !Array.isArray(row.data))
        ? (row.data as Record<string, unknown>) : {};
      const id = String((row as Record<string, unknown>).id ?? data.id);
      const label = String(data.name || data.email || `#${id}`);
      const color = (data.color as string) || undefined;
      return { value: id, label, color };
    });
  }, [assignedRows]);

  // Update mutation — same shape as TicketsListView.
  const updateRow = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      await apiClient.put(`/tables/${tableId}/rows/${rowId}`, { data: { [field]: value } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rowQueryKey });
      // Also invalidate any tickets-list cache on the same table so an open
      // widget view picks up the change.
      queryClient.invalidateQueries({ queryKey: ['tickets', tableId] });
    },
    onError: (err) => {
      logger.error('TicketRowAtom updateRow failed', { err });
      showToast('Ошибка обновления', 'error');
    },
  });

  const isLoading = enabled && (rowQuery.isLoading || columnsQuery.isLoading);
  const isError = rowQuery.isError || columnsQuery.isError;

  // ── render ───────────────────────────────────────────────────────────

  if (!isInView) {
    return (
      <div ref={ioRef} className="w-full">
        <TicketRowAtomSkeleton />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div ref={ioRef} className="w-full">
        <TicketRowAtomSkeleton />
      </div>
    );
  }

  if (isError || !rowQuery.data || !ticketConfig) {
    return (
      <div ref={ioRef} className="w-full rounded-lg bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)] px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">Не удалось загрузить строку #{rowId}</span>
        </div>
      </div>
    );
  }

  const ticket = rowQuery.data;
  const typeVal = getTicketField(ticket, ticketConfig, 'type');
  const stateVal = getTicketField(ticket, ticketConfig, 'state');
  const priorityVal = getTicketField(ticket, ticketConfig, 'priority');
  const descVal = getTicketField(ticket, ticketConfig, 'description');
  const dueDateVal = (ticket as Record<string, unknown>).due_date
    ?? (ticket as Record<string, unknown>).deadline;
  const createdVal = getTicketField(ticket, ticketConfig, 'created_date')
    ?? (ticket as Record<string, unknown>).created_at
    ?? (ticket as Record<string, unknown>).created_date;
  const updatedVal = (ticket as Record<string, unknown>).updated_at
    ?? (ticket as Record<string, unknown>).updated_date;

  return (
    <div
      ref={ioRef}
      className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-blue-500/30 transition-all overflow-hidden"
    >
      <TicketRowHeader
        ticket={ticket}
        ticketConfig={{ columns: ticketConfig.columns as Record<string, string>, table_id: ticketConfig.table_id }}
        tableColumns={tableColumns}
        types={types}
        states={states}
        priorities={priorities}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(v => !v)}
        onOpenChat={onOpenTaskChat}
        onOpenModal={onOpenEdit}
        onAttachToMessage={onAttachToMessage}
        onStatusChange={(newState) => {
          const col = ticketConfig.columns.state;
          if (col) updateRow.mutate({ field: col, value: newState });
        }}
        onPriorityChange={(newPriority) => {
          const col = ticketConfig.columns.priority;
          if (col) updateRow.mutate({ field: col, value: newPriority });
        }}
        onTypeChange={(newType) => {
          const col = ticketConfig.columns.type;
          if (col) updateRow.mutate({ field: col, value: newType });
        }}
        onColorChange={(value) => {
          const col = (columnsQuery.data || []).find(c => c.column_type === 'color')?.name;
          if (col) updateRow.mutate({ field: col, value });
        }}
      />

      {isExpanded && (
        <div className="border-t border-[var(--border-secondary)]">
          <TicketCardContent
            ticket={{
              id: ticket.id,
              title: getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`,
              description: descVal as string | undefined,
              type: typeVal as number | undefined,
              state: stateVal as number | undefined,
              priority: priorityVal as number | undefined,
              due_date: dueDateVal as string | undefined,
              created_date: createdVal as string | undefined,
              updated_at: updatedVal as string | undefined,
            }}
            types={types}
            states={states}
            priorities={priorities}
            assignedOptions={assignedOptions}
            assignedValue={(() => {
              const raw = (ticket as Record<string, unknown>).assigned_to
                ?? (ticket as Record<string, unknown>).assigned
                ?? (ticket as Record<string, unknown>).assignee;
              if (raw == null || raw === '') return [];
              return Array.isArray(raw)
                ? (raw as Array<string | number>).map(String)
                : [String(raw)];
            })()}
            onAssignedChange={(value) => {
              const col = (columnsQuery.data || []).find(c => ['assigned_to', 'assigned', 'assignee'].includes(c.name))?.name;
              if (col) updateRow.mutate({ field: col, value });
            }}
            mode="accordion"
            onStatusChange={(newState) => {
              const col = ticketConfig.columns.state;
              if (col) updateRow.mutate({ field: col, value: newState });
            }}
            onPriorityChange={(newPriority) => {
              const col = ticketConfig.columns.priority;
              if (col) updateRow.mutate({ field: col, value: newPriority });
            }}
            onOpenChat={onOpenTaskChat}
            onAttachToMessage={onAttachToMessage}
            onDescriptionChange={(newContent) => {
              const col = ticketConfig.columns.description;
              if (col) updateRow.mutate({ field: col, value: newContent });
            }}
            showDescription
            showDates
            showChatButton={false}
            compact
          />
        </div>
      )}

      {/* Footnote — table name + #id, mirrors RowPresetCard so user knows
          which table this row lives in (helpful when several attachments
          coexist in the same chat turn). */}
      <div className="px-3 pb-2 -mt-1 text-[10px] text-[var(--text-tertiary)] truncate">
        {rowReference.table_name} #{rowId}
      </div>
    </div>
  );
}

function TicketRowAtomSkeleton() {
  return (
    <div className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 space-y-2 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded bg-white/10 flex-shrink-0" />
        <div className="w-4 h-4 rounded bg-white/10 flex-shrink-0" />
        <div className="flex-1 h-4 rounded bg-white/10" />
      </div>
      <div className="flex items-center gap-2">
        <div className="w-16 h-5 rounded bg-white/10" />
        <div className="w-14 h-5 rounded bg-white/10" />
        <div className="w-12 h-5 rounded bg-white/10" />
      </div>
    </div>
  );
}

export default TicketRowAtom;
