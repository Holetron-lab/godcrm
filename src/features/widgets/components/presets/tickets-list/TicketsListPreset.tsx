/**
 * TicketsListPreset — standalone `tickets_list` widget.
 *
 * Renders tickets resolved by POST /api/v3/widgets/:id/resolve-tickets.
 * Reuses TicketsHeader + TicketRowHeader from the Documents widget — the
 * components carry a `visibility` prop so this preset can suppress the
 * stats / sort row via `widget.config.show_filters = false`.
 *
 * Server contract: backend reads `widget.config.filter`. Filter active →
 * column-filter mode; otherwise all rows from the configured tickets table.
 */

import { useMemo, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ticket, Loader2, AlertCircle } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { useAIChat } from '@/features/ai-chat';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { TicketCardContent } from '@/shared/components/TicketCardContent';
import { CardDetailModal } from '@/features/widgets/components/modals/CardDetailModal';
import { TicketsHeader } from '../documents/content/TicketsHeader';
import type {
  TicketsDisplayMode,
  TicketsSortBy,
  TicketsSortOrder,
} from '../documents/content/TicketsHeader';
import { TicketRowHeader } from '../documents/content/TicketRowHeader';
import {
  useTicketConfig,
  useTicketDictionaries,
  getTicketTitle,
  getTicketField,
  autoMapColumns,
  autoMapDictionaries,
  type TicketRow,
} from '../documents/content/ticketUtils';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { PresetWidgetProps } from '../../../types/widget.types';
import type { DocumentsWidgetConfig, TicketBindingConfig } from '../../../types/documents.types';
import { getWidgetDisplayName } from '../../../utils/getWidgetDisplayName';
import { useTicketsResolve } from './useTicketsResolve';

interface StandaloneTableColumn {
  name: string;
  display_name?: string;
  column_type: string;
  config?: string;
}

export function TicketsListPreset({ widget }: PresetWidgetProps) {
  const { openTaskChat, attachRowToMessage, attachRowToChat } = useAIChat();
  const queryClient = useQueryClient();

  const widgetConfig = (widget.config || {}) as Record<string, unknown>;
  const showFilters = widgetConfig.show_filters !== false;
  const defaultExpanded = widgetConfig.default_expanded === true;

  // Standalone path: when `tickets_table_id` is set explicitly we synthesize
  // the binding from the table's column metadata (same auto-mapping helpers as
  // the settings UI). Project-scoped discovery (useTicketConfig) only runs as
  // fallback when no table is configured.
  const standaloneTableId = widgetConfig.tickets_table_id != null
    ? Number(widgetConfig.tickets_table_id)
    : undefined;

  const { data: standaloneColumns, isLoading: isLoadingStandaloneCols } = useQuery<StandaloneTableColumn[]>({
    queryKey: ['standalone-ticket-columns', standaloneTableId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: StandaloneTableColumn[] }>(
        `/tables/${standaloneTableId}/columns`,
      );
      return response.data || [];
    },
    enabled: Boolean(standaloneTableId),
    staleTime: 5 * 60_000,
  });

  const standaloneConfig: TicketBindingConfig | null = useMemo(() => {
    if (!standaloneTableId || !standaloneColumns) return null;
    const cols = autoMapColumns(standaloneColumns);
    if (!cols.title) return null;
    return {
      table_id: standaloneTableId,
      columns: cols,
      dictionaries: autoMapDictionaries(standaloneColumns),
    };
  }, [standaloneTableId, standaloneColumns]);

  // Adapt widget.config for useTicketConfig: it expects DocumentsWidgetConfig shape
  // (project_id + optional ticket_binding). For standalone table_all mode we pass
  // undefined so auto-discovery short-circuits cheaply.
  const adaptedConfig: DocumentsWidgetConfig | undefined = useMemo(() => {
    if (standaloneTableId) return undefined;
    return {
      project_id: (widgetConfig.project_id as number) || 0,
      ticket_binding: widgetConfig.ticket_binding as DocumentsWidgetConfig['ticket_binding'],
    };
  }, [standaloneTableId, widgetConfig]);

  const {
    config: discoveredConfig,
    isLoading: isDiscovering,
    source: discoveredSource,
  } = useTicketConfig(adaptedConfig);

  const ticketConfig: TicketBindingConfig | null = standaloneTableId ? standaloneConfig : discoveredConfig;
  const source = standaloneTableId ? `standalone:table_${standaloneTableId}` : discoveredSource;
  const { types, states, priorities, isLoading: isDictsLoading } = useTicketDictionaries(ticketConfig);

  // Resolve tickets via the dedicated endpoint (ADR-0012 §Phase 3).
  const resolveQuery = useTicketsResolve(widget.id, { enabled: Boolean(widget.id) });
  const resolvedTickets: TicketRow[] = useMemo(() => {
    const rows = resolveQuery.data?.tickets ?? [];
    // Normalize rows: API may return fields nested in .data — flatten so column
    // mapping works identically to the inline TicketsListView path.
    return rows.map((row) => {
      const nested = (row as Record<string, unknown>).data;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return { ...row, ...(nested as Record<string, unknown>), id: row.id } as TicketRow;
      }
      return row;
    });
  }, [resolveQuery.data]);

  // Local UI state
  const [displayMode, setDisplayMode] = useState<TicketsDisplayMode>('list');
  const [sortBy, setSortBy] = useState<TicketsSortBy>('created');
  const [sortOrder, setSortOrder] = useState<TicketsSortOrder>('desc');
  const [stateFilter, setStateFilter] = useState<number[]>([]);
  // Set tracks tickets whose expansion *differs* from `defaultExpanded`. This
  // way changing the default in settings flips every row at once without
  // wiping per-ticket toggles, and re-fetches don't reset local state.
  const [expansionOverrides, setExpansionOverrides] = useState<Set<number>>(new Set());
  const isTicketExpanded = useCallback(
    (id: number) => defaultExpanded !== expansionOverrides.has(id),
    [defaultExpanded, expansionOverrides],
  );

  // Modal state
  const [showCardDetailModal, setShowCardDetailModal] = useState(false);
  const [selectedTicketForModal, setSelectedTicketForModal] = useState<{ id: string; data: Record<string, unknown> } | null>(null);

  // Fetch table columns (properly transformed: backend column_type → ColumnModel.type,
  // config parsed from JSON string). Going through tablesApi keeps the relation
  // detection below identical to the Kanban path (`useTicketData`).
  const { data: tableColumnsResult } = useQuery({
    queryKey: ['ticket-table-columns', ticketConfig?.table_id],
    queryFn: async () => {
      const result = await tablesApi.getColumns(String(ticketConfig!.table_id));
      return result.columns;
    },
    enabled: !!ticketConfig?.table_id,
    staleTime: 60_000,
  });
  const tableColumns: ColumnModel[] = tableColumnsResult || [];

  // Discover every relation table referenced by tickets columns. Mirrors
  // useTicketData.relationTableConfigs — covers `assigned_to` (users table),
  // `adr_ref` (registry table), and any other relation column added later.
  const relationTableConfigs = useMemo(() => {
    const configs = new Map<number, { valueColumn?: string; labelColumn?: string }>();
    tableColumns.forEach((col) => {
      const cfg = (typeof col.config === 'string'
        ? (() => { try { return JSON.parse(col.config as unknown as string); } catch { return {}; } })()
        : (col.config || {})) as Record<string, unknown> & {
          relation?: { enabled?: boolean; tableId?: number | string; valueColumn?: string; labelColumn?: string };
          relatedTableId?: number | string;
          tableId?: number | string;
          displayColumn?: string;
        };
      if (cfg?.relation?.enabled && cfg.relation.tableId) {
        const id = Number(cfg.relation.tableId);
        configs.set(id, {
          valueColumn: cfg.relation.valueColumn || 'id',
          labelColumn: cfg.relation.labelColumn || 'name',
        });
      } else if (cfg?.relatedTableId) {
        configs.set(Number(cfg.relatedTableId), {
          valueColumn: cfg.relation?.valueColumn || 'id',
          labelColumn: cfg.relation?.labelColumn || cfg.displayColumn || 'name',
        });
      } else if (col.type === 'relation' && cfg?.tableId) {
        configs.set(Number(cfg.tableId), {
          valueColumn: (cfg as { valueColumn?: string }).valueColumn || 'id',
          labelColumn: (cfg as { labelColumn?: string }).labelColumn || cfg.displayColumn || 'name',
        });
      }
    });
    return configs;
  }, [tableColumns]);

  const relationTableIds = useMemo(
    () => Array.from(relationTableConfigs.keys()).filter(Number.isFinite),
    [relationTableConfigs],
  );

  // Load every discovered relation table into a single Map<tableId, Map<rowId, info>>.
  // CardDetailModal uses `column.config.relation.tableId` to resolve labels —
  // this format matches the Kanban path 1:1.
  const { data: allRelationData } = useQuery({
    queryKey: ['ticket-relation-data', ticketConfig?.table_id, ...relationTableIds],
    queryFn: async () => {
      const result = new Map<string, Map<string, { label: string; color?: string; order?: number }>>();
      await Promise.all(relationTableIds.map(async (relTableId) => {
        try {
          const resp = await apiClient.request<{ data: { rows: Array<{ id: string | number; data: Record<string, unknown> }> } }>(
            `/tables/${relTableId}/rows?limit=5000&mode=raw`,
          );
          const rows = resp.data?.rows || [];
          const cfg = relationTableConfigs.get(relTableId);
          const labelCol = cfg?.labelColumn || 'name';
          const valueCol = cfg?.valueColumn || 'id';
          const inner = new Map<string, { label: string; color?: string; order?: number }>();
          rows.forEach((row) => {
            const data = row.data || {};
            const label = String(
              data[labelCol] ?? data.name ?? data.title ?? data.what ?? data.subject ?? row.id,
            );
            const color = data.color ? String(data.color) : undefined;
            const order = typeof data.order === 'number' ? data.order : undefined;
            inner.set(String(row.id), { label, color, order });
            if (valueCol !== 'id' && data[valueCol] !== undefined) {
              inner.set(String(data[valueCol]), { label, color, order });
            }
          });
          result.set(String(relTableId), inner);
        } catch (err) {
          logger.error(`tickets-list: failed to load relation table ${relTableId}`, err);
        }
      }));
      return result;
    },
    enabled: relationTableIds.length > 0,
    staleTime: 60_000,
  });

  // Resolve relation tableId for the `assigned_to` column (users-in-space).
  // Same lookup used in TicketsListView/KanbanCard.
  const assignedRelTableId = useMemo(() => {
    const col = tableColumns.find(c => ['assigned_to', 'assigned', 'assignee'].includes(c.name));
    if (!col) return null;
    const cfg = (typeof col.config === 'string'
      ? (() => { try { return JSON.parse(col.config as unknown as string); } catch { return {}; } })()
      : (col.config || {})) as { relation?: { tableId?: number | string }; relatedTableId?: number | string };
    const id = Number(cfg?.relation?.tableId ?? cfg?.relatedTableId);
    return Number.isFinite(id) ? id : null;
  }, [tableColumns]);

  // Build assignedOptions from already-loaded relationData (no extra fetch).
  const assignedOptions = useMemo(() => {
    if (!assignedRelTableId || !allRelationData) return [];
    const inner = allRelationData.get(String(assignedRelTableId));
    if (!inner) return [];
    return Array.from(inner.entries()).map(([rowId, info]) => ({
      value: rowId,
      label: info.label,
      color: info.color,
    }));
  }, [assignedRelTableId, allRelationData]);

  // Merge dictionary-derived map (types/states/priorities, available without
  // column metadata for the standalone path) on top of the column-scan map so
  // we always have at least the core three even before columns load.
  const relationData = useMemo(() => {
    const merged = new Map<string, Map<string, { label: string; color?: string; order?: number }>>();
    if (allRelationData) {
      allRelationData.forEach((inner, tid) => merged.set(tid, new Map(inner)));
    }
    if (ticketConfig?.dictionaries) {
      const addDict = (tableId: number | undefined, items: typeof types) => {
        if (!tableId) return;
        const inner = merged.get(String(tableId)) ?? new Map<string, { label: string; color?: string; order?: number }>();
        items.forEach((it) => {
          if (!inner.has(String(it.id))) {
            inner.set(String(it.id), {
              label: String(it.name || (it as Record<string, unknown>).title || it.id),
              color: it.color ? String(it.color) : undefined,
            });
          }
        });
        merged.set(String(tableId), inner);
      };
      addDict(ticketConfig.dictionaries.types_table_id, types);
      addDict(ticketConfig.dictionaries.states_table_id, states);
      addDict(ticketConfig.dictionaries.priorities_table_id, priorities);
    }
    return merged.size > 0 ? merged : undefined;
  }, [allRelationData, ticketConfig?.dictionaries, types, states, priorities]);

  const invalidateTickets = useCallback(() => {
    if (widget.id) {
      queryClient.invalidateQueries({ queryKey: ['tickets-resolve', widget.id] });
    }
    if (ticketConfig?.table_id) {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketConfig.table_id] });
    }
  }, [queryClient, widget.id, ticketConfig?.table_id]);

  const updateTicket = useMutation({
    mutationFn: async ({ ticketId, field, value }: { ticketId: number; field: string; value: unknown }) => {
      if (!ticketConfig?.table_id) throw new Error('ticketConfig missing');
      await apiClient.put(`/tables/${ticketConfig.table_id}/rows/${ticketId}`, {
        data: { [field]: value },
      });
    },
    onSuccess: () => {
      invalidateTickets();
      showToast('Тикет обновлён', 'success');
    },
    onError: () => showToast('Ошибка обновления', 'error'),
  });

  const toggleExpanded = useCallback((ticketId: number) => {
    setExpansionOverrides(prev => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId); else next.add(ticketId);
      return next;
    });
  }, []);

  const openTicketModal = useCallback((ticket: TicketRow) => {
    setSelectedTicketForModal({
      id: String(ticket.id),
      data: ticket as unknown as Record<string, unknown>,
    });
    setShowCardDetailModal(true);
  }, []);

  const openTicketChat = useCallback(async (ticketId: number, ticketTitle: string) => {
    if (!ticketConfig?.table_id) {
      showToast('Таблица тикетов не настроена', 'error');
      return;
    }
    try {
      const response = await apiClient.get<{ data: { conversationId: number; id: number } }>(
        `/chat/tasks/${ticketConfig.table_id}/${ticketId}?create=true`,
      );
      const convId = response.data?.conversationId || response.data?.id;
      if (convId) {
        openTaskChat({ conversationId: convId, tableId: ticketConfig.table_id, rowId: ticketId, rowTitle: ticketTitle });
      } else {
        showToast('Не удалось получить ID чата', 'error');
      }
    } catch (error) {
      logger.error('tickets_list: openTicketChat failed', { error, ticketId });
      showToast('Не удалось открыть чат', 'error');
    }
  }, [ticketConfig, openTaskChat]);

  const handleOpenRowChat = useCallback(async (rowId: string) => {
    if (!ticketConfig?.table_id) return;
    try {
      const response = await apiClient.get<{ data: { conversationId: number; id: number } }>(
        `/chat/tasks/${ticketConfig.table_id}/${rowId}?create=true`,
      );
      const convId = response.data?.conversationId || response.data?.id;
      if (convId) {
        openTaskChat({ conversationId: convId, tableId: ticketConfig.table_id, rowId: Number(rowId), rowTitle: `#${rowId}` });
      }
    } catch (error) {
      logger.error('tickets_list: openRowChat failed', { error, rowId });
      showToast('Не удалось открыть чат', 'error');
    }
  }, [ticketConfig, openTaskChat]);

  const handleAttachRowToChat = useCallback((rowId: string) => {
    if (!ticketConfig?.table_id) return;
    attachRowToChat({
      table_id: ticketConfig.table_id,
      row_id: Number(rowId),
      table_name: 'Tickets',
      table_icon: '🎫',
      row_title: `#${rowId}`,
    });
  }, [ticketConfig, attachRowToChat]);

  const handleAttachRowToMessage = useCallback((rowId: string) => {
    if (!ticketConfig?.table_id) return;
    attachRowToMessage({
      table_id: ticketConfig.table_id,
      row_id: Number(rowId),
      table_name: 'Tickets',
      table_icon: '🎫',
      row_title: `#${rowId}`,
    });
  }, [ticketConfig, attachRowToMessage]);

  const handleCardSave = useCallback(async (cardId: string, data: Record<string, unknown>) => {
    if (!ticketConfig?.table_id) return;
    try {
      await apiClient.put(`/tables/${ticketConfig.table_id}/rows/${cardId}`, { data });
      invalidateTickets();
      showToast('Тикет обновлён', 'success');
    } catch (error) {
      logger.error('tickets_list: handleCardSave failed', { error, cardId });
      showToast('Ошибка сохранения', 'error');
    }
  }, [ticketConfig, invalidateTickets]);

  // Build state options + stats from dictionaries + resolved rows
  const stateOptions = useMemo(() => {
    return [{ value: 0, label: 'Все' }, ...states.map(s => ({ value: s.id, label: (s.name as string) || `#${s.id}` }))];
  }, [states]);

  const stats = useMemo(() => {
    if (!ticketConfig?.columns.state) return {};
    const stateCol = ticketConfig.columns.state;
    const counts: Record<number, number> = {};
    for (const t of resolvedTickets) {
      const s = Number(t[stateCol]) || 0;
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [resolvedTickets, ticketConfig]);

  // Client-side filter + sort applied on top of server-resolved list
  const filteredTickets = useMemo(() => {
    if (!ticketConfig) return [];
    let result = resolvedTickets;

    if (stateFilter.length > 0) {
      const stateCol = ticketConfig.columns.state;
      if (stateCol) {
        result = result.filter((t: TicketRow) => stateFilter.includes(Number(t[stateCol])));
      }
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'created': {
          const aDate = (a.created_at as string) || (a.created_date as string) || '';
          const bDate = (b.created_at as string) || (b.created_date as string) || '';
          cmp = String(aDate).localeCompare(String(bDate));
          break;
        }
        case 'updated': {
          const aDate = (a.updated_at as string) || (a.updated_date as string) || '';
          const bDate = (b.updated_at as string) || (b.updated_date as string) || '';
          cmp = String(aDate).localeCompare(String(bDate));
          break;
        }
        case 'state': {
          const stateCol = ticketConfig.columns.state;
          cmp = (stateCol ? Number(a[stateCol]) || 0 : 0) - (stateCol ? Number(b[stateCol]) || 0 : 0);
          break;
        }
        case 'priority': {
          const pCol = ticketConfig.columns.priority;
          cmp = (pCol ? Number(a[pCol]) || 0 : 0) - (pCol ? Number(b[pCol]) || 0 : 0);
          break;
        }
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [resolvedTickets, ticketConfig, stateFilter, sortBy, sortOrder]);

  const isLoading = isDiscovering || isLoadingStandaloneCols || isDictsLoading || resolveQuery.isLoading;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (resolveQuery.isError) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-16 text-[var(--text-tertiary)]">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-30 text-red-400" />
          <p className="text-base mb-2">Не удалось загрузить тикеты</p>
          <p className="text-sm max-w-sm mx-auto">
            {resolveQuery.error instanceof Error ? resolveQuery.error.message : 'Попробуйте обновить страницу'}
          </p>
        </div>
      </div>
    );
  }

  if (!ticketConfig) {
    if (standaloneTableId) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center py-16 text-[var(--text-tertiary)]">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-base mb-2">Не Tickets-совместимая таблица</p>
            <p className="text-sm max-w-sm mx-auto">
              В таблице должна быть колонка title/what/name/subject, чтобы рендерить её как список тикетов.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-16 text-[var(--text-tertiary)]">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-base mb-2">Тикеты не настроены</p>
          <p className="text-sm max-w-sm mx-auto">
            Создайте таблицу «Tickets» или «Tasks» в проекте, либо настройте ticket_binding в конфиге виджета.
          </p>
        </div>
      </div>
    );
  }

  const total = resolveQuery.data?.total ?? resolvedTickets.length;
  const appliedFilter = resolveQuery.data?.applied_filter;
  const subtitle = appliedFilter?.column
    ? `${total} тикетов · ${appliedFilter.column} = ${appliedFilter.value ?? '—'}`
    : `${total} тикетов`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-3">
        <TicketsHeader
          title={getWidgetDisplayName(widget)}
          subtitle={subtitle}
          source={source}
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          totalCount={total}
          stats={stats}
          stateOptions={stateOptions}
          states={states}
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          visibility={{ stats: showFilters, sort: showFilters }}
        />

        {filteredTickets.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-tertiary)]">
            <Ticket className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-base mb-2">Нет тикетов</p>
            <p className="text-sm max-w-sm mx-auto">
              {resolvedTickets.length === 0
                ? 'Для этого виджета нет тикетов с заданным фильтром.'
                : 'Попробуйте сбросить фильтр по статусу.'}
            </p>
          </div>
        ) : displayMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTickets.map((ticket: TicketRow) => {
              const typeVal = getTicketField(ticket, ticketConfig, 'type');
              const stateVal = getTicketField(ticket, ticketConfig, 'state');
              const priorityVal = getTicketField(ticket, ticketConfig, 'priority');
              const descVal = getTicketField(ticket, ticketConfig, 'description');
              const dueDateVal = (getTicketField as (r: TicketRow, c: typeof ticketConfig, f: string) => unknown)(ticket, ticketConfig, 'due_date') || ticket.due_date || ticket.deadline;
              const createdVal = getTicketField(ticket, ticketConfig, 'created_date') || ticket.created_at || ticket.created_date;
              const updatedVal = ticket.updated_at || ticket.updated_date;
              return (
                <div
                  key={ticket.id}
                  className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-blue-500/30 transition-all overflow-hidden h-full flex flex-col"
                >
                  <TicketRowHeader
                    ticket={ticket}
                    ticketConfig={ticketConfig}
                    types={types}
                    states={states}
                    priorities={priorities}
                    tableColumns={tableColumns}
                    isExpanded
                    hideChevron
                    onToggle={() => openTicketModal(ticket)}
                    onOpenChat={() => openTicketChat(ticket.id, getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`)}
                    onOpenModal={() => openTicketModal(ticket)}
                    onAttachToMessage={() => handleAttachRowToMessage(String(ticket.id))}
                    onStatusChange={(newState) => {
                      const stateCol = ticketConfig.columns.state;
                      if (stateCol) updateTicket.mutate({ ticketId: ticket.id, field: stateCol, value: newState });
                    }}
                    onPriorityChange={(newPriority) => {
                      const priorityCol = ticketConfig.columns.priority;
                      if (priorityCol) updateTicket.mutate({ ticketId: ticket.id, field: priorityCol, value: newPriority });
                    }}
                    onTypeChange={(newType) => {
                      const typeCol = ticketConfig.columns.type;
                      if (typeCol) updateTicket.mutate({ ticketId: ticket.id, field: typeCol, value: newType });
                    }}
                    onColorChange={(value) => {
                      const col = tableColumns.find(c => ((c as ColumnModel & { column_type?: string }).column_type || c.type) === 'color')?.name;
                      if (col) updateTicket.mutate({ ticketId: ticket.id, field: col, value });
                    }}
                  />
                  <div className="border-t border-[var(--border-secondary)] flex-1">
                    <TicketCardContent
                      ticket={{
                        id: ticket.id,
                        title: getTicketTitle(ticket, ticketConfig) || 'Без названия',
                        description: descVal as string | undefined,
                        type: typeVal as number | undefined,
                        state: stateVal as number | undefined,
                        priority: priorityVal as number | undefined,
                        due_date: dueDateVal as string | undefined,
                        created_date: createdVal as string | undefined,
                        updated_at: updatedVal as string | undefined,
                        sealed_at: (ticket as Record<string, unknown>).sealed_at as string | null | undefined,
                        sealed_by: (ticket as Record<string, unknown>).sealed_by as string | number | null | undefined,
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
                        const col = tableColumns.find(c => ['assigned_to', 'assigned', 'assignee'].includes(c.name))?.name;
                        if (col) updateTicket.mutate({ ticketId: ticket.id, field: col, value });
                      }}
                      mode="accordion"
                      onStatusChange={(newState) => {
                        const stateCol = ticketConfig.columns.state;
                        if (stateCol) updateTicket.mutate({ ticketId: ticket.id, field: stateCol, value: newState });
                      }}
                      onPriorityChange={(newPriority) => {
                        const priorityCol = ticketConfig.columns.priority;
                        if (priorityCol) updateTicket.mutate({ ticketId: ticket.id, field: priorityCol, value: newPriority });
                      }}
                      onOpenChat={() => openTicketChat(ticket.id, getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`)}
                      onAttachToMessage={() => handleAttachRowToMessage(String(ticket.id))}
                      onDescriptionChange={(newContent) => {
                        const descCol = ticketConfig.columns.description;
                        if (descCol) updateTicket.mutate({ ticketId: ticket.id, field: descCol, value: newContent });
                      }}
                      showDescription
                      showDates
                      showChatButton={false}
                      showSeal={ticketConfig?.table_id === 1708}
                      onSealed={() => queryClient.invalidateQueries({ queryKey: ['widget-resolve-tickets'] })}
                      compact={false}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTickets.map((ticket: TicketRow) => {
              const typeVal = getTicketField(ticket, ticketConfig, 'type');
              const stateVal = getTicketField(ticket, ticketConfig, 'state');
              const priorityVal = getTicketField(ticket, ticketConfig, 'priority');
              const descVal = getTicketField(ticket, ticketConfig, 'description');
              // NOTE: 'due_date' is not in TicketBindingConfig['columns'] yet — same pre-existing
              // type mismatch exists in TicketsListView; keeping symmetry until ticketUtils is extended.
              const dueDateVal = (getTicketField as (r: TicketRow, c: typeof ticketConfig, f: string) => unknown)(ticket, ticketConfig, 'due_date') || ticket.due_date || ticket.deadline;
              const createdVal = getTicketField(ticket, ticketConfig, 'created_date') || ticket.created_at || ticket.created_date;
              const isExpanded = isTicketExpanded(ticket.id);
              return (
                <div
                  key={ticket.id}
                  className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-blue-500/30 transition-all overflow-hidden"
                >
                  <TicketRowHeader
                    ticket={ticket}
                    ticketConfig={ticketConfig}
                    types={types}
                    states={states}
                    priorities={priorities}
                    tableColumns={tableColumns}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpanded(ticket.id)}
                    onOpenChat={() => openTicketChat(ticket.id, getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`)}
                    onOpenModal={() => openTicketModal(ticket)}
                    onAttachToMessage={() => handleAttachRowToMessage(String(ticket.id))}
                    onStatusChange={(newState) => {
                      const stateCol = ticketConfig.columns.state;
                      if (stateCol) updateTicket.mutate({ ticketId: ticket.id, field: stateCol, value: newState });
                    }}
                    onPriorityChange={(newPriority) => {
                      const priorityCol = ticketConfig.columns.priority;
                      if (priorityCol) updateTicket.mutate({ ticketId: ticket.id, field: priorityCol, value: newPriority });
                    }}
                    onTypeChange={(newType) => {
                      const typeCol = ticketConfig.columns.type;
                      if (typeCol) updateTicket.mutate({ ticketId: ticket.id, field: typeCol, value: newType });
                    }}
                    onColorChange={(value) => {
                      const col = tableColumns.find(c => ((c as ColumnModel & { column_type?: string }).column_type || c.type) === 'color')?.name;
                      if (col) updateTicket.mutate({ ticketId: ticket.id, field: col, value });
                    }}
                  />

                  {isExpanded && (
                    <div className="border-t border-[var(--border-secondary)]">
                      <TicketCardContent
                        ticket={{
                          id: ticket.id,
                          title: getTicketTitle(ticket, ticketConfig) || 'Без названия',
                          description: descVal as string | undefined,
                          type: typeVal as number | undefined,
                          state: stateVal as number | undefined,
                          priority: priorityVal as number | undefined,
                          due_date: dueDateVal as string | undefined,
                          created_date: createdVal as string | undefined,
                          sealed_at: (ticket as Record<string, unknown>).sealed_at as string | null | undefined,
                          sealed_by: (ticket as Record<string, unknown>).sealed_by as string | number | null | undefined,
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
                          const col = tableColumns.find(c => ['assigned_to', 'assigned', 'assignee'].includes(c.name))?.name;
                          if (col) updateTicket.mutate({ ticketId: ticket.id, field: col, value });
                        }}
                        mode="accordion"
                        onStatusChange={(newState) => {
                          const stateCol = ticketConfig.columns.state;
                          if (stateCol) updateTicket.mutate({ ticketId: ticket.id, field: stateCol, value: newState });
                        }}
                        onPriorityChange={(newPriority) => {
                          const priorityCol = ticketConfig.columns.priority;
                          if (priorityCol) updateTicket.mutate({ ticketId: ticket.id, field: priorityCol, value: newPriority });
                        }}
                        onOpenChat={() => openTicketChat(ticket.id, getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`)}
                        onAttachToMessage={() => handleAttachRowToMessage(String(ticket.id))}
                        onDescriptionChange={(newContent) => {
                          const descCol = ticketConfig.columns.description;
                          if (descCol) updateTicket.mutate({ ticketId: ticket.id, field: descCol, value: newContent });
                        }}
                        showDescription
                        showDates
                        showChatButton
                        showSeal={ticketConfig?.table_id === 1708}
                        onSealed={() => queryClient.invalidateQueries({ queryKey: ['widget-resolve-tickets'] })}
                        compact
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {total > 1 && (
              <div className="text-center pt-2 text-xs text-[var(--text-tertiary)]">
                Показано {filteredTickets.length} из {total}
              </div>
            )}
          </div>
        )}
      </div>

      <CardDetailModal
        isOpen={showCardDetailModal}
        onClose={() => {
          setShowCardDetailModal(false);
          setSelectedTicketForModal(null);
        }}
        card={selectedTicketForModal}
        columns={tableColumns}
        titleField={ticketConfig?.columns.title || 'title'}
        groupByField={ticketConfig?.columns.state}
        relationData={relationData}
        onSave={handleCardSave}
        tableId={ticketConfig?.table_id}
        onOpenChat={handleOpenRowChat}
        onAttachToChat={handleAttachRowToChat}
        onAttachToMessage={handleAttachRowToMessage}
      />
    </div>
  );
}

export default TicketsListPreset;
