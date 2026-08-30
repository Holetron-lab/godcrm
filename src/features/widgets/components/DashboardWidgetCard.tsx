import { useState, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useAIChat } from '@/features/ai-chat/context/AIChatContext';
import { KanbanWidget } from './presets/KanbanWidget';
import { TableViewWidget } from './presets/TableViewWidget';
import { CalendarWidget } from './presets/CalendarWidget';
import { TimelineWidget } from './presets/TimelineWidget';
import { ChartWidget } from './presets/ChartWidget';
import { GalleryWidget } from './presets/GalleryWidget';
import { NumberWidget } from './presets/NumberWidget';
import { TaskListWidget } from './presets/TaskListWidget';
import { AIAgentsWidget } from './presets/AIAgentsWidget';
import { LabsWidget } from './presets/LabsWidget';
import { VirtualOfficeWidget } from './presets/virtual-office';
import { TerminalWidget } from './presets/TerminalWidget';
import { DocumentsWidget } from './presets/DocumentsWidget';
import { WelcomeDashboardWidget } from './presets/WelcomeDashboardWidget';
import { getWidgetPreset } from '../registry/modulePresetRegistry';
import { TableFilters } from '@/features/tables/components/TableFilters/TableFilters';
import { CardDetailModal } from './modals/CardDetailModal';
import { GalleryCardDetailModal } from './modals/GalleryCardDetailModal';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { ticketsApi, isTicketsTable, resolveStateName } from '@/features/tickets/api/ticketsApi';
import { useTicketData, type TicketRowData, type KanbanRowData } from '../hooks/useTicketData';
import { usePublicView } from '@/features/public/PublicViewContext';
import type { Widget } from '../types/widget.types';
import type { ColumnModel } from '@/features/tables/types/table.types';

interface DateRange {
  from?: string;
  to?: string;
}

interface DashboardWidgetCardProps {
  widgetId: number;
  borderRadius?: number;
  isMobile?: boolean;
}

export function DashboardWidgetCard({ widgetId, borderRadius = 12, isMobile = false }: DashboardWidgetCardProps) {
  const queryClient = useQueryClient();
  const { openTaskChat, openChat, attachRowToChat, attachRowToMessage } = useAIChat();
  // ADR-0060 §"ТОТ ЖЕ" — when mounted under PublicViewProvider, the Documents
  // preset needs explicit `dataSource='public'` so its internal registry +
  // atoms fetches route through publicApi instead of the auth'd endpoints.
  const { publicSlug } = usePublicView();
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchColumns, setSearchColumns] = useState<string[]>([]);
  const [selectFilters, setSelectFilters] = useState<Record<string, string[]>>({});
  const [dateFilters, setDateFilters] = useState<Record<string, DateRange>>({});
  const [activeFilterColumns, setActiveFilterColumns] = useState<string[]>([]);
  
  // Card detail modal state
  const [showCardDetailModal, setShowCardDetailModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<KanbanRowData | null>(null);
  const [cardDetailInitialTab, setCardDetailInitialTab] = useState<'details' | 'files' | 'comments'>('details');
  
  // Add row modal state
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [kanbanPrefill, setKanbanPrefill] = useState<Record<string, unknown> | null>(null);

  // Use unified hook for kanban data loading
  const {
    widget,
    widgetData,
    tableColumns,
    columnsInfo,
    kanbanGroupColumn,
    kanbanColumnOptions,
    relationData: allRelationData,
    isLoadingWidget,
    refetchData,
    tableConfig
  } = useTicketData({ widgetId });

  // Filter data
  const filteredData = useMemo(() => {
    let data = widgetData;
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const columnsToSearch = searchColumns.length > 0 
        ? tableColumns.filter((col: ColumnModel) => searchColumns.includes(col.id))
        : tableColumns.filter((col: ColumnModel) => ['text', 'number', 'email', 'url', 'phone'].includes(col.type));
      
      data = data.filter((row: KanbanRowData) => {
        const rowData = row.data || row;
        return columnsToSearch.some((col: ColumnModel) => {
          const value = rowData[col.name];
          return String(value || '').toLowerCase().includes(query);
        });
      });
    }
    
    // Apply select filters
    Object.entries(selectFilters).forEach(([columnId, values]) => {
      if (values.length > 0) {
        const column = tableColumns.find((c: ColumnModel) => c.id === columnId);
        if (column) {
          data = data.filter((row: KanbanRowData) => {
            const rowData = row.data || row;
            const cellValue = rowData[column.name];
            if (Array.isArray(cellValue)) {
              return cellValue.some(v => values.includes(String(v)));
            }
            return values.includes(String(cellValue));
          });
        }
      }
    });
    
    // Apply date filters
    Object.entries(dateFilters).forEach(([columnId, range]) => {
      if (range.from || range.to) {
        const column = tableColumns.find((c: ColumnModel) => c.id === columnId);
        if (column) {
          data = data.filter((row: KanbanRowData) => {
            const rowData = row.data || row;
            const cellValue = rowData[column.name];
            if (!cellValue) return false;
            const date = new Date(cellValue as string);
            if (range.from && date < new Date(range.from)) return false;
            if (range.to && date > new Date(range.to + 'T23:59:59')) return false;
            return true;
          });
        }
      }
    });
    
    return data;
  }, [widgetData, searchQuery, searchColumns, selectFilters, dateFilters, tableColumns]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
  };

  // Handle opening chat for a card/row (same as in WidgetViewPage)
  const handleOpenCardChat = async (card: KanbanRowData) => {
    if (!widget?.config?.table_id) return;
    
    const cardId = String(card.id);
    const cardTitle = card.data?.name || card.data?.title || `#${cardId}`;
    
    try {
      const response = await apiClient.get<{ data: { conversationId: number; id: number } }>(
        `/chat/tasks/${widget.config.table_id}/${cardId}?create=true`
      );
      const convId = response.data?.conversationId || response.data?.id;
      if (convId) {
        openTaskChat({
          conversationId: convId,
          tableId: widget.config.table_id,
          rowId: Number(cardId),
          rowTitle: String(cardTitle)
        });
      } else {
        logger.error('[handleOpenCardChat] No conversationId in response');
      }
    } catch (error) {
      logger.error('[handleOpenCardChat] Failed to open chat:', error);
      // Fallback: just open the chat panel
      openChat();
    }
  };

  // Resolve row name from card data
  const resolveRowName = (card: KanbanRowData) => {
    return String(card.data?.name || card.data?.title || card.data?.what || card.data?.subject || `#${card.id}`);
  };

  const handleOpenRowChat = (rowId: string) => {
    const card = widgetData.find((r: KanbanRowData) => String(r.id) === rowId);
    if (card) handleOpenCardChat(card);
  };

  const handleAttachRowToChat = (rowId: string) => {
    if (!widget?.config?.table_id) return;
    const card = widgetData.find((r: KanbanRowData) => String(r.id) === rowId);
    attachRowToChat({
      table_id: widget.config.table_id,
      row_id: Number(rowId),
      table_name: widget?.name || '',
      row_title: card ? resolveRowName(card) : `#${rowId}`,
    });
  };

  const handleAttachRowToMessage = (rowId: string) => {
    if (!widget?.config?.table_id) return;
    const card = widgetData.find((r: KanbanRowData) => String(r.id) === rowId);
    attachRowToMessage({
      table_id: widget.config.table_id,
      row_id: Number(rowId),
      table_name: widget?.name || '',
      row_title: card ? resolveRowName(card) : `#${rowId}`,
    });
  };

  // Handle card interactions
  // ADR-098 Phase 2: Use specialized tickets API for Tickets table (1708)
  // This provides state machine validation, cascade updates, and control gate
  const handleMoveCard = async (cardId: string, newStatus: string) => {
    if (!widget?.config?.table_id || !kanbanGroupColumn) return;
    const groupField = kanbanGroupColumn.name;
    const tableId = Number(widget.config.table_id);
    const cacheKey = ['ticket-data', Number(widgetId) || 'direct', tableId];

    // Optimistic update: immediately move card in local cache
    const previousData = queryClient.getQueryData<TicketRowData[]>(cacheKey);
    if (previousData) {
      const updated = previousData.map((row: TicketRowData) => {
        if (String(row.id) === cardId) {
          return { ...row, data: { ...row.data, [groupField]: newStatus } };
        }
        return row;
      });
      queryClient.setQueryData(cacheKey, updated);
    }

    try {
      // ADR-098: Use specialized tickets API for state machine validated status changes
      if (isTicketsTable(tableId) && groupField === 'state') {
        const stateName = resolveStateName(newStatus);
        if (stateName) {
          await ticketsApi.updateStatus(cardId, stateName);
        } else {
          // Fallback to generic update if state can't be resolved
          logger.warn('[handleMoveCard] Could not resolve ticket state, falling back to generic update:', newStatus);
          await tablesApi.updateRow(String(widget.config.table_id), cardId, { [groupField]: newStatus });
        }
      } else {
        // Generic table: use standard row update
        await tablesApi.updateRow(String(widget.config.table_id), cardId, { [groupField]: newStatus });
      }
      // Refetch to sync with server — invalidate cache AND await refetch
      // (invalidateQueries alone doesn't guarantee UI re-render; see ADR-097)
      await queryClient.invalidateQueries({ queryKey: cacheKey });
      await refetchData();
    } catch (error) {
      logger.error('Failed to move card:', error);
      // Rollback optimistic update on error
      if (previousData) {
        queryClient.setQueryData(cacheKey, previousData);
      }
    }
  };

  // Handle card double click - open detail modal or chat
  const handleCardDoubleClick = (card: KanbanRowData, initialTab: 'details' | 'files' | 'comments' = 'details') => {
    // If comments tab requested, open AI Chat Panel instead of modal
    if (initialTab === 'comments') {
      handleOpenCardChat(card);
      return;
    }
    setSelectedCard(card);
    setCardDetailInitialTab(initialTab);
    setShowCardDetailModal(true);
  };

  const handleCardFieldUpdate = async (cardId: string, field: string, value: unknown) => {
    if (!widget?.config?.table_id) return;
    
    try {
      await tablesApi.updateRow(String(widget.config.table_id), cardId, { [field]: value });
      await queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
      await refetchData();
    } catch (error) {
      logger.error('Failed to update card field:', error);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!widget?.config?.table_id) return;
    try {
      await tablesApi.deleteRow(String(widget.config.table_id), cardId);
      await queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
      await refetchData();
      showToast('Тикет удалён', 'success');
    } catch (error) {
      logger.error('Failed to delete card:', error);
      const msg = error instanceof Error ? error.message : '';
      const forbidden = /\b403\b|forbidden|permission|прав/i.test(msg);
      showToast(
        forbidden ? 'Нет прав на удаление этого тикета' : 'Не удалось удалить тикет',
        'error',
      );
    }
  };

  const handleCardSave = async (cardId: string, data: Record<string, unknown>) => {
    if (!widget?.config?.table_id) return;
    await tablesApi.updateRow(String(widget.config.table_id), cardId, data);
    queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
  };

  // Handle add row
  const handleAddRow = () => {
    setShowAddRowModal(true);
  };

  const handleRowAdded = () => {
    setShowAddRowModal(false);
    queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
  };

  // Render widget content
  const renderWidgetContent = () => {
    const props = { widget, data: filteredData };

    switch (widget.preset_name) {
      case 'kanban_board':
        // Get active status filters for the kanban group column
        const kanbanGroupColumnId = kanbanGroupColumn?.id;
        const activeKanbanStatusFilters = kanbanGroupColumnId ? selectFilters[kanbanGroupColumnId] : undefined;
        
        return (
          <KanbanWidget
            {...props}
            columnOptions={kanbanColumnOptions}
            columnsInfo={columnsInfo}
            activeStatusFilters={activeKanbanStatusFilters}
            cardColumns={widget.config?.card_columns || []}
            visibleColumns={widget.config?.visible_columns || []}
            scheduledDateColumn={widget.config?.kanban?.scheduledDateColumn}
            dueDateColumn={widget.config?.kanban?.dueDateColumn}
            colorColumn={widget.config?.kanban?.colorColumn}
            relationData={allRelationData}
            showToolbar={widget.config?.show_filters !== false}
            compact
            onMoveCard={handleMoveCard}
            onCardDoubleClick={handleCardDoubleClick}
            onCardUpdate={handleCardFieldUpdate}
            onOpenRowChat={handleOpenRowChat}
            onAttachRowToMessage={handleAttachRowToMessage}
            onDeleteCard={handleDeleteCard}
            onAddRow={handleAddRow}
            onAddCard={(columnValue) => {
              if (kanbanGroupColumn?.name) {
                setKanbanPrefill({ [kanbanGroupColumn.name]: columnValue });
              }
              setShowAddRowModal(true);
            }}
            onRefresh={handleRefresh}
            filterState={{
              searchQuery,
              onSearchChange: setSearchQuery,
              searchColumns,
              onSearchColumnsChange: setSearchColumns,
              selectFilters,
              onSelectFiltersChange: setSelectFilters,
              dateFilters,
              onDateFiltersChange: setDateFilters,
              activeFilterColumns,
              onActiveFilterColumnsChange: setActiveFilterColumns,
              tableColumns: tableColumns as any,
            }}
          />
        );
      case 'table_view':
      case 'table_widget':
        return (
          <TableViewWidget
            {...props}
            columnsInfo={columnsInfo}
            relationData={allRelationData}
            tableConfig={tableConfig}
            onRowDoubleClick={(row) => handleCardDoubleClick(row, 'details')}
          />
        );
      case 'calendar_widget':
        return (
          <CalendarWidget 
            {...props} 
            columnsInfo={columnsInfo}
            onEventClick={handleCardDoubleClick}
            onEventUpdate={handleCardFieldUpdate}
          />
        );
      case 'timeline_widget':
        return (
          <TimelineWidget
            {...props}
            columnsInfo={columnsInfo}
            relationData={allRelationData}
            onEventClick={handleCardDoubleClick}
            onEventUpdate={handleCardFieldUpdate}
          />
        );
      case 'chart_widget':
        return <ChartWidget {...props} />;
      case 'gallery_widget':
        // columnsInfo is what lets the gallery find the state column on its own —
        // without it archived cards never sink and never go grey.
        return <GalleryWidget {...props} columnsInfo={columnsInfo} onCardClick={(card) => handleCardDoubleClick(card, 'details')} />;
      case 'number_widget':
        return <NumberWidget {...props} />;
      case 'task_list':
        return (
          <TaskListWidget
            {...props}
            columnsInfo={columnsInfo}
            completedColumn={widget.config?.completed_column || widget.config?.status_column}
            cardTitleColumn={widget.config?.card_title_column}
            cardSubtitleColumn={widget.config?.card_subtitle_column}
            scheduledDateColumn={widget.config?.scheduled_date_column}
            dueDateColumn={widget.config?.due_date_column}
            colorColumn={widget.config?.color_column}
            cardColumns={widget.config?.card_columns || []}
            visibleColumns={widget.config?.visible_columns || []}
            compact
            onTaskToggle={(taskId, completed) => handleCardFieldUpdate(taskId, widget.config?.completed_column || 'completed', completed)}
            onTaskDoubleClick={handleCardDoubleClick}
            onTaskUpdate={handleCardFieldUpdate}
          />
        );
      case 'ai_agents':
        return <AIAgentsWidget widget={widget} data={widgetData} />;
      case 'labs':
        return <LabsWidget widget={widget} data={widgetData} isEditMode={true} />;
      case 'virtual_office':
        return <VirtualOfficeWidget widget={widget} data={widgetData} />;
      case 'terminal':
        return <TerminalWidget widget={widget} data={widgetData} />;
      case 'documents':
      case 'documents_v4':
        if (publicSlug) {
          return (
            <DocumentsWidget
              dataSource="public"
              publicSlug={publicSlug}
              widgetId={widget.id}
              isEditMode={false}
              compact
            />
          );
        }
        return <DocumentsWidget widget={widget} data={widgetData} compact />;
      case 'welcome_dashboard':
        return <WelcomeDashboardWidget widget={widget} data={widgetData} />;
      default: {
        // Autonomous-module presets (MODULE-CONTRACT v1, seam #2).
        const ModulePreset = getWidgetPreset(widget?.preset_name);
        if (ModulePreset) return <ModulePreset {...props} />;
        return (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
            Неизвестный тип виджета: {widget?.preset_name}
          </div>
        );
      }
    }
  };

  // Loading state
  if (isLoadingWidget) {
    return (
      <div
        className={`h-full flex items-center justify-center bg-[var(--bg-primary)] ${isMobile ? '' : 'border border-[var(--border-primary)]'}`}
        style={{ borderRadius: `${borderRadius}px` }}
      >
        <div className="animate-pulse text-[var(--text-tertiary)]">Загрузка виджета...</div>
      </div>
    );
  }

  // No widget found
  if (!widget) {
    return (
      <div
        className={`h-full flex items-center justify-center bg-[var(--bg-primary)] ${isMobile ? '' : 'border border-[var(--border-primary)]'}`}
        style={{ borderRadius: `${borderRadius}px` }}
      >
        <div className="text-[var(--text-tertiary)]">Виджет не найден</div>
      </div>
    );
  }

  // Check if filters should be shown (kanban has its own integrated toolbar)
  const showFilters = widget.config?.show_filters !== false && widget.config?.table_id && tableColumns.length > 0 && widget.preset_name !== 'kanban_board';

  return (
    <div
      className={`h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden ${isMobile ? '' : 'border border-[var(--border-primary)]'}`}
      style={{ borderRadius: `${borderRadius}px` }}
    >
      {/* Filters - only show if enabled and has table data */}
      {showFilters && (
        <div className="flex-shrink-0 px-2 py-1.5 border-b border-[var(--border-secondary)]">
          <TableFilters
            columns={tableColumns}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchColumns={searchColumns}
            onSearchColumnsChange={setSearchColumns}
            selectFilters={selectFilters}
            onSelectFiltersChange={setSelectFilters}
            dateFilters={dateFilters}
            onDateFiltersChange={setDateFilters}
            activeFilterColumns={activeFilterColumns}
            onActiveFilterColumnsChange={setActiveFilterColumns}
            onAddRow={handleAddRow}
            onRefresh={handleRefresh}
            compact
          />
        </div>
      )}

      {/* Widget Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {renderWidgetContent()}
      </div>

      {/* Card Detail Modal */}
      {showCardDetailModal && selectedCard && widget?.config?.table_id && (
        widget.preset_name === 'gallery_widget' ? (
          <GalleryCardDetailModal
            isOpen={showCardDetailModal}
            onClose={() => setShowCardDetailModal(false)}
            card={selectedCard}
            columns={tableColumns}
            config={widget.config}
            onSave={handleCardSave}
            tableId={String(widget.config.table_id)}
          />
        ) : (
          <CardDetailModal
            isOpen={showCardDetailModal}
            onClose={() => setShowCardDetailModal(false)}
            card={selectedCard}
            columns={tableColumns}
            onSave={handleCardSave}
            tableId={String(widget.config.table_id)}
            initialTab={cardDetailInitialTab}
            relationData={allRelationData}
            onOpenChat={handleOpenRowChat}
            onAttachToChat={handleAttachRowToChat}
            onAttachToMessage={handleAttachRowToMessage}
          />
        )
      )}

      {/* Add Row Modal */}
      {showAddRowModal && widget?.config?.table_id && (
        <AddRowModal
          isOpen={showAddRowModal}
          onClose={() => {
            setShowAddRowModal(false);
            setKanbanPrefill(null);
          }}
          onConfirm={async (data) => {
            if (widget?.config?.table_id) {
              await tablesApi.createRow(String(widget.config.table_id), data);
              handleRowAdded();
            }
          }}
          columns={tableColumns}
          prefilledData={kanbanPrefill ?? undefined}
          tableId={String(widget.config.table_id)}
          tableName={widget?.title}
        />
      )}
    </div>
  );
}
