import { useState, useMemo, useCallback } from 'react';
import { Columns3 } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { DEFAULT_LANE_COLORS, hexToRgba } from './kanban-utils';
import { ExpandableCard } from './KanbanCard';
import { KanbanDroppableColumn } from './KanbanColumn';
import { KanbanToolbar } from './KanbanToolbar';
import { useLaneAxis } from '../_shared/useLaneAxis';
import type { KanbanWidgetProps, KanbanCardData, FieldValue } from './kanban-types';

/**
 * Kanban Widget - displays data in kanban board format
 * Supports light and dark themes via CSS variables
 * Supports drag-and-drop between columns
 * Supports inline expandable cards
 */
export function KanbanWidget(props: KanbanWidgetProps) {
  // ADR-0060 P5c — neutralise mutation callbacks when rendered under a
  // public read-only scope. Children gate their add/delete affordances on
  // whether the corresponding callback is defined, so this single rewrite
  // covers the entire toolbar/column/card edit surface.
  const publicReadOnly = useIsPublicReadOnly();
  const { widget, data, columnOptions, columnsInfo = [], relationData, activeStatusFilters, compact, scheduledDateColumn, dueDateColumn, cardColumns, visibleColumns, filterState, showToolbar = true, onRefresh, onPrint, tableId, onCardDoubleClick, onOpenRowChat, onAttachRowToMessage } = props;
  const onSettings = publicReadOnly ? undefined : props.onSettings;
  const onAddColumn = publicReadOnly ? undefined : props.onAddColumn;
  const onAddStatusRow = publicReadOnly ? undefined : props.onAddStatusRow;
  const groupRelationTableId = props.groupRelationTableId;
  const onAddCard = publicReadOnly ? undefined : props.onAddCard;
  const onMoveCard = publicReadOnly ? undefined : props.onMoveCard;
  const onCardUpdate = publicReadOnly ? undefined : props.onCardUpdate;
  const onDeleteCard = publicReadOnly ? undefined : props.onDeleteCard;
  const onAddRow = publicReadOnly ? undefined : props.onAddRow;
  const { t } = useLanguage();
  const config = widget.config;
  const rawGroupBy = config.group_by_column || config.statusColumn || 'status';
  // Fallback: if default column doesn't exist in columnsInfo, try alternatives
  const defaultGroupBy = useMemo(() => {
    if (columnsInfo.some(c => c.name === rawGroupBy)) return rawGroupBy;
    if (rawGroupBy === 'status' && columnsInfo.some(c => c.name === 'state')) return 'state';
    // Last resort: first column with relation or select type
    const firstGroupable = columnsInfo.find(c =>
      c.type === 'select' || c.config?.relation?.enabled || c.config?.relatedTableId
    );
    return firstGroupable?.name || rawGroupBy;
  }, [rawGroupBy, columnsInfo]);
  const cardTitleColumnRaw = config.card_title_column || config.titleColumn || '';
  const cardTitleColumn = cardTitleColumnRaw || 'title';
  const cardSubtitleColumn = config.card_subtitle_column || config.descriptionColumn;

  // Date columns from config (fallback to props, then auto-detect from columnsInfo)
  const [autoStartDateCol, autoEndDateCol] = useMemo(() => {
    const dateCols = columnsInfo.filter(c => c.type === 'date' || c.type === 'datetime');
    const endNames = ['due_date', 'deadline', 'duedate', 'due', 'end_date'];
    const startNames = ['scheduled_date', 'start_date', 'startdate', 'scheduled', 'date'];
    const endCol = dateCols.find(c => endNames.includes(c.name.toLowerCase()))?.name
      || dateCols.find(c => c.name.toLowerCase().includes('due') || c.name.toLowerCase().includes('deadline'))?.name;
    const startCol = dateCols.find(c => startNames.includes(c.name.toLowerCase()))?.name
      || dateCols.find(c => c.name !== endCol && (c.name.toLowerCase().includes('start') || c.name.toLowerCase().includes('scheduled') || c.name.toLowerCase().includes('date')))?.name;
    return [startCol, endCol || dateCols.find(c => c.name !== startCol)?.name];
  }, [columnsInfo]);
  const startDateCol = scheduledDateColumn || config.kanban?.scheduledDateColumn || autoStartDateCol;
  const endDateCol = dueDateColumn || config.kanban?.dueDateColumn || autoEndDateCol;

  // Color & emoji columns from config
  const colorCol = config.kanban?.colorColumn;
  const emojiCol = config.kanban?.emojiColumn || config.emojiColumn;

  // Division override: user can switch grouping column at runtime
  const [groupByOverride, setGroupByOverride] = useState<string | null>(null);
  const groupByColumn = groupByOverride || defaultGroupBy;

  // Columns that can be used as division (select/relation types)
  const divisionColumns = useMemo(() => {
    return columnsInfo.filter(c =>
      c.type === 'select' || c.type === 'multi-select' ||
      c.config?.relation?.enabled || c.config?.relatedTableId
    );
  }, [columnsInfo]);

  // Column order state (for drag reordering)
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null);

  // Expanded cards state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // @dnd-kit: active dragged card id
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);

  // @dnd-kit sensors — under public read-only we still register them (hooks
  // can't be conditional) but the drag-end handler bails out anyway since
  // `onMoveCard` is undefined. The MouseSensor activationConstraint of 10px
  // means a click never starts a drag, so the visual disturbance is minimal.
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: publicReadOnly ? 100_000 : 10 }
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: publicReadOnly ? 100_000 : 200, tolerance: 5 }
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  const toggleCardExpanded = (cardId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Date filter
  const [dateSortColumn, setDateSortColumn] = useState<string | null>(null);
  const [dateSortDirection, setDateSortDirection] = useState<'asc' | 'desc'>('desc');
  const [dateFilterFrom, setDateFilterFrom] = useState<string>('');
  const [dateFilterTo, setDateFilterTo] = useState<string>('');

  // Sub-grouping inside columns
  const [subGroupColumn, setSubGroupColumn] = useState<string | null>(null);

  // ADR-0034 P0 — shared lane resolver. `drop` mode preserves Kanban's
  // legacy behaviour: rows whose value is missing from option/relation
  // metadata simply don't render (allColumns drives what's shown).
  const groupByColumnInfo = useMemo(
    () => columnsInfo.find((c) => c.name === groupByColumn),
    [columnsInfo, groupByColumn],
  );
  const laneAxis = useLaneAxis<KanbanCardData>({
    groupByColumn: groupByColumnInfo ?? groupByColumn,
    columnsInfo,
    rows: data || [],
    relationData,
    unmatchedRowMode: 'drop',
  });

  // Group data by active groupBy column, with optional sorting
  const groups = useMemo(() => {
    const grouped: Record<string, KanbanCardData[]> = {};
    laneAxis.rowsByLane.forEach((items, key) => {
      grouped[key] = items.slice();
    });

    // Apply sorting within each group
    if (sortColumn) {
      Object.values(grouped).forEach(items => {
        items.sort((a, b) => {
          const aVal = a.data?.[sortColumn];
          const bVal = b.data?.[sortColumn];
          const aStr = String(aVal || '');
          const bStr = String(bVal || '');
          const cmp = aStr.localeCompare(bStr, undefined, { numeric: true });
          return sortDirection === 'desc' ? -cmp : cmp;
        });
      });
    }

    // Helper: get date value from row
    const getDateValue = (row: KanbanCardData, col: string): string => {
      if ((col === 'created_at' || col === 'updated_at') && (row as Record<string, unknown>)[col]) {
        return String((row as Record<string, unknown>)[col]);
      }
      return (row.data?.[col] as string) || '';
    };

    // Apply date range filter
    if (dateSortColumn && (dateFilterFrom || dateFilterTo)) {
      const fromTime = dateFilterFrom ? new Date(dateFilterFrom).getTime() : -Infinity;
      const toTime = dateFilterTo ? new Date(dateFilterTo).getTime() : Infinity;
      Object.keys(grouped).forEach(key => {
        grouped[key] = grouped[key].filter(row => {
          const val = getDateValue(row, dateSortColumn);
          if (!val) return false;
          const t = new Date(val).getTime();
          return t >= fromTime && t <= toTime;
        });
      });
    }

    // Apply date sorting
    if (dateSortColumn) {
      Object.values(grouped).forEach(items => {
        items.sort((a, b) => {
          const aVal = getDateValue(a, dateSortColumn);
          const bVal = getDateValue(b, dateSortColumn);
          const aTime = aVal ? new Date(aVal).getTime() : 0;
          const bTime = bVal ? new Date(bVal).getTime() : 0;
          const cmp = aTime - bTime;
          return dateSortDirection === 'desc' ? -cmp : cmp;
        });
      });
    }

    return grouped;
  }, [laneAxis, sortColumn, sortDirection, dateSortColumn, dateSortDirection, dateFilterFrom, dateFilterTo]);

  // Find the active card for DragOverlay
  const activeCard = useMemo(() => {
    if (!activeId) return null;
    for (const column of Object.values(groups)) {
      const card = column.find((item: KanbanCardData) => String(item.id) === activeId);
      if (card) return card;
    }
    return null;
  }, [activeId, groups]);

  // Lane list rendered by the board.
  //  - When the user hasn't picked a groupBy override and the parent
  //    pre-computed `columnOptions`, prefer that (it already respects
  //    server-side ordering / per-space overrides).
  //  - Otherwise drive the columns straight off the shared lane axis.
  const allColumns: Array<{ value: string; label: string; color?: string }> = useMemo(() => {
    if (!groupByOverride && columnOptions && columnOptions.length > 0) {
      return columnOptions.map((opt) => ({ value: opt.value, label: opt.label, color: opt.color }));
    }
    return laneAxis.lanes.map((lane) => ({ value: lane.key, label: lane.label, color: lane.color }));
  }, [groupByOverride, columnOptions, laneAxis]);

  // Filter columns based on active status filters
  const filteredColumns = !groupByOverride && activeStatusFilters && activeStatusFilters.length > 0
    ? allColumns.filter(col => activeStatusFilters.includes(col.value))
    : allColumns;

  // Apply custom column order
  const visibleKanbanColumns = useMemo(() => {
    if (!columnOrder) return filteredColumns;
    const ordered: typeof filteredColumns = [];
    columnOrder.forEach(val => {
      const col = filteredColumns.find(c => c.value === val);
      if (col) ordered.push(col);
    });
    filteredColumns.forEach(col => {
      if (!ordered.find(c => c.value === col.value)) ordered.push(col);
    });
    return ordered;
  }, [filteredColumns, columnOrder]);

  // Memoized translations
  const cardTranslations = useMemo(() => ({
    openFull: t('kanban.openFull'),
    comments: t('kanban.comments'),
    chat: t('kanban.chat'),
    attachToMessage: t('kanban.attachToMessage'),
    description: t('kanban.description'),
    save: t('common.save'),
    cancel: t('common.cancel'),
    noDescription: t('kanban.noDescription'),
    moreFields: t('kanban.moreFields'),
    open: t('common.open'),
    noRecords: t('kanban.noRecords'),
    dropHere: t('kanban.dropHere'),
    add: t('common.add'),
  }), [t]);

  // Show empty state only if no data AND no column options
  if ((!data || data.length === 0) && visibleKanbanColumns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] p-8">
        <Columns3 className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg font-medium mb-2">{t('kanban.noData')}</p>
        <p className="text-sm">{t('kanban.addRecords')}</p>
      </div>
    );
  }

  const handleDndDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(String(active.id));
    for (const [columnValue, items] of Object.entries(groups)) {
      if (items.some((item: KanbanCardData) => String(item.id) === String(active.id))) {
        setActiveColumnId(columnValue);
        break;
      }
    }
  };

  const handleDndDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveColumnId(null);

    if (!over) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    if (activeIdStr.startsWith('col-') && overIdStr.startsWith('col-')) {
      const fromVal = activeIdStr.replace('col-', '');
      const toVal = overIdStr.replace('col-', '');
      if (fromVal !== toVal) {
        const currentOrder = visibleKanbanColumns.map(c => c.value);
        const fromIndex = currentOrder.indexOf(fromVal);
        const toIndex = currentOrder.indexOf(toVal);
        if (fromIndex !== -1 && toIndex !== -1) {
          setColumnOrder(arrayMove(currentOrder, fromIndex, toIndex));
        }
      }
      return;
    }

    const toColumn = overIdStr;
    const cardId = activeIdStr;

    let fromColumn: string | null = null;
    for (const [columnValue, items] of Object.entries(groups)) {
      if (items.some((item: KanbanCardData) => String(item.id) === cardId)) {
        fromColumn = columnValue;
        break;
      }
    }

    if (fromColumn && fromColumn !== toColumn && onMoveCard) {
      logger.debug('Moving card', { cardId, fromColumn, toColumn });
      onMoveCard(cardId, toColumn);
    }
  };

  const handleQuickEdit = (cardId: string, field: string, value: FieldValue) => {
    if (onCardUpdate) {
      onCardUpdate(cardId, field, value);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDndDragStart}
      onDragEnd={handleDndDragEnd}
    >
      <div className="flex flex-col h-full">
        {/* ═══ INTEGRATED KANBAN TOOLBAR ═══ */}
        {showToolbar && <KanbanToolbar
          data={data || []}
          columnsInfo={columnsInfo}
          relationData={relationData}
          widget={widget}
          tableId={tableId}
          filterState={filterState}
          onAddRow={onAddRow}
          onAddCard={onAddCard}
          onAddColumn={onAddColumn}
          onAddStatusRow={onAddStatusRow}
          groupRelationTableId={groupRelationTableId}
          onRefresh={onRefresh}
          onPrint={onPrint}
          onSettings={onSettings}
          groupByColumn={groupByColumn}
          defaultGroupBy={defaultGroupBy}
          divisionColumns={divisionColumns}
          groupByOverride={groupByOverride}
          setGroupByOverride={setGroupByOverride}
          setColumnOrder={setColumnOrder}
          sortColumn={sortColumn}
          setSortColumn={setSortColumn}
          sortDirection={sortDirection}
          setSortDirection={setSortDirection}
          dateSortColumn={dateSortColumn}
          setDateSortColumn={setDateSortColumn}
          dateSortDirection={dateSortDirection}
          setDateSortDirection={setDateSortDirection}
          dateFilterFrom={dateFilterFrom}
          setDateFilterFrom={setDateFilterFrom}
          dateFilterTo={dateFilterTo}
          setDateFilterTo={setDateFilterTo}
          subGroupColumn={subGroupColumn}
          setSubGroupColumn={setSubGroupColumn}
        />}

        {/* Kanban columns */}
        <div className="flex gap-2 flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-2 py-2 border-x border-b border-[var(--border-primary)] rounded-b-2xl" style={{ scrollbarWidth: 'thin' }}>
        <SortableContext items={visibleKanbanColumns.map(c => `col-${c.value}`)} strategy={horizontalListSortingStrategy}>
        {visibleKanbanColumns.map((column, colIndex) => {
          const columnValue = column.value;
          const columnLabel = column.label;
          const columnItems = groups[columnValue] || [];

          const colWithColor = allColumns.find(c => c.value === columnValue);
          const columnColor = colWithColor?.color || columnOptions?.find(opt => opt.value === columnValue)?.color || DEFAULT_LANE_COLORS[colIndex % DEFAULT_LANE_COLORS.length];

          const columnStyles = {
            backgroundColor: hexToRgba(columnColor, 0.1),
            borderColor: hexToRgba(columnColor, 0.3),
          };

          const badgeStyles = {
            backgroundColor: hexToRgba(columnColor, 0.2),
            color: columnColor,
          };

          return (
            <KanbanDroppableColumn
              key={columnValue}
              columnValue={columnValue}
              columnLabel={columnLabel}
              columnItems={columnItems}
              columnColor={columnColor}
              badgeStyles={badgeStyles}
              columnStyles={columnStyles}
              colIndex={colIndex}
              activeColumnId={activeColumnId}
              expandedCards={expandedCards}
              activeId={activeId}
              cardTitleColumn={cardTitleColumn}
              cardSubtitleColumn={cardSubtitleColumn}
              startDateCol={startDateCol}
              endDateCol={endDateCol}
              colorCol={colorCol}
              emojiCol={emojiCol}
              groupByColumn={groupByColumn}
              cardColumns={cardColumns}
              visibleColumns={visibleColumns}
              columnsInfo={columnsInfo}
              relationData={relationData}
              onToggleCardExpanded={toggleCardExpanded}
              onCardDoubleClick={onCardDoubleClick}
              onOpenRowChat={onOpenRowChat}
              onAttachRowToMessage={onAttachRowToMessage}
              onQuickEdit={handleQuickEdit}
              onDeleteCard={onDeleteCard}
              onAddCard={onAddCard}
              subGroupColumn={subGroupColumn}
              translations={cardTranslations}
            />
          );
        })}

        </SortableContext>
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeCard ? (
          <div className="opacity-90 shadow-2xl rotate-2">
            <ExpandableCard
              item={activeCard}
              cardTitleColumn={cardTitleColumn}
              cardSubtitleColumn={cardSubtitleColumn}
              scheduledDateColumn={startDateCol}
              dueDateColumn={endDateCol}
              colorColumn={colorCol}
              emojiColumn={emojiCol}
              groupColumn={groupByColumn}
              cardColumns={cardColumns}
              visibleColumns={visibleColumns}
              columnsInfo={columnsInfo}
              relationData={relationData}
              isExpanded={false}
              onToggleExpand={() => {}}
              onDoubleClick={() => {}}
              onOpenComments={() => {}}
              onQuickEdit={() => {}}
              isDragging={false}
              translations={cardTranslations}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
