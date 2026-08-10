/**
 * ColumnsEditingTab - Вкладка редактирования колонок для EditTableModal
 * Вынесена как отдельный компонент для лучшей структуризации
 */

import { logger } from '@/shared/utils/logger';
import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useTableColumns } from '../hooks/useTableColumns';
import { useAllTables } from '../hooks/useAllTables';
import { tablesApi } from '../api/tablesApi';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getColumnTypeOptionsForCSV } from '@/shared/types';
import type { ColumnModel, RowModel } from '../types/table.types';
import { ColumnCard, DeleteColumnModal, KeyEditModal, setNestedValue } from './columns-editing';
import { ColumnSettingsDrawer } from './UniversalTable/ColumnSettingsDrawer';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// ============ Main Component ============

export interface ColumnsEditingTabProps {
  tableId: number | string;
  projectId?: number | null;
  isOpen: boolean;
}

export const ColumnsEditingTab = ({ tableId, projectId, isOpen }: ColumnsEditingTabProps) => {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  // Column editing state
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnEdits, setColumnEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [sampleIndexes, setSampleIndexes] = useState<Record<string, number>>({});
  const [editableKeys, setEditableKeys] = useState<Record<string, boolean>>({});

  // Delete confirmation state
  const [columnToDelete, setColumnToDelete] = useState<ColumnModel | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [keyConfirmColumn, setKeyConfirmColumn] = useState<ColumnModel | null>(null);

  // Full column settings drawer state (opens over the EditTableModal)
  const [settingsColumn, setSettingsColumn] = useState<ColumnModel | null>(null);

  // Fetch table columns
  const { data: tableColumns = [], refetch: refetchColumns } = useTableColumns(String(tableId), isOpen);

  // Delete column mutation
  const deleteColumnMutation = useMutation({
    mutationFn: async (columnId: string) => {
      return tablesApi.deleteColumn(String(tableId), columnId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-columns', tableId] });
      refetchColumns();
      setDeleteModalOpen(false);
      setColumnToDelete(null);
      setSettingsColumn(null);
    },
    onError: (error: Error) => {
      logger.error('Failed to delete column:', error);
      alert(`${t('tableEditing.errDelete')}: ${error.message}`);
    }
  });

  // Handle delete column
  const handleDeleteColumn = useCallback((column: ColumnModel) => {
    setColumnToDelete(column);
    setDeleteModalOpen(true);
  }, []);

  const confirmDeleteColumn = useCallback(() => {
    if (columnToDelete) {
      deleteColumnMutation.mutate(columnToDelete.id);
    }
  }, [columnToDelete, deleteColumnMutation]);

  // Single-column save mutation (from ColumnSettingsDrawer)
  const inlineSettingsMutation = useMutation({
    mutationFn: async ({ columnId, payload }: { columnId: string; payload: Partial<ColumnModel> }) => {
      await tablesApi.updateColumn(String(tableId), columnId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-columns', tableId] });
      refetchColumns();
      setSettingsColumn(null);
    },
    onError: (error: Error) => {
      logger.error('Failed to save column settings from drawer:', error);
      alert(`${t('tableEditing.errSaveColumn')}: ${error.message}`);
    }
  });

  // Save column edits (display name, config, type, etc.)
  const saveColumnsMutation = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(columnEdits);
      if (entries.length === 0) return;

      for (const [colId, edits] of entries) {
        const original = tableColumns.find(c => c.id === colId);
        const payload: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(edits)) {
          if (key.startsWith('config.')) {
            const path = key.replace('config.', '').split('.');
            payload.config = setNestedValue(
              (payload.config as Record<string, unknown>) || (original?.config as Record<string, unknown>) || {},
              path,
              value
            );
          } else {
            payload[key] = value;
          }
        }

        await tablesApi.updateColumn(String(tableId), colId, payload as Partial<ColumnModel>);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-columns', tableId] });
      refetchColumns();
      setColumnEdits({});
    },
    onError: (error: Error) => {
      logger.error('Failed to save column edits:', error);
      alert(`${t('tableEditing.errSaveChanges')}: ${error.message}`);
    }
  });

  // Fetch all tables for relation/backlink selectors
  const { data: allTablesData } = useAllTables();
  const projects = useMemo(() => allTablesData?.projects || [], [allTablesData]);

  // Sample row index for preview
  const [sampleRowIndex, setSampleRowIndex] = useState(0);

  // Fetch table rows for preview
  const { data: tableRowsData } = useQuery({
    queryKey: ['table-rows-preview', tableId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: { data: Array<Record<string, unknown>> } }>(
        `/tables/${tableId}/rows?limit=50`
      );
      return response.data?.data || [];
    },
    enabled: isOpen,
    staleTime: 60000,
  });

  // Current row for preview
  const currentRow = useMemo(() => {
    if (!tableRowsData || !Array.isArray(tableRowsData) || tableRowsData.length === 0) return null;
    return tableRowsData[sampleRowIndex] || tableRowsData[0];
  }, [tableRowsData, sampleRowIndex]);

  // Adapt flat row records → RowModel shape ({ id, data }) expected by ColumnSettingsDrawer
  const drawerRows = useMemo(
    () => (tableRowsData || []).map((row) => ({
      id: row?.id != null ? String(row.id) : '',
      data: row as Record<string, unknown>,
    })),
    [tableRowsData]
  );

  // Get sample values for each column
  const getSampleValues = (columnName: string): string[] => {
    if (!tableRowsData || !Array.isArray(tableRowsData)) return [];
    return tableRowsData.map(row => {
      const val = row[columnName];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });
  };

  // Column types - without emoji
  const COLUMN_TYPES = useMemo(() => getColumnTypeOptionsForCSV('ru'), []);

  // Sort columns - visible first, hidden last
  const sortedColumns = useMemo(() => {
    return [...tableColumns].sort((a, b) => {
      const aHidden = hiddenColumns.has(a.id);
      const bHidden = hiddenColumns.has(b.id);
      if (aHidden === bHidden) return 0;
      return aHidden ? 1 : -1;
    });
  }, [tableColumns, hiddenColumns]);

  // Toggle column expand
  const toggleColumnExpand = (id: string) => {
    setExpandedColumns(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle column hidden
  const toggleColumnHidden = (id: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Update column edit
  const updateColumnEdit = (columnId: string, field: string, value: unknown) => {
    setColumnEdits(prev => ({
      ...prev,
      [columnId]: {
        ...(prev[columnId] || {}),
        [field]: value
      }
    }));
  };

  // Navigate sample values
  const navigateSample = (columnId: string, delta: number) => {
    const samples = getSampleValues(tableColumns.find(c => c.id === columnId)?.name || '');
    setSampleIndexes(prev => {
      const current = prev[columnId] || 0;
      const next = Math.max(0, Math.min(samples.length - 1, current + delta));
      return { ...prev, [columnId]: next };
    });
  };

  // Get edited column (merge original with edits)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getEditedColumn = (col: any): ColumnModel => {
    const edits = columnEdits[col.id] || {};
    let result = { ...col };

    for (const [key, value] of Object.entries(edits)) {
      if (key.startsWith('config.')) {
        const configPath = key.replace('config.', '').split('.');
        result = {
          ...result,
          config: setNestedValue(result.config || {}, configPath, value)
        };
      } else {
        result = { ...result, [key]: value };
      }
    }

    return result as ColumnModel;
  };

  return (
    <div className="space-y-2 pr-2">
      {/* Header with row navigator */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-[var(--text-secondary)]">
          {t('tableEditing.sectionTitle')} ({tableColumns.length})
        </div>
        {tableRowsData && tableRowsData.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-tertiary)]">{t('tableEditing.rowLabel')}</span>
            <button
              type="button"
              onClick={() => setSampleRowIndex(Math.max(0, sampleRowIndex - 1))}
              disabled={sampleRowIndex === 0}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-[var(--text-primary)] min-w-[60px] text-center">
              {sampleRowIndex + 1} / {tableRowsData.length}
            </span>
            <button
              type="button"
              onClick={() => setSampleRowIndex(Math.min(tableRowsData.length - 1, sampleRowIndex + 1))}
              disabled={sampleRowIndex >= tableRowsData.length - 1}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {tableColumns.length === 0 ? (
        <div className="flex items-center justify-center h-[200px] text-[var(--text-tertiary)]">
          <div className="text-center">
            <div className="text-4xl mb-2">📋</div>
            <p>{t('tableEditing.noColumns')}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedColumns.map((col) => {
            const editedCol = getEditedColumn(col);
            const colSamples = getSampleValues(col.name);
            return (
              <ColumnCard
                key={col.id}
                column={editedCol}
                isExpanded={expandedColumns.has(col.id)}
                isHidden={hiddenColumns.has(col.id)}
                onToggleExpand={() => toggleColumnExpand(col.id)}
                onToggleHidden={() => toggleColumnHidden(col.id)}
                onUpdate={(field, value) => updateColumnEdit(col.id, field, value)}
                onRequestKeyEdit={() => {
                  setKeyConfirmColumn(col as unknown as ColumnModel);
                }}
                onOpenSettings={() => setSettingsColumn(col as unknown as ColumnModel)}
                keyEditable={!!editableKeys[col.id]}
                onDelete={() => handleDeleteColumn(col as unknown as ColumnModel)}
                columnTypes={COLUMN_TYPES}
                sampleValues={colSamples}
                currentSampleIndex={sampleIndexes[col.id] || 0}
                onSampleNavigate={(delta) => navigateSample(col.id, delta)}
                projects={projects}
                currentProjectId={projectId}
                currentRow={currentRow}
              />
            );
          })}
        </div>
      )}

      {/* Info about changes */}
      {Object.keys(columnEdits).length > 0 && (
        <div className="flex items-center justify-between pt-3">
          <span className="text-xs text-amber-400">
            {t('tableEditing.changedColumns')} {Object.keys(columnEdits).length}
          </span>
          <button
            type="button"
            onClick={() => saveColumnsMutation.mutate()}
            disabled={saveColumnsMutation.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary-500)] disabled:cursor-not-allowed disabled:opacity-60 bg-[var(--color-primary-600)] text-white hover:bg-[var(--color-primary-700)] px-4 py-2 text-sm"
          >
            {saveColumnsMutation.isPending ? t('tableEditing.saving') : t('tableEditing.saveAll')}
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteColumnModal
        open={deleteModalOpen}
        onOpenChange={(open) => {
          setDeleteModalOpen(open);
          if (!open) setColumnToDelete(null);
        }}
        column={columnToDelete}
        onConfirm={confirmDeleteColumn}
        isPending={deleteColumnMutation.isPending}
      />

      {/* Key edit confirmation */}
      <KeyEditModal
        column={keyConfirmColumn}
        onClose={() => setKeyConfirmColumn(null)}
        onConfirm={(columnId, sanitizedKey) => {
          setEditableKeys((prev) => ({ ...prev, [columnId]: true }));
          updateColumnEdit(columnId, 'name', sanitizedKey);
        }}
      />

      {/* Full column settings drawer — opens over the EditTableModal */}
      <ColumnSettingsDrawer
        column={settingsColumn}
        open={!!settingsColumn}
        onOpenChange={(open) => { if (!open) setSettingsColumn(null); }}
        onSave={(columnId, payload) => inlineSettingsMutation.mutate({ columnId, payload })}
        onDelete={(columnId) => deleteColumnMutation.mutate(columnId)}
        saving={inlineSettingsMutation.isPending}
        deleting={deleteColumnMutation.isPending}
        projectId={projectId ?? undefined}
        tableId={tableId}
        rows={drawerRows as unknown as RowModel[]}
        allColumns={tableColumns as ColumnModel[]}
      />
    </div>
  );
};
