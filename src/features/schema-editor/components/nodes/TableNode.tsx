import { memo, useCallback, useRef, useEffect, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { Handle, Position } from '@xyflow/react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Plus, Eye, Pencil, ArrowRightLeft, Trash2, Settings, PlusCircle } from 'lucide-react';
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
import { ColumnRow, hasLinkConfig, hasRelationConfig, hasInverseRelationConfig } from './TableNodeColumnRow';

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
    projectId,
    spaceId,
  } = data;

  const { selectedColumnKey, selectColumn, pendingConnections, loadTableRows, updateTableColor, refreshSchema, spaceId: schemaSpaceId, toggleTableSelection } = useSchemaEditorStore();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [showTableMenu, setShowTableMenu] = useState(false);
  const tableMenuRef = useRef<HTMLDivElement | null>(null);
  const tableMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [showEditTableModal, setShowEditTableModal] = useState(false);
  const [showCreateColumnModal, setShowCreateColumnModal] = useState(false);
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

  // Keep positioning stable (fixed row heights) to avoid layout glitches
  const handlePositionUpdate = useCallback((_columnName: string, _top: number) => {}, []);

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

  // Get relation columns for handle positioning
  const relationColumns = columns.filter(hasLinkConfig);

  const borderClasses = isSystem
    ? 'border-orange-500/50'
    : isExternal
      ? 'border-amber-500/50'
      : 'border-[var(--border-primary)]';
  const selectedOutlineClasses = selected
    ? 'outline outline-2 outline-[var(--accent-primary)] outline-offset-1 shadow-[var(--accent-primary)]/20'
    : '';
  const containerClasses = `min-w-[320px] max-w-[400px] rounded-xl border-2 shadow-lg bg-[var(--bg-primary)] transition-all duration-200 overflow-hidden ${borderClasses} ${selectedOutlineClasses}`;

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
    <div className={containerClasses}>
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

        <div className="relative">
          <button
            ref={tableMenuButtonRef}
            onClick={handleTableMenuClick}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
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

      {/* Columns list - no scroll, show all */}
      <div className="relative">
        {columns.map((column) => {
          // Determine link type for coloring
          const linkType: 'none' | 'relation' | 'inverse' = 
            hasRelationConfig(column) ? 'relation' :
            hasInverseRelationConfig(column) ? 'inverse' : 'none';
          
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
              onSelect={() => handleColumnSelect(column.name)}
              onPositionUpdate={handlePositionUpdate}
              onOpenSettings={handleOpenSettings}
              onChangeType={handleChangeType}
              onLoadRows={handleLoadRows}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/50 rounded-b-lg">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setShowCreateColumnModal(true);
          }}
          className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('schemaEditor.addColumn')}</span>
        </button>
      </div>

      {/* Source Handles - one per EVERY column (for pending connections from any column) */}
      {columns.map((col, idx) => {
        const ROW_HEIGHT = 37;
        const HEADER_HEIGHT = 52; // 44 + 8px offset down
        const topPosition = HEADER_HEIGHT + (idx * ROW_HEIGHT) + (ROW_HEIGHT / 2);
        return (
          <Handle
            key={`source-${col.name}`}
            type="source"
            position={Position.Right}
            id={`source-col-${col.name}`}
            className="!w-0 !h-0 !bg-transparent !border-0"
            style={{ top: topPosition }}
          />
        );
      })}

      {/* Target Handles - one per column for receiving connections */}
      {columns.map((col, idx) => {
        const ROW_HEIGHT = 37;
        const HEADER_HEIGHT = 52; // 44 + 8px offset down
        const topPosition = HEADER_HEIGHT + (idx * ROW_HEIGHT) + (ROW_HEIGHT / 2);
        return (
          <Handle
            key={`target-${col.name}`}
            type="target"
            position={Position.Left}
            id={`target-col-${col.name}`}
            className="!w-0 !h-0 !bg-transparent !border-0"
            style={{ top: topPosition }}
          />
        );
      })}
      
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

      {/* Create Column Modal */}
      <CreateColumnModal
        open={showCreateColumnModal}
        onOpenChange={setShowCreateColumnModal}
        onSubmit={async (data) => {
          try {
            await tablesApi.createColumn(String(tableId), {
              name: data.name,
              displayName: data.displayName,
              type: data.type,
              config: data.config || {}
            });
            setShowCreateColumnModal(false);
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
  );
});

TableNode.displayName = 'TableNode';
