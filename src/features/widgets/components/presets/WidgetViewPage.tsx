import { useState, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useAIChat } from '@/features/ai-chat';
import { KanbanWidget } from '@/features/widgets/components/presets/KanbanWidget';
import { TableViewWidget } from '@/features/widgets/components/presets/TableViewWidget';
import { CalendarWidget } from '@/features/widgets/components/presets/CalendarWidget';
import { TimelineWidget } from '@/features/widgets/components/presets/TimelineWidget';
import { ChartWidget } from '@/features/widgets/components/presets/ChartWidget';
import { GalleryWidget } from '@/features/widgets/components/presets/GalleryWidget';
import { NumberWidget } from '@/features/widgets/components/presets/NumberWidget';
import { TaskListWidget } from '@/features/widgets/components/presets/TaskListWidget';
import { AIAgentsWidget } from '@/features/widgets/components/presets/AIAgentsWidget';
import { DocumentsWidget } from '@/features/widgets/components/presets/DocumentsWidget';
import { FitnessWidget } from '@/features/widgets/components/presets/FitnessWidget';
import { LabsWidget } from '@/features/widgets/components/presets/LabsWidget';
import { VirtualOfficeWidget } from '@/features/widgets/components/presets/virtual-office';
import { TerminalWidget } from '@/features/widgets/components/presets/TerminalWidget';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import { AddColumnOptionModal } from '@/features/widgets/components/modals/AddColumnOptionModal';
import { CardDetailModal } from '@/features/widgets/components/modals/CardDetailModal';
import { TableFilters } from '@/features/tables/components/TableFilters/TableFilters';
import { PrintModal } from '@/features/tables/components/PrintModal';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { useTicketData, type TicketRowData } from '@/features/widgets/hooks/useTicketData';
import type { Widget } from '@/features/widgets/types/widget.types';
import type { ColumnModel } from '@/features/tables/types/table.types';

interface DateRange {
  from?: string;
  to?: string;
}

export function WidgetViewPage() {
  const { widgetId } = useParams<{ widgetId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddColumnOptionModal, setShowAddColumnOptionModal] = useState(false);
  const [showAddStatusRowModal, setShowAddStatusRowModal] = useState(false);
  const [showCardDetailModal, setShowCardDetailModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<KanbanRowData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // TableFilters state
  const [searchColumns, setSearchColumns] = useState<string[]>([]);
  const [selectFilters, setSelectFilters] = useState<Record<string, string[]>>({});
  const [dateFilters, setDateFilters] = useState<Record<string, DateRange>>({});
  const [activeFilterColumns, setActiveFilterColumns] = useState<string[]>([]);
  const [printOpen, setPrintOpen] = useState(false);
  // State for initial tab in CardDetailModal - MUST be before any conditional returns
  const [cardDetailInitialTab, setCardDetailInitialTab] = useState<'details' | 'files' | 'comments'>('details');

  // Get AI Chat context for opening task chats - MUST be before any conditional returns
  const { openTaskChat, openChat } = useAIChat();

  // Use unified hook for kanban data loading
  const {
    widget,
    widgetData,
    tableColumns,
    columnsInfo,
    kanbanGroupColumn,
    kanbanColumnOptions,
    relationData: allRelationData,
    relationTableId,
    relationTableRows,
    isLoading: widgetLoading,
    isLoadingData: dataLoading,
    refetchData
  } = useTicketData({ widgetId: Number(widgetId), enabled: !!widgetId });

  // Fetch columns for the related statuses table (for AddRowModal of "add status row")
  const { data: statusTableColumns = [] } = useQuery({
    queryKey: ['table-columns', relationTableId],
    queryFn: async () => {
      if (!relationTableId) return [];
      const { columns } = await tablesApi.getColumns(String(relationTableId));
      return columns;
    },
    enabled: !!relationTableId,
  });

  // Mutation for updating column options
  const updateColumnMutation = useMutation({
    mutationFn: async ({ columnId, newOptions }: { columnId: string; newOptions: Array<{ value: string; label: string; color?: string }> }) => {
      if (!widget?.config?.table_id) throw new Error('Table ID not found');
      return tablesApi.updateColumn(String(widget.config.table_id), columnId, {
        config: {
          ...kanbanGroupColumn?.config,
          options: newOptions
        }
      });
    },
    onSuccess: () => {
      // Refresh both columns and data
      queryClient.invalidateQueries({ queryKey: ['table-columns', widget?.config?.table_id] });
      queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
    }
  });

  // Filter data by search query and active filters (matching TableFilters logic)
  const filteredData = useMemo(() => {
    // Ensure we always work with arrays
    let data = Array.isArray(widgetData) ? widgetData : [];
    const cols = Array.isArray(tableColumns) ? tableColumns : [];
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      // Get searchable columns or search all
      const columnsToSearch = searchColumns.length > 0 
        ? cols.filter((col: ColumnModel) => searchColumns.includes(col.id))
        : cols.filter((col: ColumnModel) => ['text', 'number', 'email', 'url', 'phone'].includes(col.type));
      
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
      if (Array.isArray(values) && values.length > 0) {
        const column = cols.find((c: ColumnModel) => c.id === columnId);
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
      if (range && (range.from || range.to)) {
        const column = cols.find((c: ColumnModel) => c.id === columnId);
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

  if (widgetLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--bg-primary)]">
        <div className="text-[var(--text-secondary)]">Загрузка модуля...</div>
      </div>
    );
  }

  if (!widget) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--bg-primary)]">
        <div className="text-red-500 mb-4">Модуль не найден</div>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-lg"
        >
          Назад
        </button>
      </div>
    );
  }

  // Handle moving card between columns (drag-and-drop)
  const handleMoveCard = async (cardId: string, newStatus: string) => {
    if (!widget?.config?.table_id || !kanbanGroupColumn) {
      logger.error('Cannot move card: missing table_id or kanbanGroupColumn');
      return;
    }

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
      await tablesApi.updateRow(
        String(widget.config.table_id),
        cardId,
        { [groupField]: newStatus }
      );
      // Refetch to sync with server — await to ensure UI stays in sync
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

  // Handle opening chat for a card/row
  const handleOpenCardChat = async (card: WidgetRowData) => {
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

  // Handle card double click - open detail modal or chat
  const handleCardDoubleClick = (card: WidgetRowData, initialTab: 'details' | 'files' | 'comments' = 'details') => {
    // If comments tab requested, open AI Chat Panel instead of modal
    if (initialTab === 'comments') {
      handleOpenCardChat(card);
      return;
    }
    setSelectedCard(card);
    setCardDetailInitialTab(initialTab);
    setShowCardDetailModal(true);
  };

  // Handle card save from detail modal
  const handleCardSave = async (cardId: string, data: Record<string, unknown>) => {
    if (!widget?.config?.table_id) return;
    
    await tablesApi.updateRow(String(widget.config.table_id), cardId, data);
    // Invalidate and immediately refetch (consistent with handleCardFieldUpdate)
    await queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
    await refetchData();
  };

  // Handle card deletion
  const handleDeleteCard = async (cardId: string) => {
    if (!widget?.config?.table_id) return;
    try {
      await tablesApi.deleteRow(String(widget.config.table_id), cardId);
      await queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
      await refetchData();
    } catch (error) {
      logger.error('Failed to delete card:', error);
    }
  };

  // Handle individual field update from kanban card
  const handleCardFieldUpdate = async (cardId: string, field: string, value: unknown) => {
    if (!widget?.config?.table_id) return;
    
    try {
      logger.debug('[handleCardFieldUpdate] Updating:', { tableId: widget.config.table_id, cardId, field, value });
      await tablesApi.updateRow(String(widget.config.table_id), cardId, { [field]: value });
      // Invalidate and immediately refetch
      await queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
      await refetchData();
    } catch (error) {
      logger.error('Failed to update card field:', error);
    }
  };

  // Render appropriate widget based on preset
  const renderWidgetContent = () => {
    const props = { widget, data: filteredData };
    
    // Map tableColumns to columnsInfo format for editable fields (shared across widgets)
    // Include all column properties: displayName, isVisible, orderIndex, width
    // Ensure tableColumns is always an array before mapping
    const cols = Array.isArray(tableColumns) ? tableColumns : [];
    const columnsInfo = cols
      .map((col: ColumnModel) => ({
        name: col.name,
        displayName: col.displayName || col.name,
        type: col.type,
        config: col.config,
        isVisible: col.isVisible !== false,
        orderIndex: col.orderIndex ?? 999,
        width: col.width
      }))
      .sort((a, b) => a.orderIndex - b.orderIndex);

    switch (widget.preset_name) {
      case 'kanban_board':
        // Get active status filters for the kanban group column
        const kanbanGroupColumnId = kanbanGroupColumn?.id;
        const activeKanbanStatusFilters = kanbanGroupColumnId ? selectFilters[kanbanGroupColumnId] : undefined;
        
        // Debug log for relation support
        logger.debug('[WidgetViewPage] Passing to KanbanWidget:');
        logger.debug('  - columnsInfo:', columnsInfo.length, 'columns');
        logger.debug('  - columnsInfo with relations:', columnsInfo.filter(c => c.config?.relation?.enabled || c.config?.relatedTableId).map(c => c.name));
        logger.debug('  - allRelationData:', allRelationData?.size ?? 0, 'tables');
        
        return (
          <KanbanWidget
            {...props}
            columnOptions={kanbanColumnOptions}
            columnsInfo={columnsInfo}
            relationData={allRelationData}
            activeStatusFilters={activeKanbanStatusFilters}
            cardColumns={widget.config?.card_columns || []}
            visibleColumns={widget.config?.visible_columns || []}
            scheduledDateColumn={widget.config?.kanban?.scheduledDateColumn}
            dueDateColumn={widget.config?.kanban?.dueDateColumn}
            colorColumn={widget.config?.kanban?.colorColumn}
            showToolbar={widget.config?.show_filters !== false}
            onAddColumn={() => {
              setShowAddColumnOptionModal(true);
            }}
            onAddStatusRow={() => {
              setShowAddStatusRowModal(true);
            }}
            groupRelationTableId={relationTableId}
            onAddCard={(columnValue) => {
              setShowAddModal(true);
            }}
            onMoveCard={handleMoveCard}
            onCardDoubleClick={handleCardDoubleClick}
            onCardUpdate={handleCardFieldUpdate}
            onDeleteCard={handleDeleteCard}
            onAddRow={() => setShowAddModal(true)}
            onRefresh={handleRefresh}
            onPrint={() => setPrintOpen(true)}
            tableId={widget.config?.table_id}
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
            onRowDoubleClick={handleCardDoubleClick}
          />
        );
      case 'calendar_widget':
        return (
          <CalendarWidget 
            {...props} 
            columnsInfo={columnsInfo}
            onEventClick={handleCardDoubleClick}
            onEventUpdate={handleCardFieldUpdate}
            onAddEvent={(date) => {
              // TODO: Pre-fill date when creating event
              setShowAddModal(true);
            }}
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
            onAddEvent={(date) => {
              setShowAddModal(true);
            }}
          />
        );
      case 'chart_widget':
        return <ChartWidget {...props} />;
      case 'gallery_widget':
        return <GalleryWidget {...props} onCardClick={(card) => handleCardDoubleClick(card, 'details')} />;
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
            onTaskToggle={(taskId, completed) => handleCardFieldUpdate(taskId, widget.config?.completed_column || 'completed', completed)}
            onTaskDoubleClick={handleCardDoubleClick}
            onTaskUpdate={handleCardFieldUpdate}
          />
        );
      case 'ai_agents':
        return <AIAgentsWidget widget={widget} data={widgetData} />;
      case 'documents':
      case 'documents_v4':  // Legacy alias
        return <DocumentsWidget widget={widget} data={widgetData} />;
      case 'wellness':
      case 'fitness':  // Legacy alias for wellness
        return <FitnessWidget config={widget?.config as any} spaceId={widget?.space_id} />;
      case 'labs':
        return <LabsWidget widget={widget} data={widgetData} />;
      case 'virtual_office':
        return <VirtualOfficeWidget widget={widget} data={widgetData} />;
      case 'terminal':
        return <TerminalWidget widget={widget} data={widgetData} />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
            Неизвестный тип модуля: {widget.preset_name}
          </div>
        );
    }
  };

  const showTableFilters = !!(widget?.config?.table_id && tableColumns.length > 0 && widget?.config?.show_filters !== false && widget?.preset_name !== 'kanban_board');

  return (
    <section className="flex flex-col h-full p-4">
      {/* TableFilters - show for any widget with a table (except kanban which has integrated toolbar) */}
      {showTableFilters && (
        <div className="flex-shrink-0">
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
            onAddRow={() => setShowAddModal(true)}
            addRowText={widget?.preset_name === 'documents' ? 'Добавить документ' : undefined}
            onRefresh={handleRefresh}
            showPrint={true}
            onPrint={() => setPrintOpen(true)}
            compact
          />
        </div>
      )}

      {/* Widget Content Area - drops top border + top corners when toolbar above provides them */}
      <div className={`flex-1 min-h-0 overflow-hidden border-[var(--border-primary)] ${showTableFilters ? 'rounded-b-2xl border-x border-b' : 'rounded-2xl border'}`}>
        {dataLoading ? (
          <div className="flex items-center justify-center h-full bg-[var(--bg-secondary)]">
            <div className="text-[var(--text-tertiary)]">Загрузка данных...</div>
          </div>
        ) : (
          renderWidgetContent()
        )}
      </div>

      {/* Add Row Modal - using existing component */}
      <AddRowModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onConfirm={async (data) => {
          if (widget?.config?.table_id) {
            await tablesApi.createRow(String(widget.config.table_id), data);
            queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
          }
        }}
        columns={tableColumns}
        existingIds={widgetData.map((row: WidgetRowData) => String(row.id || row.data?.id || ''))}
      />

      {/* Add Column Option Modal - for Kanban columns */}
      <AddColumnOptionModal
        isOpen={showAddColumnOptionModal}
        onClose={() => setShowAddColumnOptionModal(false)}
        columnName={kanbanGroupColumn?.displayName || kanbanGroupColumn?.name || 'Не найдено'}
        existingOptions={kanbanGroupColumn?.config?.options || []}
        onConfirm={(newOption) => {
          if (!kanbanGroupColumn) {
            logger.error('Cannot add column option: kanbanGroupColumn is null');
            return;
          }
          const existingOptions = kanbanGroupColumn.config?.options || [];
          const newOptions = [
            ...existingOptions,
            { value: newOption.value, label: newOption.label, color: newOption.color }
          ];
          updateColumnMutation.mutate({
            columnId: kanbanGroupColumn.id,
            newOptions
          });
        }}
      />

      {/* Add Status Row Modal — opens AddRowModal for the related statuses table */}
      <AddRowModal
        isOpen={showAddStatusRowModal}
        onClose={() => setShowAddStatusRowModal(false)}
        onConfirm={async (data) => {
          if (relationTableId) {
            await tablesApi.createRow(String(relationTableId), data);
            queryClient.invalidateQueries({ queryKey: ['relation-table-rows', relationTableId] });
            queryClient.invalidateQueries({ queryKey: ['ticket-relation-data'] });
            queryClient.invalidateQueries({ queryKey: ['widget-data', widgetId] });
          }
        }}
        columns={statusTableColumns}
        tableId={relationTableId ?? undefined}
        tableName={'Таблица статусов'}
      />

      {/* Card Detail Modal - for viewing/editing cards on double-click */}
      <CardDetailModal
        isOpen={showCardDetailModal}
        onClose={() => {
          setShowCardDetailModal(false);
          setSelectedCard(null);
        }}
        card={selectedCard}
        columns={tableColumns}
        titleField={widget?.config?.card_title_column || widget?.config?.titleColumn || 'title'}
        groupByField={kanbanGroupColumn?.name}
        onSave={handleCardSave}
        initialTab={cardDetailInitialTab}
        tableId={widget?.config?.table_id}
        relationData={allRelationData}
        descriptionField="why"
      />

      {/* Print Modal */}
      <PrintModal
        isOpen={printOpen}
        onClose={() => setPrintOpen(false)}
        columns={tableColumns}
        rows={filteredData.map((row: WidgetRowData) => ({
          id: String(row.id || row.data?.id || ''),
          data: row.data || row
        }))}
        selectedRowIds={new Set()}
        filteredRowIds={new Set(filteredData.map((row: WidgetRowData) => String(row.id || row.data?.id || '')))}
        tableName={widget?.name || 'Модуль'}
        viewType={widget?.preset_name === 'kanban_board' ? 'kanban' : 
                  widget?.preset_name === 'timeline' ? 'timeline' :
                  widget?.preset_name === 'calendar' ? 'calendar' : 'table'}
      />
    </section>
  );
}
