import { Plus } from 'lucide-react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { ExpandableCard } from './KanbanCard';
import type { KanbanDraggableCardProps, KanbanDroppableColumnProps, KanbanCardData, FieldValue } from './kanban-types';

// ═══════════════════════════════════════════════
// DraggableCard component (fixes React error #310)
// ═══════════════════════════════════════════════
export function KanbanDraggableCard({
  item, isExpanded, activeId,
  cardTitleColumn, cardSubtitleColumn, startDateCol, endDateCol,
  colorCol, emojiCol, groupByColumn, cardColumns, visibleColumns,
  columnsInfo, relationData,
  onToggleExpand, onDoubleClick, onOpenComments, onOpenChat,
  onAttachToMessage, onQuickEdit, onDelete, translations
}: KanbanDraggableCardProps) {
  const cardId = String(item.id);
  const { attributes, listeners, setNodeRef, transform, isDragging: isDnd } = useDraggable({
    id: cardId,
  });

  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: isDnd ? 1000 : undefined,
  } : undefined;

  return (
    <div ref={setNodeRef} style={style}>
      <ExpandableCard
        item={item}
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
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        onDoubleClick={onDoubleClick}
        onOpenComments={onOpenComments}
        onOpenChat={onOpenChat}
        onAttachToMessage={onAttachToMessage}
        onQuickEdit={onQuickEdit}
        onDelete={onDelete}
        isDragging={isDnd || activeId === cardId}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
        translations={translations}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════
// DroppableColumn component (fixes React error #310)
// ═══════════════════════════════════════════════
export function KanbanDroppableColumn({
  columnValue, columnLabel, columnItems, columnColor,
  badgeStyles, columnStyles, colIndex, activeColumnId,
  expandedCards, activeId, cardTitleColumn, cardSubtitleColumn,
  startDateCol, endDateCol, colorCol, emojiCol, groupByColumn,
  cardColumns, visibleColumns, columnsInfo, relationData,
  onToggleCardExpanded, onCardDoubleClick, onOpenRowChat,
  onAttachRowToMessage, onQuickEdit, onDeleteCard, onAddCard, subGroupColumn, translations
}: KanbanDroppableColumnProps) {
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: columnValue,
  });
  const {
    attributes: sortAttrs,
    listeners: sortListeners,
    setNodeRef: setSortRef,
    transform: sortTransform,
    transition: sortTransition,
    isDragging: isSortDragging,
  } = useSortable({
    id: `col-${columnValue}`,
  });

  const isDropTarget = isOver && activeColumnId !== columnValue;

  const sortStyle = {
    ...columnStyles,
    transform: CSS.Transform.toString(sortTransform),
    transition: sortTransition,
    opacity: isSortDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={(node) => { setDropRef(node); setSortRef(node); }}
      className={`flex-shrink-0 w-72 border rounded-xl p-2.5 flex flex-col transition-all duration-200 ${
        isDropTarget ? 'ring-2 ring-[var(--color-primary-500)] ring-offset-2 ring-offset-[var(--bg-primary)] scale-[1.02]' : ''
      }`}
      style={sortStyle}
    >
      {/* Column Header */}
      <div
        className="flex items-center justify-between mb-2 px-1 cursor-grab touch-none"
        {...sortAttrs}
        {...sortListeners}
      >
        <h4 className="font-semibold text-[var(--text-primary)] text-sm truncate">{columnLabel}</h4>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onAddCard && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAddCard?.(columnValue); }}
              onPointerDown={(e) => e.stopPropagation()}
              title={translations.add}
              aria-label={translations.add}
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={badgeStyles}
          >
            {columnItems.length}
          </span>
        </div>
      </div>

      {/* Cards Container */}
      <div className={`space-y-2 flex-1 overflow-y-auto min-h-[100px] rounded-lg transition-colors ${
        isDropTarget ? 'bg-[var(--color-primary-500)]/10' : ''
      }`} style={{ scrollbarWidth: 'thin', overflowY: 'overlay' as any }}>
        {(() => {
          // Build sub-groups if subGroupColumn is set
          if (subGroupColumn) {
            const subGroups: Record<string, KanbanCardData[]> = {};
            columnItems.forEach((item: KanbanCardData) => {
              const rawVal = (item as Record<string, any>)[subGroupColumn];
              const key = rawVal ? String(rawVal) : 'Без группы';
              if (!subGroups[key]) subGroups[key] = [];
              subGroups[key].push(item);
            });

            // Resolve labels for sub-group keys
            const subGroupColInfo = columnsInfo.find(c => c.name === subGroupColumn);
            const subGroupRelTableId = subGroupColInfo?.config?.relation?.enabled
              ? subGroupColInfo.config.relation.tableId
              : subGroupColInfo?.config?.relatedTableId;

            const resolveSubGroupLabel = (key: string): { label: string; color?: string } => {
              if (key === 'Без группы') return { label: 'Без группы' };
              if (subGroupRelTableId && relationData) {
                const tableMap = relationData.get(String(subGroupRelTableId));
                if (tableMap) {
                  const found = tableMap.get(key);
                  if (found) return found;
                }
              }
              if (subGroupColInfo?.config?.options) {
                const opt = subGroupColInfo.config.options.find(o => o.value === key);
                if (opt) return { label: opt.label, color: opt.color };
              }
              return { label: key };
            };

            return Object.entries(subGroups).map(([groupKey, groupItems]) => {
              const resolved = resolveSubGroupLabel(groupKey);
              return (
                <div key={groupKey} className="mb-2">
                  <div className="flex items-center gap-1.5 px-1 py-1 mb-1 rounded" style={resolved.color ? { backgroundColor: `${resolved.color}15` } : undefined}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={resolved.color ? { color: resolved.color } : { color: 'var(--text-tertiary)' }}>
                      {resolved.label}
                    </span>
                    <span className="text-[10px] opacity-50">({groupItems.length})</span>
                  </div>
                  {groupItems.map((item: KanbanCardData) => {
                    const cardId = String(item.id);
                    return (
                      <div key={cardId} className="mb-1.5">
                        <KanbanDraggableCard
                          item={item}
                          columnValue={columnValue}
                          isExpanded={expandedCards.has(cardId)}
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
                          onToggleExpand={() => onToggleCardExpanded(cardId)}
                          onDoubleClick={() => onCardDoubleClick?.(item, 'details')}
                          onOpenComments={() => onCardDoubleClick?.(item, 'comments')}
                          onOpenChat={onOpenRowChat ? () => onOpenRowChat(cardId) : undefined}
                          onAttachToMessage={onAttachRowToMessage ? () => onAttachRowToMessage(cardId) : undefined}
                          onQuickEdit={(field, value) => onQuickEdit(cardId, field, value)}
                          onDelete={onDeleteCard ? () => onDeleteCard(cardId) : undefined}
                          translations={translations}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            });
          }

          // Flat list (no sub-grouping)
          return columnItems.map((item: KanbanCardData) => {
            const cardId = String(item.id);
            return (
              <KanbanDraggableCard
                key={cardId}
                item={item}
                columnValue={columnValue}
                isExpanded={expandedCards.has(cardId)}
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
                onToggleExpand={() => onToggleCardExpanded(cardId)}
                onDoubleClick={() => onCardDoubleClick?.(item, 'details')}
                onOpenComments={() => onCardDoubleClick?.(item, 'comments')}
                onOpenChat={onOpenRowChat ? () => onOpenRowChat(cardId) : undefined}
                onAttachToMessage={onAttachRowToMessage ? () => onAttachRowToMessage(cardId) : undefined}
                onQuickEdit={(field, value) => onQuickEdit(cardId, field, value)}
                onDelete={onDeleteCard ? () => onDeleteCard(cardId) : undefined}
                translations={translations}
              />
            );
          });
        })()}

        {/* Empty column message */}
        {columnItems.length === 0 && !isDropTarget && (
          <div className="text-center text-sm text-[var(--text-tertiary)] py-4 opacity-60">
            {translations.noRecords}
          </div>
        )}

        {/* Drop placeholder when dragging */}
        {isDropTarget && (
          <div className="border-2 border-dashed border-[var(--color-primary-500)] rounded-lg p-4 text-center text-sm text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/5">
            {translations.dropHere}
          </div>
        )}
      </div>

    </div>
  );
}
