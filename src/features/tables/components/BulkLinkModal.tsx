import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { Modal, Button, Switch } from '@/shared/components/ui';
import { Link2, ChevronDown, ChevronRight, Database, Save, Loader2, Settings2 } from 'lucide-react';
import { useAllTables } from '../hooks/useAllTables';
import { useTableColumns } from '../hooks/useTableColumns';
import { tablesApi } from '../api/tablesApi';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/utils/cn';
import { showToast } from '@/shared/hooks/useToast';

interface BulkLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  currentProjectId?: number;
}

interface ColumnConfig {
  columnId: string;
  name: string;
  displayName: string;
  type: string;
  enabled: boolean;
  // Relation config
  relationEnabled: boolean;
  relationProjectId: number | null;
  relationTableId: string;
  relationValueColumn: string;
  relationLabelColumn: string;
  // BackLink config  
  backLinkEnabled: boolean;
  backLinkProjectId: number | null;
  backLinkTableId: string;
  backLinkColumnId: string;
  backLinkDisplayColumn: string;
  // Original config for comparison
  originalConfig: Record<string, unknown>;
}

export const BulkLinkModal = ({ isOpen, onClose, tableId, currentProjectId }: BulkLinkModalProps) => {
  const queryClient = useQueryClient();
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(currentProjectId || null);

  // Fetch all tables data
  const { data: allTablesData } = useAllTables();
  
  // Current table columns
  const { data: currentColumns = [] } = useTableColumns(tableId, true);

  // Get projects list
  const projects = allTablesData?.projects || [];
  
  // Get all tables flat for lookups
  const allTables = allTablesData?.flat || [];

  // Initialize columns when modal opens
  useEffect(() => {
    if (isOpen && currentColumns.length > 0) {
      const configs: ColumnConfig[] = currentColumns.map(col => {
        // Find project IDs for existing relations
        let relationProjectId: number | null = selectedProjectId;
        let backLinkProjectId: number | null = selectedProjectId;
        
        if (col.config?.relation?.tableId) {
          const relTable = allTables.find(t => t.id === col.config.relation.tableId);
          if (relTable?.projectId) relationProjectId = relTable.projectId;
        }
        if (col.config?.backLink?.targetTableId) {
          const blTable = allTables.find(t => t.id === col.config.backLink.targetTableId);
          if (blTable?.projectId) backLinkProjectId = blTable.projectId;
        }

        return {
          columnId: col.id,
          name: col.name,
          displayName: col.displayName || col.name,
          type: col.type,
          enabled: true,
          relationEnabled: col.config?.relation?.enabled || false,
          relationProjectId,
          relationTableId: col.config?.relation?.tableId || '',
          relationValueColumn: col.config?.relation?.valueColumn || '',
          relationLabelColumn: col.config?.relation?.labelColumn || '',
          backLinkEnabled: col.config?.backLink?.enabled || false,
          backLinkProjectId,
          backLinkTableId: col.config?.backLink?.targetTableId || '',
          backLinkColumnId: col.config?.backLink?.targetColumnId || '',
          backLinkDisplayColumn: col.config?.backLink?.displayColumn || '',
          originalConfig: col.config,
        };
      });
      
      setColumns(configs);
      
      // Set default project
      if (!selectedProjectId && currentProjectId) {
        setSelectedProjectId(currentProjectId);
      }
    }
  }, [isOpen, currentColumns, currentProjectId, allTables, selectedProjectId]);

  const toggleColumn = (columnId: string) => {
    setExpandedColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  };

  const updateColumn = (columnId: string, updates: Partial<ColumnConfig>) => {
    setColumns(prev => prev.map(col => 
      col.columnId === columnId ? { ...col, ...updates } : col
    ));
  };

  // Get tables for a specific project
  const getProjectTables = (projectId: number | null) => {
    if (!projectId || !allTablesData?.projects) return [];
    const project = allTablesData.projects.find(p => p.id === projectId);
    return project?.tables || [];
  };

  // Count configured columns
  const configuredCount = columns.filter(c => c.relationEnabled || c.backLinkEnabled).length;

  // Save all changes
  const handleSave = async () => {
    setIsSaving(true);
    let savedCount = 0;
    
    try {
      for (const col of columns) {
        const originalColumn = currentColumns.find(c => c.id === col.columnId);
        if (!originalColumn) continue;

        // Check if changed
        const hasChanges = 
          col.relationEnabled !== (originalColumn.config?.relation?.enabled || false) ||
          col.relationTableId !== (originalColumn.config?.relation?.tableId || '') ||
          col.relationValueColumn !== (originalColumn.config?.relation?.valueColumn || '') ||
          col.relationLabelColumn !== (originalColumn.config?.relation?.labelColumn || '') ||
          col.backLinkEnabled !== (originalColumn.config?.backLink?.enabled || false) ||
          col.backLinkTableId !== (originalColumn.config?.backLink?.targetTableId || '') ||
          col.backLinkColumnId !== (originalColumn.config?.backLink?.targetColumnId || '') ||
          col.backLinkDisplayColumn !== (originalColumn.config?.backLink?.displayColumn || '');

        if (!hasChanges) continue;

        const updatedConfig = {
          ...originalColumn.config,
          relation: col.relationEnabled ? {
            enabled: true,
            tableId: col.relationTableId,
            valueColumn: col.relationValueColumn,
            labelColumn: col.relationLabelColumn,
          } : { enabled: false },
          backLink: col.backLinkEnabled ? {
            enabled: true,
            targetTableId: col.backLinkTableId,
            targetColumnId: col.backLinkColumnId,
            displayColumn: col.backLinkDisplayColumn,
            displayMode: 'badges' as const,
          } : { enabled: false },
        };

        await tablesApi.updateColumn(tableId, col.columnId, {
          config: updatedConfig
        });
        savedCount++;
      }

      if (savedCount > 0) {
        showToast(`Сохранено ${savedCount} колонок`, 'success');
        queryClient.invalidateQueries({ queryKey: ['columns', tableId] });
        queryClient.invalidateQueries({ queryKey: ['tables'] });
      }
      
      onClose();
    } catch (error) {
      logger.error('Failed to save:', error);
      showToast('Ошибка сохранения', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setColumns([]);
    setExpandedColumns(new Set());
    onClose();
  };

  // Column settings component
  const ColumnSettings = ({ col }: { col: ColumnConfig }) => {
    // Get tables for this column's selected projects
    const relationTables = getProjectTables(col.relationProjectId);
    const backLinkTables = getProjectTables(col.backLinkProjectId);

    // Get columns for selected relation table
    const { data: relationColumns = [] } = useTableColumns(
      col.relationEnabled && col.relationTableId ? col.relationTableId : undefined, 
      true
    );
    
    // Get columns for selected backlink table
    const { data: backLinkColumns = [] } = useTableColumns(
      col.backLinkEnabled && col.backLinkTableId ? col.backLinkTableId : undefined, 
      true
    );

    // Get target table info for display
    const relationTable = allTables.find(t => t.id === col.relationTableId);

    return (
      <div className="px-3 pb-3 pt-0 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)]/50">
        <div className="pt-3 space-y-4">
          {/* Relation (Источник данных) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch
                checked={col.relationEnabled}
                onCheckedChange={(checked) => {
                  updateColumn(col.columnId, { 
                    relationEnabled: checked,
                    ...(checked ? { relationProjectId: selectedProjectId } : { relationProjectId: null, relationTableId: '', relationValueColumn: '', relationLabelColumn: '' })
                  });
                }}
              />
              <Database className="w-4 h-4 text-primary-400" />
              <span className="text-sm font-medium text-[var(--text-primary)]">Источник данных</span>
            </div>
            
            {col.relationEnabled && (
              <div className="ml-8 space-y-2 p-3 rounded-lg bg-primary-500/5 border border-primary-500/20">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1 block">Проект</label>
                    <select
                      value={col.relationProjectId ? String(col.relationProjectId) : ''}
                      onChange={(e) => updateColumn(col.columnId, { 
                        relationProjectId: e.target.value ? Number(e.target.value) : null,
                        relationTableId: '',
                        relationValueColumn: '',
                        relationLabelColumn: ''
                      })}
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                    >
                      <option value="">— Проект —</option>
                      {projects.map(p => (
                        <option key={p.id} value={String(p.id)}>
                          {p.icon || '📂'} {p.name} ({p.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1 block">Связанная таблица</label>
                    <select
                      value={col.relationTableId}
                      onChange={(e) => updateColumn(col.columnId, { 
                        relationTableId: e.target.value,
                        relationValueColumn: '',
                        relationLabelColumn: ''
                      })}
                      disabled={!col.relationProjectId}
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-primary-500/30 text-sm text-[var(--text-primary)] disabled:opacity-50"
                    >
                      <option value="">— Таблица —</option>
                      {relationTables.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.icon || '📋'} {t.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {col.relationTableId && relationColumns.length > 0 && (
                  <>
                    <div className="text-xs text-primary-300/70 mb-2">
                      Значения будут связаны с записями таблицы "{relationTable?.displayName}" по row_id
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-1 block">Колонка значения (ID)</label>
                        <select
                          value={col.relationValueColumn}
                          onChange={(e) => updateColumn(col.columnId, { relationValueColumn: e.target.value })}
                          className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                        >
                          <option value="">— Выберите —</option>
                          {relationColumns.map(c => (
                            <option key={c.name} value={c.name}>
                              {c.displayName || c.name} ({c.type})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-1 block">Колонка отображения</label>
                        <select
                          value={col.relationLabelColumn}
                          onChange={(e) => updateColumn(col.columnId, { relationLabelColumn: e.target.value })}
                          className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                        >
                          <option value="">— Выберите —</option>
                          {relationColumns.map(c => (
                            <option key={c.name} value={c.name}>
                              {c.displayName || c.name} ({c.type})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* BackLink (Обратная связь) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch
                checked={col.backLinkEnabled}
                onCheckedChange={(checked) => {
                  updateColumn(col.columnId, { 
                    backLinkEnabled: checked,
                    ...(checked ? { backLinkProjectId: selectedProjectId } : { backLinkProjectId: null, backLinkTableId: '', backLinkColumnId: '', backLinkDisplayColumn: '' })
                  });
                }}
              />
              <Link2 className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-[var(--text-primary)]">Обратная связь</span>
            </div>
            
            {col.backLinkEnabled && (
              <div className="ml-8 space-y-2 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1 block">Проект</label>
                    <select
                      value={col.backLinkProjectId ? String(col.backLinkProjectId) : ''}
                      onChange={(e) => updateColumn(col.columnId, { 
                        backLinkProjectId: e.target.value ? Number(e.target.value) : null,
                        backLinkTableId: '',
                        backLinkColumnId: '',
                        backLinkDisplayColumn: ''
                      })}
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                    >
                      <option value="">— Проект —</option>
                      {projects.map(p => (
                        <option key={p.id} value={String(p.id)}>
                          {p.icon || '📂'} {p.name} ({p.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1 block">Целевая таблица</label>
                    <select
                      value={col.backLinkTableId}
                      onChange={(e) => updateColumn(col.columnId, { 
                        backLinkTableId: e.target.value,
                        backLinkColumnId: '',
                        backLinkDisplayColumn: ''
                      })}
                      disabled={!col.backLinkProjectId}
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-purple-500/30 text-sm text-[var(--text-primary)] disabled:opacity-50"
                    >
                      <option value="">— Таблица —</option>
                      {backLinkTables.filter(t => t.id !== tableId).map(t => (
                        <option key={t.id} value={t.id}>
                          {t.icon || '📋'} {t.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {col.backLinkTableId && backLinkColumns.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1 block">Целевая колонка</label>
                      <select
                        value={col.backLinkColumnId}
                        onChange={(e) => updateColumn(col.columnId, { backLinkColumnId: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                      >
                        <option value="">— Выберите —</option>
                        {backLinkColumns.map(c => (
                          <option key={c.name} value={c.name}>
                            {c.displayName || c.name} ({c.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1 block">Колонка отображения</label>
                      <select
                        value={col.backLinkDisplayColumn}
                        onChange={(e) => updateColumn(col.columnId, { backLinkDisplayColumn: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                      >
                        <option value="">— Выберите —</option>
                        {backLinkColumns.map(c => (
                          <option key={c.name} value={c.name}>
                            {c.displayName || c.name} ({c.type})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title="Пакетная настройка связей"
      size="xl"
      fixedHeight
      heightOffset={200}
    >
      <div className="flex flex-col h-full">
        {/* Header with project selector */}
        <div className="flex-shrink-0 pb-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Проект для связей</label>
              <select
                value={selectedProjectId ? String(selectedProjectId) : ''}
                onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
              >
                <option value="">— Выберите проект —</option>
                {projects.map(p => (
                  <option key={p.id} value={String(p.id)}>
                    {p.icon || '📂'} {p.name} ({p.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="text-sm text-[var(--text-tertiary)] pt-5">
              {configuredCount} / {columns.length} колонок со связями
            </div>
          </div>
        </div>

        {/* Columns list */}
        <div className="flex-1 overflow-y-auto py-4">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 className="w-4 h-4 text-[var(--text-secondary)]" />
            <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase">
              Колонки ({columns.length})
            </h4>
          </div>

          {columns.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-tertiary)]">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Нет колонок для настройки</p>
            </div>
          ) : (
            <div className="space-y-1">
              {columns.map(col => {
                const isExpanded = expandedColumns.has(col.columnId);
                const isRelation = col.type === 'relation' || col.relationEnabled;
                const hasBackLink = col.backLinkEnabled;
                
                // Get target table names for display
                const relationTable = allTables.find(t => t.id === col.relationTableId);
                const backLinkTable = allTables.find(t => t.id === col.backLinkTableId);
                
                return (
                  <div 
                    key={col.columnId}
                    className={cn(
                      "rounded-lg border transition-all",
                      (isRelation || hasBackLink)
                        ? "border-purple-500/30 bg-purple-500/5"
                        : "border-[var(--border-primary)] bg-[var(--bg-secondary)]"
                    )}
                  >
                    {/* Column row */}
                    <div className="flex items-center gap-2 p-2">
                      {/* Expand button */}
                      <button
                        onClick={() => toggleColumn(col.columnId)}
                        className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
                        )}
                      </button>
                      
                      {/* Column key */}
                      <input
                        type="text"
                        value={col.name}
                        disabled
                        className="w-32 px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs font-mono text-[var(--text-secondary)]"
                      />
                      
                      {/* Display name */}
                      <input
                        type="text"
                        value={col.displayName}
                        disabled
                        className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                      />

                      {/* Type badge */}
                      <span className={cn(
                        "px-2 py-1 rounded-lg text-xs border",
                        isRelation 
                          ? "border-purple-500/50 text-purple-300 bg-purple-500/10" 
                          : "border-[var(--border-primary)] text-[var(--text-secondary)]"
                      )}>
                        {isRelation ? '🔗 Связь' : col.type}
                      </span>

                      {/* Status - linked table name */}
                      <div className="w-28 text-xs truncate text-right">
                        {col.relationEnabled && relationTable ? (
                          <span className="text-purple-300">{relationTable.displayName}</span>
                        ) : col.backLinkEnabled && backLinkTable ? (
                          <span className="text-primary-300">← {backLinkTable.displayName}</span>
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Expanded settings */}
                    {isExpanded && <ColumnSettings col={col} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 pt-4 border-t border-[var(--border-primary)] flex justify-end gap-3">
          <Button variant="secondary" onClick={handleClose}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Сохранение...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Сохранить все
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
