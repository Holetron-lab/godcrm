/**
 * TicketsListView - Central view showing all tickets with accordion
 * Uses auto-discovery or configured ticket_binding from widget config
 * URL sync: ?view=tickets&search=xxx&state=xxx
 */

import { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, Loader2, AlertCircle } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { useAIChat } from '@/features/ai-chat';
import { useDocumentsContext } from '../DocumentsContext';
import { TicketCardContent } from '@/shared/components/TicketCardContent';
import { CardDetailModal } from '@/features/widgets/components/modals/CardDetailModal';
import { TicketsHeader } from './TicketsHeader';
import { TicketRowHeader } from './TicketRowHeader';
import type { ColumnModel } from '@/features/tables/types/table.types';
import {
  useTicketConfig,
  useTicketDictionaries,
  getTicketTitle,
  getTicketField,
  type TicketRow,
} from './ticketUtils';

export function TicketsListView() {
  const ctx = useDocumentsContext();
  const { openTaskChat, attachRowToMessage, attachRowToChat } = useAIChat();
  const queryClient = useQueryClient();

  // Use context state filter instead of local state for URL sync
  const stateFilter = ctx.ticketsStateFilter;
  const setStateFilter = ctx.setTicketsStateFilter;

  // Track which tickets are expanded
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Modal state for CardDetailModal
  const [showCardDetailModal, setShowCardDetailModal] = useState(false);
  const [selectedTicketForModal, setSelectedTicketForModal] = useState<{ id: string; data: Record<string, unknown> } | null>(null);

  // Auto-discover or use configured ticket table
  const { config: ticketConfig, isLoading: isDiscovering, source } = useTicketConfig(ctx.config);
  const { types, states, priorities, isLoading: isDictsLoading } = useTicketDictionaries(ticketConfig);

  // Fetch table columns for CardDetailModal
  const { data: tableColumnsData } = useQuery({
    queryKey: ['table-columns', ticketConfig?.table_id],
    queryFn: async () => {
      const response = await apiClient.get(`/tables/${ticketConfig!.table_id}/columns`);
      return response.data?.columns || response.data || [];
    },
    enabled: !!ticketConfig?.table_id,
    staleTime: 60_000,
  });
  const tableColumns: ColumnModel[] = tableColumnsData || [];

  // Resolve the relation tableId for the `assigned_to` column (users-in-space).
  // Mirrors KanbanCard's lookup: prefer `relation.tableId`, fall back to
  // `relatedTableId`. We load that table once and pass labels into the row.
  const assignedRelTableId = useMemo(() => {
    const col = tableColumns.find(c => ['assigned_to', 'assigned', 'assignee'].includes(c.name));
    if (!col) return null;
    const cfg = (typeof col.config === 'string'
      ? (() => { try { return JSON.parse(col.config as unknown as string); } catch { return {}; } })()
      : (col.config || {})) as { relation?: { enabled?: boolean; tableId?: number | string }; relatedTableId?: number | string };
    const id = Number(cfg?.relation?.tableId ?? cfg?.relatedTableId);
    return Number.isFinite(id) ? id : null;
  }, [tableColumns]);

  const { data: assignedRows } = useQuery({
    queryKey: ['assigned-options', assignedRelTableId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: { rows: Array<Record<string, unknown>> } }>(`/tables/${assignedRelTableId}/rows?limit=1000`);
      return response.data?.rows || [];
    },
    enabled: !!assignedRelTableId,
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

  // Handlers for modal chat actions
  const handleOpenRowChat = useCallback(async (rowId: string) => {
    if (!ticketConfig?.table_id) return;
    try {
      const response = await apiClient.get<{ data: { conversationId: number; id: number } }>(
        `/chat/tasks/${ticketConfig.table_id}/${rowId}?create=true`
      );
      const convId = response.data?.conversationId || response.data?.id;
      if (convId) {
        openTaskChat({ conversationId: convId, tableId: ticketConfig.table_id, rowId: Number(rowId), rowTitle: `#${rowId}` });
      }
    } catch (error) {
      logger.error('openRowChat failed', { error, rowId });
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
    if (ctx.isReadOnly) return; // ADR-0060 P6/P fail-closed guard
    if (!ticketConfig?.table_id) return;
    try {
      await apiClient.put(`/tables/${ticketConfig.table_id}/rows/${cardId}`, { data });
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketConfig.table_id] });
      showToast('Тикет обновлён', 'success');
    } catch (error) {
      logger.error('handleCardSave failed', { error, cardId });
      showToast('Ошибка сохранения', 'error');
    }
  }, [ticketConfig, queryClient, ctx.isReadOnly]);

  // Open modal for a ticket
  const openTicketModal = useCallback((ticket: TicketRow) => {
    setSelectedTicketForModal({
      id: String(ticket.id),
      data: ticket as unknown as Record<string, unknown>,
    });
    setShowCardDetailModal(true);
  }, []);

  // Update ticket field mutation
  const updateTicket = useMutation({
    mutationFn: async ({ ticketId, field, value }: { ticketId: number; field: string; value: unknown }) => {
      if (ctx.isReadOnly) throw new Error('Read-only mode'); // ADR-0060 P6/P fail-closed guard
      await apiClient.put(`/tables/${ticketConfig!.table_id}/rows/${ticketId}`, {
        data: { [field]: value }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketConfig?.table_id] });
      showToast('Тикет обновлён', 'success');
    },
    onError: () => {
      showToast('Ошибка обновления', 'error');
    }
  });

  // Toggle expanded state
  const toggleExpanded = useCallback((ticketId: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }
      return next;
    });
  }, []);

  // Fetch tickets
  const { data: ticketsData, isLoading: isLoadingRows } = useQuery({
    queryKey: ['tickets', ticketConfig?.table_id],
    queryFn: async () => {
      const response = await apiClient.get<{ data: { rows: TicketRow[]; pagination: unknown } }>(`/tables/${ticketConfig!.table_id}/rows?limit=5000`);
      return (response as { data: { rows: TicketRow[] } }).data;
    },
    enabled: !!ticketConfig?.table_id,
    staleTime: 30_000,
  });

  // Normalize rows: API returns fields nested in .data, flatten for column mapping access
  const tickets: TicketRow[] = useMemo(() => {
    const rows = ticketsData?.rows || [];
    return rows.map((row: Record<string, unknown>) => {
      const nested = row.data;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return { id: row.id as number, ...row, ...(nested as Record<string, unknown>) };
      }
      return row as TicketRow;
    });
  }, [ticketsData]);

  // Build state options from dictionary
  const stateOptions = useMemo(() => {
    return [{ value: 0, label: 'Все' }, ...states.map(s => ({ value: s.id, label: (s.name as string) || `#${s.id}` }))];
  }, [states]);

  // Collect ticket IDs referenced by the selected document's items
  const documentTicketIds = useMemo(() => {
    if (ctx.selectedDocumentId == null) return null;
    const ids = new Set<number>();
    for (const item of ctx.items) {
      if (item.ticket_ref != null) {
        const n = Number(item.ticket_ref);
        if (!Number.isNaN(n)) ids.add(n);
      }
    }
    return ids;
  }, [ctx.selectedDocumentId, ctx.items]);

  // Relation columns on the tickets table that point to the documents-widget
  // registry (e.g. `adr_ref` → `_registry`). A ticket whose value in such a
  // column equals the current doc id is in this doc's scope — same signal the
  // standalone tickets-list widget uses.
  const registryRelationColumns = useMemo(() => {
    if (!ctx.registryTableId) return [] as string[];
    const targetId = Number(ctx.registryTableId);
    const cols: string[] = [];
    for (const col of tableColumns) {
      const cfg = (typeof col.config === 'string'
        ? (() => { try { return JSON.parse(col.config as unknown as string); } catch { return {}; } })()
        : (col.config || {})) as {
          relation?: { enabled?: boolean; tableId?: number | string };
          relatedTableId?: number | string;
          tableId?: number | string;
        };
      const candidate = Number(
        cfg?.relation?.tableId ?? cfg?.relatedTableId ?? (col.type === 'relation' ? cfg?.tableId : undefined),
      );
      if (Number.isFinite(candidate) && candidate === targetId) {
        cols.push(col.name);
      }
    }
    return cols;
  }, [tableColumns, ctx.registryTableId]);

  // Filter by search query and state
  const filteredTickets = useMemo(() => {
    if (!ticketConfig) return [];
    let result = tickets;

    // Document scope filter — a ticket counts if any of these match the
    // current doc id: an atom in this doc has `ticket_ref` to it (legacy);
    // its `parent_document_id` equals docId (ADR-0012 / ADR-154); or a
    // relation column on tickets pointing to the registry (e.g. `adr_ref`)
    // equals docId. The third signal mirrors the standalone tickets-list
    // widget so both views report the same set.
    if (ctx.selectedDocumentId != null) {
      const docId = Number(ctx.selectedDocumentId);
      result = result.filter((t: TicketRow) => {
        if (documentTicketIds && documentTicketIds.has(Number(t.id))) return true;
        const parentId = Number((t as Record<string, unknown>).parent_document_id);
        if (Number.isFinite(parentId) && parentId === docId) return true;
        for (const col of registryRelationColumns) {
          const val = Number((t as Record<string, unknown>)[col]);
          if (Number.isFinite(val) && val === docId) return true;
        }
        return false;
      });
    }

    // State filter (multi-select)
    if (stateFilter.length > 0) {
      const stateCol = ticketConfig.columns.state;
      if (stateCol) {
        result = result.filter((t: TicketRow) => stateFilter.includes(Number(t[stateCol])));
      }
    }

    // Search filter
    const q = ctx.searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter((t: TicketRow) => {
        const title = getTicketTitle(t, ticketConfig);
        return title.toLowerCase().includes(q) || String(t.id).includes(q);
      });
    }

    // Sort
    const sortBy = ctx.ticketsSortBy;
    const sortOrder = ctx.ticketsSortOrder;
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'created': {
          const aDate = a.created_at || a.created_date || '';
          const bDate = b.created_at || b.created_date || '';
          cmp = String(aDate).localeCompare(String(bDate));
          break;
        }
        case 'updated': {
          const aDate = a.updated_at || a.updated_date || '';
          const bDate = b.updated_at || b.updated_date || '';
          cmp = String(aDate).localeCompare(String(bDate));
          break;
        }
        case 'state': {
          const stateCol = ticketConfig.columns.state;
          const aState = stateCol ? Number(a[stateCol]) || 0 : 0;
          const bState = stateCol ? Number(b[stateCol]) || 0 : 0;
          cmp = aState - bState;
          break;
        }
        case 'priority': {
          const priorityCol = ticketConfig.columns.priority;
          const aPriority = priorityCol ? Number(a[priorityCol]) || 0 : 0;
          const bPriority = priorityCol ? Number(b[priorityCol]) || 0 : 0;
          cmp = aPriority - bPriority;
          break;
        }
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [tickets, ctx.searchQuery, stateFilter, ticketConfig, ctx.ticketsSortBy, ctx.ticketsSortOrder, documentTicketIds, registryRelationColumns, ctx.selectedDocumentId]);

  // Stats by state
  const stats = useMemo(() => {
    if (!ticketConfig?.columns.state) return {};
    const stateCol = ticketConfig.columns.state;
    const counts: Record<number, number> = {};
    for (const t of tickets) {
      const s = Number(t[stateCol]) || 0;
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [tickets, ticketConfig]);

  // Open ticket chat via API (ADR-069)
  const openTicketChat = async (ticketId: number, ticketTitle: string) => {
    if (!ticketConfig?.table_id) {
      showToast('Таблица тикетов не настроена', 'error');
      return;
    }
    try {
      const response = await apiClient.get<{ data: { conversationId: number; id: number } }>(
        `/chat/tasks/${ticketConfig.table_id}/${ticketId}?create=true`
      );
      const convId = response.data?.conversationId || response.data?.id;
      if (convId) {
        // Open the chat panel with pending task chat data
        openTaskChat({
          conversationId: convId,
          tableId: ticketConfig.table_id,
          rowId: ticketId,
          rowTitle: ticketTitle
        });
      } else {
        showToast('Не удалось получить ID чата', 'error');
      }
    } catch (error) {
      logger.error('openTicketChat failed', { error, ticketId });
      showToast('Не удалось открыть чат', 'error');
    }
  };

  const isLoading = isDiscovering || isDictsLoading || isLoadingRows;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!ticketConfig) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center py-16 text-[var(--text-tertiary)]">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-base mb-2">Тикеты не настроены</p>
          <p className="text-sm max-w-sm mx-auto">
            Создайте таблицу "Tickets" или "Tasks" в проекте, или настройте маппинг в настройках виджета
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <TicketsHeader
          title={
            ctx.selectedDocumentId != null
              ? `Тикеты документа «${ctx.selectedDocument?.name || 'Документ'}»`
              : 'Все тикеты'
          }
          subtitle={
            ctx.selectedDocumentId != null
              ? `${filteredTickets.length} привязанны${filteredTickets.length === 1 ? 'й' : 'х'} (из ${tickets.length} в проекте)`
              : `${tickets.length} тикетов в проекте`
          }
          source={source}
          displayMode={ctx.ticketsDisplayMode}
          onDisplayModeChange={ctx.setTicketsDisplayMode}
          totalCount={tickets.length}
          stats={stats}
          stateOptions={stateOptions}
          states={states}
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
          sortBy={ctx.ticketsSortBy}
          onSortByChange={ctx.setTicketsSortBy}
          sortOrder={ctx.ticketsSortOrder}
          onSortOrderChange={ctx.setTicketsSortOrder}
        />

        {/* Tickets list/cards */}
        {filteredTickets.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-tertiary)]">
            <Ticket className="w-12 h-12 mx-auto mb-4 opacity-30" />
            {ctx.selectedDocumentId != null && tickets.length > 0 ? (
              <>
                <p className="text-base mb-2">Нет привязанных тикетов</p>
                <p className="text-sm max-w-sm mx-auto">
                  В этом документе пока нет привязанных тикетов. Привяжите тикет через элементы документа.
                </p>
              </>
            ) : tickets.length === 0 ? (
              <>
                <p className="text-base mb-2">Нет тикетов</p>
                <p className="text-sm max-w-sm mx-auto">Тикеты появятся после создания</p>
              </>
            ) : (
              <>
                <p className="text-base mb-2">Ничего не найдено</p>
                <p className="text-sm max-w-sm mx-auto">Попробуйте изменить фильтр или поисковый запрос</p>
              </>
            )}
          </div>
        ) : ctx.ticketsDisplayMode === 'cards' ? (
          /* Cards view - hybrid: TicketRowHeader on top, TicketCardContent body */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTickets.map((ticket: TicketRow) => {
              const typeVal = getTicketField(ticket, ticketConfig, 'type');
              const stateVal = getTicketField(ticket, ticketConfig, 'state');
              const priorityVal = getTicketField(ticket, ticketConfig, 'priority');
              const descVal = getTicketField(ticket, ticketConfig, 'description');
              const dueDateVal = getTicketField(ticket, ticketConfig, 'due_date') || ticket.due_date || ticket.deadline;
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
                    tableColumns={tableColumns}
                    types={types}
                    states={states}
                    priorities={priorities}
                    isExpanded
                    hideChevron
                    onToggle={() => openTicketModal(ticket)}
                    onOpenChat={() => openTicketChat(ticket.id, getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`)}
                    onOpenModal={() => openTicketModal(ticket)}
                    onAttachToMessage={() => {
                      attachRowToMessage({
                        table_id: ticketConfig.table_id,
                        row_id: ticket.id,
                        table_name: 'Tickets',
                        table_icon: '🎫',
                        row_title: getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`,
                      });
                    }}
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
                      onAttachToMessage={() => {
                        attachRowToMessage({
                          table_id: ticketConfig.table_id,
                          row_id: ticket.id,
                          table_name: 'Tickets',
                          table_icon: '🎫',
                          row_title: getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`,
                        });
                      }}
                      onDescriptionChange={(newContent) => {
                        const descCol = ticketConfig.columns.description;
                        if (descCol) updateTicket.mutate({ ticketId: ticket.id, field: descCol, value: newContent });
                      }}
                      showDescription
                      showDates
                      showChatButton={false}
                      compact={false}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List view - compact with accordion */
          <div className="space-y-2">
            {filteredTickets.map((ticket: TicketRow) => {
              const typeVal = getTicketField(ticket, ticketConfig, 'type');
              const stateVal = getTicketField(ticket, ticketConfig, 'state');
              const priorityVal = getTicketField(ticket, ticketConfig, 'priority');
              const descVal = getTicketField(ticket, ticketConfig, 'description');
              const dueDateVal = getTicketField(ticket, ticketConfig, 'due_date') || ticket.due_date || ticket.deadline;
              const createdVal = getTicketField(ticket, ticketConfig, 'created_date') || ticket.created_at || ticket.created_date;
              const isExpanded = expandedIds.has(ticket.id);
              
              return (
                <div
                  key={ticket.id}
                  className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-blue-500/30 transition-all overflow-hidden"
                >
                  {/* Header row with inline dropdowns */}
                  <TicketRowHeader
                    ticket={ticket}
                    ticketConfig={ticketConfig}
                    tableColumns={tableColumns}
                    types={types}
                    states={states}
                    priorities={priorities}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpanded(ticket.id)}
                    onOpenChat={() => openTicketChat(ticket.id, getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`)}
                    onOpenModal={() => openTicketModal(ticket)}
                    onAttachToMessage={() => {
                      attachRowToMessage({
                        table_id: ticketConfig.table_id,
                        row_id: ticket.id,
                        table_name: 'Tickets',
                        table_icon: '🎫',
                        row_title: getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`,
                      });
                    }}
                    onStatusChange={(newState) => {
                      const stateCol = ticketConfig.columns.state;
                      if (stateCol) {
                        updateTicket.mutate({ ticketId: ticket.id, field: stateCol, value: newState });
                      }
                    }}
                    onPriorityChange={(newPriority) => {
                      const priorityCol = ticketConfig.columns.priority;
                      if (priorityCol) {
                        updateTicket.mutate({ ticketId: ticket.id, field: priorityCol, value: newPriority });
                      }
                    }}
                    onTypeChange={(newType) => {
                      const typeCol = ticketConfig.columns.type;
                      if (typeCol) {
                        updateTicket.mutate({ ticketId: ticket.id, field: typeCol, value: newType });
                      }
                    }}
                    onColorChange={(value) => {
                      const col = tableColumns.find(c => ((c as ColumnModel & { column_type?: string }).column_type || c.type) === 'color')?.name;
                      if (col) updateTicket.mutate({ ticketId: ticket.id, field: col, value });
                    }}
                  />

                  {/* Expanded content */}
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
                          if (stateCol) {
                            updateTicket.mutate({ ticketId: ticket.id, field: stateCol, value: newState });
                          }
                        }}
                        onPriorityChange={(newPriority) => {
                          const priorityCol = ticketConfig.columns.priority;
                          if (priorityCol) {
                            updateTicket.mutate({ ticketId: ticket.id, field: priorityCol, value: newPriority });
                          }
                        }}
                        onOpenChat={() => openTicketChat(ticket.id, getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`)}
                        onAttachToMessage={() => {
                          attachRowToMessage({
                            table_id: ticketConfig.table_id,
                            row_id: ticket.id,
                            table_name: 'Tickets',
                            table_icon: '🎫',
                            row_title: getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`,
                          });
                        }}
                        onDescriptionChange={(newContent) => {
                          const descCol = ticketConfig.columns.description;
                          if (descCol) {
                            updateTicket.mutate({ ticketId: ticket.id, field: descCol, value: newContent });
                          }
                        }}
                        showDescription={true}
                        showDates={true}
                        showChatButton={true}
                        compact={true}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {tickets.length > 1 && (
              <div className="text-center pt-2 text-xs text-[var(--text-tertiary)]">
                Показано {filteredTickets.length} из {tickets.length}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Card Detail Modal */}
      <CardDetailModal
        isOpen={showCardDetailModal}
        onClose={() => {
          setShowCardDetailModal(false);
          setSelectedTicketForModal(null);
        }}
        card={selectedTicketForModal}
        columns={tableColumns}
        titleField={ticketConfig?.columns.title || 'title'}
        onSave={handleCardSave}
        tableId={ticketConfig?.table_id}
        onOpenChat={handleOpenRowChat}
        onAttachToChat={handleAttachRowToChat}
        onAttachToMessage={handleAttachRowToMessage}
      />
    </div>
  );
}
