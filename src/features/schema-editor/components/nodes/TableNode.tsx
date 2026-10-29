import { memo, useCallback, useRef, useEffect, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { Handle, Position, useStore as useReactFlowStore, type ReactFlowState } from '@xyflow/react';
import { DndContext, closestCenter, pointerWithin, PointerSensor, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Plus, Eye, Pencil, ArrowRightLeft, Trash2, Settings, PlusCircle, Pin, PinOff } from 'lucide-react';
import type { TableNodeData, ColumnData } from '../../types/schema-editor.types';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { ColumnType } from '@/shared/types';
import { ColumnSettingsDrawer } from '@/features/tables/components/UniversalTable/ColumnSettingsDrawer';
import { CreateColumnModal } from '@/features/tables/components/modals/CreateColumnModal';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import { EditTableModal } from '@/features/tables/components/EditTableModal';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { ColumnModel, ColumnConfig } from '@/features/tables/types/table.types';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { ColumnRow, hasRelationConfig, hasInverseRelationConfig, COLUMN_ACTION_EVENT, type ColumnActionDetail } from './TableNodeColumnRow';
import { TableWidgetStrips } from './TableWidgetStrips';

// Convert ColumnData to ColumnModel for settings drawer
const convertToColumnModel = (column: ColumnData, tableId: number): ColumnModel => {
  return {
    id: column.id,
    tableId: String(tableId),
    name: column.name,
    displayName: column.displayName || column.name,
    type: column.type as ColumnType,
    config: (column.config || {}) as ColumnConfig,
    isRequired: column.isRequired || false,
    isReadonly: false,
    orderIndex: 0,
    width: 150,
    isVisible: true,
    is_primary_key: column.isPrimaryKey,
  };
};

interface TableNodeComponentProps {
  data: TableNodeData;
  selected?: boolean;
}

const zoomSelector = (state: ReactFlowState) => state.transform[2];

// Pointer and row rects are both in screen pixels, so the drop target stays right at any canvas zoom
// (the dragged rect is in unzoomed node pixels and would drift); closestCenter only covers the gaps.
const pointerFirstCollision: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

// The virtual `id` row is pinned first and has no table_columns record to reorder.
const isReorderable = (column: ColumnData) => !column.isPrimaryKey;

type ColumnInsertAt = { column: ColumnData; side: 'above' | 'below' };

export const TableNode = memo(({ data, selected }: TableNodeComponentProps) => {
  const {
    tableId,
    displayName,
    name,
    key,
    icon,
    color,
    columns,
    isExternal,
    isSystem,
    syncTarget,
    sourceSpaceName,
    rowsPreview,
    rowsLoading,
    rowCount,
    projectId,
    spaceId,
    isPinned,
    widgets,
  } = data;

  const { selectedColumnKey, selectColumn, pendingConnections, loadTableRows, updateTableColor, refreshSchema, setTableColumns, spaceId: schemaSpaceId, toggleTableSelection, toggleTablePinned, showWidgets } = useSchemaEditorStore();
  const { t } = useLanguage();
  // dnd-kit measures in screen pixels while the node is drawn inside the zoomed canvas:
  // divide both the dragged row and the shifted neighbours by the zoom so they track the pointer.
  const zoom = useReactFlowStore(zoomSelector);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const unzoomDrag = useCallback<Modifier>(({ transform }) => ({ ...transform, x: transform.x / zoom, y: transform.y / zoom }), [zoom]);
  const unzoomedStrategy = useCallback<SortingStrategy>((args) => {
    const shift = verticalListSortingStrategy(args);
    return shift && { ...shift, x: shift.x / zoom, y: shift.y / zoom };
  }, [zoom]);
  const navigate = useNavigate();
  const [showTableMenu, setShowTableMenu] = useState(false);
  const tableMenuRef = useRef<HTMLDivElement | null>(null);
  const tableMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [showEditTableModal, setShowEditTableModal] = useState(false);
  const [showCreateColumnModal, setShowCreateColumnModal] = useState(false);
  // Where the next created column goes; null appends (footer button).
  const [columnInsertAt, setColumnInsertAt] = useState<ColumnInsertAt | null>(null);
  const [settingsColumn, setSettingsColumn] = useState<ColumnData | null>(null);

  const handleColumnSelect = useCallback((columnName: string) => {
    selectColumn(tableId, columnName);
  }, [tableId, selectColumn]);

  const isColumnSelected = (columnName: string) => {
    return selectedColumnKey === `${tableId}:${columnName}`;
  };
  
  // Check if column is part of a pending connection
  const isPendingConnected = useCallback((columnName: string) => {
    return pendingConnections.some(pc => 
      (pc.sourceTableId === tableId && pc.sourceColumn === columnName) ||
      (pc.targetTableId === tableId && pc.targetColumn === columnName)
    );
  }, [pendingConnections, tableId]);

  const handleOpenSettings = useCallback((column: ColumnData) => {
    setSettingsColumn(column);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsColumn(null);
  }, []);

  const handleSaveColumnSettings = useCallback(async (columnId: string, payload: Partial<ColumnModel>) => {
    // Закрываем модалку сразу, чтобы не зависала после сохранения
    setSettingsColumn(null);
    try {
      await tablesApi.updateColumn(String(tableId), columnId, payload);
      if (schemaSpaceId) {
        await refreshSchema();
      }
    } catch (error) {
      logger.error('Failed to save column settings:', error);
      alert('Не удалось сохранить колонку. Проверьте права или данные.');
    }
  }, [refreshSchema, schemaSpaceId, tableId]);

  const handleChangeType = useCallback(async (column: ColumnData, newType: string) => {
    // Закрываем модалку, чтобы обновление типов не держало её открытой
    setSettingsColumn(null);
    try {
      await tablesApi.updateColumn(String(tableId), column.id, { type: newType as ColumnType });
      if (schemaSpaceId) {
        await refreshSchema();
      }
    } catch (error) {
      logger.error('Failed to change column type:', error);
      alert('Не удалось изменить тип колонки.');
    }
  }, [refreshSchema, schemaSpaceId, tableId]);

  const handleLoadRows = useCallback(() => {
    loadTableRows(tableId);
  }, [tableId, loadTableRows]);

  // Optimistic column edits: update the node first, PATCH after; a failed request resyncs from the server.
  const resyncAfterFailure = useCallback(async (message: string, error: unknown) => {
    logger.error(message, error);
    alert(message);
    await refreshSchema();
  }, [refreshSchema]);

  const persistColumnOrder = useCallback(async (ordered: ColumnData[]) => {
    const renumbered = ordered.map((column, orderIndex) => ({ ...column, orderIndex }));
    setTableColumns(tableId, [...columns.filter((column) => !isReorderable(column)), ...renumbered]);
    const results = await Promise.allSettled(
      ordered.map((column, orderIndex) => column.orderIndex === orderIndex
        ? Promise.resolve()
        : tablesApi.updateColumn(String(tableId), column.id, { orderIndex }))
    );
    if (results.some((result) => result.status === 'rejected')) {
      await resyncAfterFailure('Не удалось сохранить порядок колонок.', results);
    }
  }, [columns, tableId, setTableColumns, resyncAfterFailure]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const reorderable = columns.filter(isReorderable);
    const from = reorderable.findIndex((column) => column.id === active.id);
    const to = reorderable.findIndex((column) => column.id === over.id);
    if (from === -1 || to === -1) return;
    void persistColumnOrder(arrayMove(reorderable, from, to));
  }, [columns, persistColumnOrder]);

  const handleMoveColumn = useCallback((column: ColumnData, direction: -1 | 1) => {
    const reorderable = columns.filter(isReorderable);
    const from = reorderable.indexOf(column);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= reorderable.length) return;
    void persistColumnOrder(arrayMove(reorderable, from, to));
  }, [columns, persistColumnOrder]);

  const patchColumn = useCallback(async (column: ColumnData, patch: Pick<ColumnData, 'isVisible'> | Pick<ColumnData, 'isReadonly'>) => {
    setTableColumns(tableId, columns.map((c) => (c.id === column.id ? { ...c, ...patch } : c)));
    try {
      await tablesApi.updateColumn(String(tableId), column.id, patch);
    } catch (error) {
      await resyncAfterFailure('Не удалось обновить колонку. Проверьте права или данные.', error);
    }
  }, [columns, tableId, setTableColumns, resyncAfterFailure]);

  const handleToggleVisibility = useCallback((column: ColumnData) => {
    void patchColumn(column, { isVisible: column.isVisible === false });
  }, [patchColumn]);

  const handleToggleReadonly = useCallback((column: ColumnData) => {
    void patchColumn(column, { isReadonly: !column.isReadonly });
  }, [patchColumn]);

  const handleDeleteColumn = useCallback(async (column: ColumnData) => {
    if (!window.confirm(t('columnHeader.deleteConfirm', { column: column.displayName || column.name }))) return;
    try {
      await tablesApi.deleteColumn(String(tableId), column.id);
      await refreshSchema(); // edges to the deleted column are rebuilt from the server
    } catch (error) {
      await resyncAfterFailure('Не удалось удалить колонку. Проверьте права или данные.', error);
    }
  }, [tableId, t, refreshSchema, resyncAfterFailure]);

  const handleAddColumn = useCallback((anchor: ColumnInsertAt | null = null) => {
    setColumnInsertAt(anchor);
    setShowCreateColumnModal(true);
  }, []);

  // Create appends; the real columns are then renumbered around the anchor (same flow as the universal table).
  const placeCreatedColumn = useCallback(async (createdId: string, { column, side }: ColumnInsertAt) => {
    const reorderable = columns.filter(isReorderable);
    const anchor = reorderable.findIndex((c) => c.id === column.id);
    if (anchor === -1) return;
    const ids = reorderable.map((c) => c.id);
    ids.splice(anchor + (side === 'below' ? 1 : 0), 0, createdId);
    const results = await Promise.allSettled(ids.map((id, orderIndex) =>
      reorderable.find((c) => c.id === id)?.orderIndex === orderIndex
        ? Promise.resolve()
        : tablesApi.updateColumn(String(tableId), id, { orderIndex })));
    if (results.some((result) => result.status === 'rejected')) {
      await resyncAfterFailure('Колонка создана, но её позиция не сохранена. Переместите её через меню.', results);
    }
  }, [columns, tableId, resyncAfterFailure]);

  const handleTableMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowTableMenu(!showTableMenu);
  };

  const handleMenuAction = (action: string) => {
    logger.debug('Table menu action:', action, 'for table:', tableId);
    setShowTableMenu(false);
    if (action === 'addRow') {
      setShowAddRowModal(true);
    } else if (action === 'view') {
      // Open in new window
      window.open(`/tables/${tableId}`, '_blank');
    } else if (action === 'edit') {
      setShowEditTableModal(true);
    } else if (action === 'formSettings' && isSystem && name.startsWith('form_')) {
      // Extract parent table ID and navigate to it with form-settings query param
      const parentTableId = name.replace('form_', '');
      window.open(`/tables/${parentTableId}?openFormSettings=true`, '_blank');
    } else if (action === 'move') {
      window.dispatchEvent(new CustomEvent('schema-editor:move-table', { detail: { tableId } }));
    } else if (action === 'togglePin') {
      toggleTablePinned(tableId);
    } else if (action === 'delete') {
      window.dispatchEvent(new CustomEvent('schema-editor:delete-table', { detail: { tableId } }));
    }
  };

  useEffect(() => {
    if (!showTableMenu) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (tableMenuRef.current?.contains(target) || tableMenuButtonRef.current?.contains(target)) {
        return;
      }
      setShowTableMenu(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showTableMenu]);

  useEffect(() => {
    const handleAddRow = (event: Event) => {
      const detail = (event as CustomEvent<{ tableId?: number }>).detail;
      if (detail?.tableId !== tableId) return;
      setShowAddRowModal(true);
    };
    const handleEditTable = (event: Event) => {
      const detail = (event as CustomEvent<{ tableId?: number }>).detail;
      if (detail?.tableId !== tableId) return;
      setShowEditTableModal(true);
    };

    window.addEventListener('schema-editor:add-row', handleAddRow as EventListener);
    window.addEventListener('schema-editor:edit-table', handleEditTable as EventListener);
    return () => {
      window.removeEventListener('schema-editor:add-row', handleAddRow as EventListener);
      window.removeEventListener('schema-editor:edit-table', handleEditTable as EventListener);
    };
  }, [tableId]);

  // The nav tree column rows reuse this node's column handlers (settings drawer, patches, create modal)
  // through one event, so both surfaces behave identically. Requires the node to be mounted (visible).
  useEffect(() => {
    const handleColumnAction = (event: Event) => {
      const detail = (event as CustomEvent<ColumnActionDetail>).detail;
      if (detail?.tableId !== tableId) return;
      const column = columns.find((c) => c.id === detail.columnId);
      if (!column) return;
      switch (detail.action) {
        case 'settings': handleOpenSettings(column); break;
        case 'visibility': handleToggleVisibility(column); break;
        case 'readonly': handleToggleReadonly(column); break;
        case 'moveUp': handleMoveColumn(column, -1); break;
        case 'moveDown': handleMoveColumn(column, 1); break;
        case 'addAbove': handleAddColumn({ column, side: 'above' }); break;
        case 'addBelow': handleAddColumn({ column, side: 'below' }); break;
        case 'delete': void handleDeleteColumn(column); break;
      }
    };
    window.addEventListener(COLUMN_ACTION_EVENT, handleColumnAction as EventListener);
    return () => window.removeEventListener(COLUMN_ACTION_EVENT, handleColumnAction as EventListener);
  }, [tableId, columns, handleOpenSettings, handleToggleVisibility, handleToggleReadonly, handleMoveColumn, handleAddColumn, handleDeleteColumn]);

  const reorderableIds = columns.filter(isReorderable).map((column) => column.id);
  const firstReorderableIndex = columns.findIndex(isReorderable);

  const borderClasses = isSystem
    ? 'border-orange-500/50'
    : isExternal
      ? 'border-amber-500/50'
      : 'border-[var(--border-primary)]';
  const selectedOutlineClasses = selected
    ? 'outline outline-2 outline-[var(--accent-primary)] outline-offset-1 shadow-[var(--accent-primary)]/20'
    : '';
  // `relative z-10`: the card paints over the module strips tucked behind its top edge.
  const containerClasses = `relative z-10 min-w-[320px] max-w-[400px] rounded-xl border-2 shadow-lg bg-[var(--bg-primary)] transition-all duration-200 overflow-hidden ${borderClasses} ${selectedOutlineClasses}`;

  // Header background: use table color if available, or special colors for system/external
  const headerBg = color 
    ? `bg-[${color}]/10` 
    : isSystem 
    ? 'bg-orange-500/10' 
    : isExternal 
    ? 'bg-amber-500/10' 
    : 'bg-[var(--bg-secondary)]';

  const headerClasses = `flex items-center gap-2 px-3 py-2 rounded-t-md ${headerBg}`;

  return (
    <div className="relative">
      {/* Modules built on this table: strips glued above the card, hidden by the toolbar toggle */}
      {showWidgets && widgets && widgets.length > 0 && (
        <TableWidgetStrips widgets={widgets} openLabel={t('schemaEditor.navMenu.openWidget')} />
      )}
    <div className={containerClasses} data-testid={`schema-node-${tableId}`}>
      {/* System/Sync badge above header */}
      {(isSystem || syncTarget) && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-orange-500/20 text-orange-400 text-xs font-medium">
          <span>⚙️</span>
          <span>System{syncTarget ? ` • sync: ${syncTarget}` : ''}</span>
        </div>
      )}

      {/* Header */}
      <div 
        className={headerClasses}
        style={color ? { backgroundColor: `${color}10` } : undefined}
        title={`Table: ${displayName || name}\nKey: ${key || name}\nID: ${tableId}${isExternal && sourceSpaceName ? `\nSource: ${sourceSpaceName}` : ''}${isSystem ? '\nSystem Table' : ''}${syncTarget ? `\nSync: ${syncTarget}` : ''}`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleTableSelection(tableId);
          }}
          className="flex h-7 w-7 items-center justify-center rounded bg-transparent dark:bg-black/80 text-[13px] transition-all"
          title={selected ? t('common.deselect') : t('common.select')}
        >
          <span
            className={`flex h-full w-full items-center justify-center rounded ${
              selected
                ? 'border border-black shadow-[0_0_0_1px_rgba(0,0,0,0.6)] dark:border-white dark:shadow-[0_0_0_1px_rgba(255,255,255,0.6)]'
                : 'border border-transparent hover:border-black/30 dark:hover:border-white/30'
            }`}
          >
            {icon || '📋'}
          </span>
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">
            {displayName || name}
          </h3>
          <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
            <span className="font-mono text-[var(--accent-primary)]" title="Table ID">#{tableId}</span>
            <span>•</span>
            <span className="font-mono">{key || name}</span>
            {isExternal && sourceSpaceName && (
              <>
                <span>•</span>
                <span className="text-amber-400">📤 {sourceSpaceName}</span>
              </>
            )}
          </div>
        </div>
        
        {/* Settings icon for form tables, Color Picker for non-system tables */}
        {isSystem && name.startsWith('form_') ? (
          <button
            onClick={(e) => { e.stopPropagation(); handleMenuAction('formSettings'); }}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-orange-400 transition-colors"
            title={t('schemaEditor.formSettings')}
          >
            <Settings className="w-4 h-4" />
          </button>
        ) : !isSystem && (
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
              className="w-5 h-5 rounded-full border-2 border-[var(--border-primary)] hover:border-[var(--accent-primary)] transition-colors flex-shrink-0"
              style={{ backgroundColor: color || '#6b7280' }}
              title={t('schemaEditor.changeColor')}
            />
            
            {showColorPicker && (
              <div className="absolute right-0 top-full mt-1 z-[100] p-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl">
                <div className="flex flex-wrap gap-1 w-[120px]">
                  {[
                    null,
                    '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
                    '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
                  ].map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateTableColor(tableId, c);
                        setShowColorPicker(false);
                      }}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${
                        color === c 
                          ? 'border-white ring-2 ring-[var(--accent-primary)]' 
                          : 'border-transparent hover:border-white/50'
                      }`}
                      style={{ 
                        backgroundColor: c || '#6b7280',
                      }}
                      title={c || 'Default'}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isPinned && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleMenuAction('togglePin'); }}
            className="flex h-6 w-4 flex-shrink-0 items-center justify-center rounded text-[var(--accent-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title={t('schemaEditor.tableMenu.unpin')}
            aria-label={t('schemaEditor.tableMenu.unpin')}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
        )}

        <div className="relative">
          <button
            ref={tableMenuButtonRef}
            onClick={handleTableMenuClick}
            className="flex h-6 w-4 flex-shrink-0 items-center justify-center rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="Table options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {/* Table Menu Dropdown */}
          {showTableMenu && (
            <div
              ref={tableMenuRef}
              className="absolute right-0 top-full mt-1 z-[100] w-40 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl overflow-hidden"
            >
              <button
                onClick={(e) => { e.stopPropagation(); handleMenuAction('addRow'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.addRow')}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleMenuAction('view'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.view')}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleMenuAction('edit'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.edit')}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleMenuAction('move'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.move')}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleMenuAction('togglePin'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                <span>{t(isPinned ? 'schemaEditor.tableMenu.unpin' : 'schemaEditor.tableMenu.pin')}</span>
              </button>
              <div className="border-t border-[var(--border-primary)]" />
              <button
                onClick={(e) => { e.stopPropagation(); handleMenuAction('delete'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-red-500/10 text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.delete')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Columns list - no scroll, show all; the emoji of each real column is a sortable drag handle */}
      <div className="relative">
        <DndContext sensors={sensors} collisionDetection={pointerFirstCollision} modifiers={[restrictToVerticalAxis, unzoomDrag]} autoScroll={false} onDragEnd={handleDragEnd}>
          <SortableContext items={reorderableIds} strategy={unzoomedStrategy}>
            {columns.map((column, index) => {
              // Determine link type for coloring
              const linkType: 'none' | 'relation' | 'inverse' =
                hasRelationConfig(column) ? 'relation' :
                hasInverseRelationConfig(column) ? 'inverse' : 'none';
              const reorderable = isReorderable(column);
              const canDelete = reorderable && !column.isLocked && !column.isFromSource;

              return (
                <ColumnRow
                  key={column.id}
                  column={column}
                  tableId={tableId}
                  isSelected={isColumnSelected(column.name)}
                  linkType={linkType}
                  isPendingConnected={isPendingConnected(column.name)}
                  rowsPreview={rowsPreview}
                  rowsLoading={rowsLoading}
                  canReorder={reorderable}
                  onSelect={() => handleColumnSelect(column.name)}
                  onOpenSettings={handleOpenSettings}
                  onChangeType={handleChangeType}
                  onLoadRows={handleLoadRows}
                  onToggleVisibility={reorderable ? handleToggleVisibility : undefined}
                  onMoveUp={reorderable && index > firstReorderableIndex ? () => handleMoveColumn(column, -1) : undefined}
                  onMoveDown={reorderable && index < columns.length - 1 ? () => handleMoveColumn(column, 1) : undefined}
                  onAddColumn={reorderable ? (side) => handleAddColumn({ column, side }) : undefined}
                  onToggleReadonly={reorderable ? handleToggleReadonly : undefined}
                  onDelete={canDelete ? handleDeleteColumn : undefined}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/50 rounded-b-lg">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAddColumn();
          }}
          className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('schemaEditor.addColumn')}</span>
        </button>
        {rowCount !== undefined && (
          <span className="text-xs font-mono tabular-nums text-[var(--text-tertiary)]" title={t('schemaEditor.rowsCount', { count: rowCount })}>
            {t('schemaEditor.rowsCount', { count: rowCount.toLocaleString() })}
          </span>
        )}
      </div>

      {/* Per-column source/target handles live inside each ColumnRow (anchored to the real row). */}

      {/* Fallback center source handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="source-table-center"
        className="!w-0 !h-0 !bg-transparent !border-0"
        style={{ top: '50%' }}
      />
      
      {/* Fallback center target handle for connections to non-visible columns */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-table-center"
        className="!w-0 !h-0 !bg-transparent !border-0"
        style={{ top: '50%' }}
      />

      {/* Form table handles - for system form connections */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="form-source"
        className="!w-0 !h-0 !bg-transparent !border-0"
        style={{ left: '50%' }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="form-target"
        className="!w-0 !h-0 !bg-transparent !border-0"
        style={{ left: '50%' }}
      />
      
      {/* Widget connection handle - hidden, for incoming edge from widget */}
      <Handle
        type="target"
        position={Position.Top}
        id="table-top"
        className="!w-0 !h-0 !bg-transparent !border-0"
        style={{ left: '50%' }}
      />

      {/* Column Settings Modal */}
      {settingsColumn && (
        <ColumnSettingsDrawer
          column={convertToColumnModel(settingsColumn, tableId)}
          open={!!settingsColumn}
          onOpenChange={(open) => !open && handleCloseSettings()}
          onSave={handleSaveColumnSettings}
          tableId={tableId}
          allColumns={columns.map(c => convertToColumnModel(c, tableId))}
          isExternalTable={isExternal}
        />
      )}

      {/* Add Row Modal */}
      {showAddRowModal && (
        <AddRowModal
          isOpen={showAddRowModal}
          onClose={() => setShowAddRowModal(false)}
          tableId={String(tableId)}
          columns={columns.map(c => convertToColumnModel(c, tableId))}
          onConfirm={(data) => {
            logger.debug('Add row:', data, 'to table:', tableId);
            // TODO: Implement row creation API call
            setShowAddRowModal(false);
            loadTableRows(tableId);
          }}
        />
      )}

      {/* Create Column Modal */}
      <CreateColumnModal
        open={showCreateColumnModal}
        onOpenChange={setShowCreateColumnModal}
        onSubmit={async (data) => {
          try {
            const created = await tablesApi.createColumn(String(tableId), {
              name: data.name,
              displayName: data.displayName,
              type: data.type,
              config: data.config || {}
            });
            setShowCreateColumnModal(false);
            if (columnInsertAt) {
              await placeCreatedColumn(String(created.id), columnInsertAt);
            }
            if (schemaSpaceId) {
              await refreshSchema();
            }
          } catch (error) {
            logger.error('Failed to create column:', error);
            alert('Не удалось создать колонку. Проверьте права или данные.');
          }
        }}
        tableId={tableId}
        projectId={projectId}
      />

      {/* Edit Table Modal */}
      <EditTableModal
        open={showEditTableModal}
        onOpenChange={setShowEditTableModal}
        tableId={tableId}
        projectId={projectId}
        spaceId={spaceId}
      />
    </div>
    </div>
  );
});

TableNode.displayName = 'TableNode';
