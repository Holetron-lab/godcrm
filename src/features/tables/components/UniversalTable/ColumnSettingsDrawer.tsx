import React, { useEffect, useMemo, useState, useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui';
import type { ColumnModel } from '../../types/table.types';
import type { ColumnType } from '@/shared/types';
import { COLUMN_TYPE_METADATA } from '@/shared/types';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useAllTables } from '../../hooks/useAllTables';
import { useTableRows } from '../../hooks/useTableRows';
import { tablesApi } from '../../api/tablesApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// Import tab components from column-settings
import { DisplayTab } from './column-settings/DisplayTab';
import { TypeTab } from './column-settings/TypeTab';
import { RelationTab } from './column-settings/RelationTab';
import { AccessTab } from './column-settings/AccessTab';
import {
  BackLinkTab,
  AutomationTab,
  SummaryTab,
  CellFormatSettings,
  TypographySettings,
} from './column-settings';

// Import shared utilities & types
import {
  getColorOptionsWithTranslations,
  getDefaultColor,
  getTabsWithTranslations,
  collectUniqueValues,
  type ColumnSettingsDrawerProps,
  type TabId,
} from './column-settings/shared';

// Import options import/export utilities
import { exportOptionsCsv, parseCsvOptions, importOptionsFromTable } from './column-settings/optionsImportExport';

// Re-export for consumers that import from this file
export type { ColumnSettingsDrawerProps } from './column-settings/shared';

export const ColumnSettingsDrawer = ({
  column,
  currentWidth,
  open,
  onOpenChange,
  onSave,
  onDelete,
  saving = false,
  deleting = false,
  projectId,
  tableId,
  spaceId,
  tableName,
  spaceName,
  projectName,
  rows = [],
  allColumns = [],
  isExternalTable = false
}: ColumnSettingsDrawerProps) => {
  // i18n translations
  const { t, language } = useLanguage();
  const tabs = useMemo(() => getTabsWithTranslations(t), [t]);
  const colorOptions = useMemo(() => getColorOptionsWithTranslations(t), [t]);

  const [activeTab, setActiveTab] = useState<TabId>('display');
  const [draft, setDraft] = useState<ColumnModel | null>(null);
  const [optionsSubTab, setOptionsSubTab] = useState<'options' | 'formula'>('options');
  const [mappingRowIndex, setMappingRowIndex] = useState(0);
  const [keyEditEnabled, setKeyEditEnabled] = useState(false);
  const prevTypeRef = useRef<ColumnType | null>(null);

  // Get first row data for preview
  const firstRow = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    return rows[0]?.data || null;
  }, [rows]);

  // Get current row for column mapping (with navigation)
  const mappingRows = useMemo(() => rows?.slice(0, 50) || [], [rows]);
  const currentMappingRow = useMemo(() => {
    if (!mappingRows || mappingRows.length === 0) return null;
    const safeIndex = Math.min(mappingRowIndex, mappingRows.length - 1);
    return mappingRows[safeIndex]?.data || null;
  }, [mappingRows, mappingRowIndex]);

  const goToPrevMappingRow = () => setMappingRowIndex(i => Math.max(0, i - 1));
  const goToNextMappingRow = () => setMappingRowIndex(i => Math.min(mappingRows.length - 1, i + 1));

  // State for import from table modal
  const [importFromTableOpen, setImportFromTableOpen] = useState(false);
  const [importTableId, setImportTableId] = useState<string>('');
  const [importValueColumn, setImportValueColumn] = useState<string>('');
  const [importLabelColumn, setImportLabelColumn] = useState<string>('');

  // Query client for cache invalidation
  const queryClient = useQueryClient();

  // Загружаем таблицы проекта для маппинга
  const { data: availableTables = [] } = useProjectTables(projectId ?? null);

  // Загружаем ВСЕ таблицы для каскадного выбора в relation
  const { data: allTablesData } = useAllTables();

  // State для каскадного выбора в relation (Проект -> Таблица)
  const [relationProjectId, setRelationProjectId] = useState<number | null>(null);

  // Таблицы для выбранного проекта
  const relationProjectTables = useMemo(() => {
    if (!relationProjectId || !allTablesData?.projects) return [];
    const project = allTablesData.projects.find(p => p.id === relationProjectId);
    return project?.tables || [];
  }, [relationProjectId, allTablesData]);

  // Relation config для select columns
  const relationConfig = draft?.config?.relation;
  const relationTableId = relationConfig?.tableId;

  // Загружаем колонки связанной таблицы (с системными колонками id, base_id для связей)
  const { data: relationTableColumns = [] } = useTableColumns(relationTableId, true);

  // Загружаем данные связанной таблицы для получения resolved значений
  const { data: relationTableRows = [] } = useTableRows(relationTableId?.toString());

  // Вычисляем resolved значение для превью (название из связанной таблицы)
  const resolvedDisplayValue = useMemo(() => {
    if (!firstRow || !relationConfig?.enabled || !relationTableId) return null;

    if (!draft?.name && !draft?.id) return null;
    const rawValue = firstRow[draft.name] ?? firstRow[draft.id];
    if (rawValue == null) return null;

    const valueColumn = relationConfig.valueColumn || 'id';
    const displayColumn = relationConfig.labelColumn || relationConfig.displayColumn || 'name';

    const matchedRow = relationTableRows.find(row => {
      const rowValue = row.data?.[valueColumn];
      return String(rowValue) === String(rawValue);
    });

    if (matchedRow) {
      return String(matchedRow.data?.[displayColumn] ?? rawValue);
    }

    return null;
  }, [firstRow, draft?.name, draft?.id, relationConfig, relationTableId, relationTableRows]);

  // Загружаем колонки для импорта из другой таблицы
  const { data: importTableColumns = [] } = useTableColumns(importTableId || undefined);

  // State for creating color column
  const [creatingColorColumn, setCreatingColorColumn] = useState(false);

  // Create color column in related table
  const handleCreateColorColumn = async () => {
    if (!relationTableId) return;

    setCreatingColorColumn(true);
    try {
      const columnData = {
        name: 'color_tag',
        displayName: t('colors.color'),
        type: 'select',
        config: { options: colorOptions }
      };

      await tablesApi.createColumn(String(relationTableId), columnData);

      // Invalidate columns cache to reload the new column
      await queryClient.invalidateQueries({ queryKey: ['table-columns', relationTableId] });

      // Auto-select the new column
      setDraft(prev => prev ? {
        ...prev,
        config: {
          ...prev.config,
          relation: {
            ...prev.config?.relation,
            colorColumn: 'color_tag'
          }
        }
      } : null);
    } catch (error) {
      logger.error('Failed to create color column:', error);
      alert(t('columnSettings.errorCreatingColumn'));
    } finally {
      setCreatingColorColumn(false);
    }
  };

  // Export options to CSV
  const handleExportOptionsCsv = () => {
    if (!draft) return;
    exportOptionsCsv(draft);
  };

  // Import options from CSV
  const handleImportOptionsCsv = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !draft) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const newOptions = parseCsvOptions(text);

      if (newOptions) {
        setDraft({
          ...draft,
          config: {
            ...draft.config,
            options: newOptions
          }
        });
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be imported again
    event.target.value = '';
  };

  // Import options from another table
  const handleImportFromTable = async () => {
    if (!importTableId || !importValueColumn || !importLabelColumn) return;

    try {
      const newOptions = await importOptionsFromTable(importTableId, importValueColumn, importLabelColumn);

      if (newOptions.length > 0 && draft) {
        setDraft({
          ...draft,
          config: {
            ...draft.config,
            options: newOptions
          }
        });
        setImportFromTableOpen(false);
        setImportTableId('');
        setImportValueColumn('');
        setImportLabelColumn('');
      }
    } catch (error) {
      logger.error('Error importing from table:', error);
    }
  };

  // Извлекаем имена колонок из данных строк для выбора source column
  const currentTableColumns = useMemo(() => {
    if (rows.length === 0) return [];
    const columnNames = new Set<string>();
    rows.forEach(row => {
      Object.keys(row.data).forEach(key => columnNames.add(key));
    });
    return Array.from(columnNames).map(name => ({
      name,
      displayName: name,
      type: 'text' as const
    }));
  }, [rows]);

  // Sync relation cascade selectors from saved config
  useEffect(() => {
    if (!allTablesData?.flat || !relationConfig?.tableId) return;

    const tableInfo = allTablesData.flat.find(t => t.id === relationConfig.tableId);
    if (tableInfo) {
      setRelationProjectId(prev => prev ?? tableInfo.projectId);
    }
  }, [allTablesData?.flat, relationConfig?.tableId]);

  // Инициализация draft при открытии для нового столбца
  useEffect(() => {
    if (column) {
      const defaultAppearance = { align: 'left' as const, indicator: { type: 'emoji' as const, value: '🔣' } };
      const existingAppearance = column.config?.appearance ?? {};

      setDraft({
        ...column,
        width: currentWidth ?? column.width,
        config: {
          ...column.config,
          appearance: {
            ...defaultAppearance,
            ...existingAppearance
          }
        }
      });
      prevTypeRef.current = column.type;
    }
  }, [column?.id]);

  // Автосбор опций при смене типа на select/multi-select
  useEffect(() => {
    if (!draft || !column) return;

    const prevType = prevTypeRef.current;
    const newType = draft.type;

    if (prevType !== newType && (newType === 'select' || newType === 'multi-select')) {
      const existingOptions = draft.config?.options || [];

      if (existingOptions.length === 0) {
        const uniqueValues = collectUniqueValues(rows, column.name, column.id);
        if (uniqueValues.length > 0) {
          const autoOptions = uniqueValues.map((value, index) => ({
            value,
            label: value,
            color: getDefaultColor(index)
          }));

          setDraft(prev => prev ? {
            ...prev,
            config: {
              ...prev.config,
              options: autoOptions
            }
          } : null);
        }
      }
    }

    prevTypeRef.current = newType;
  }, [draft?.type]);

  // Обновляем width когда меняется currentWidth (drag-n-drop resize)
  useEffect(() => {
    if (draft && currentWidth !== undefined && currentWidth !== draft.width) {
      setDraft(prev => prev ? { ...prev, width: currentWidth } : null);
    }
  }, [currentWidth]);

  // Сброс на вкладку Отображение при смене столбца
  useEffect(() => {
    if (column) {
      setActiveTab('display');
    }
  }, [column?.id]);

  const handleSave = () => {
    if (!draft || saving) {
      return;
    }

    // ADR-0017 Phase 2: блокируем save при невалидном JSON-шаблоне
    if (draft.type === 'json') {
      const tpl = draft.config?.json?.template;
      if (tpl && tpl.trim()) {
        try {
          JSON.parse(tpl);
        } catch {
          return;
        }
      }
    }

    const payload = {
      displayName: draft.displayName,
      type: draft.type,
      config: draft.config,
      mapping: draft.mapping,
      formula: draft.formula,
      isRequired: draft.isRequired,
      isReadonly: draft.isReadonly,
      defaultValue: draft.defaultValue,
      width: draft.width,
      isVisible: draft.isVisible,
      orderIndex: draft.orderIndex
    };
    onSave(draft.id, payload);
  };

  const options = useMemo(() => draft?.config?.options ?? [], [draft?.config?.options]);

  if (!draft) {
    return null;
  }

  // Check if column is from external source (can't delete) or local column (can delete)
  const isExternalColumn = column?.is_from_source || column?.is_locked;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${t('columnSettings.fields.columnName')}: ${draft.displayName}`}
      description={t('columnSettings.modal.description')}
      size="xl"
      fixedHeight={true}
      heightOffset={200}
      footer={
        onDelete ? (
          <div className="flex-1">
            {isExternalColumn ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-4V8m0 0V6m0 2h2m-2 0H9" />
                </svg>
                <span>{t('columnSettings.modal.externalLocked')}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (confirm(t('columnSettings.modal.deleteConfirm'))) {
                    onDelete(draft.id);
                  }
                }}
                disabled={deleting}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {deleting ? t('columnSettings.modal.deleting') : t('columnSettings.modal.deleteColumn')}
              </button>
            )}
          </div>
        ) : null
      }
      primaryAction={{
        label: saving ? t('columnSettings.modal.saving') : t('columnSettings.modal.save'),
        onClick: handleSave
      }}
      secondaryAction={{
        label: t('columnSettings.modal.close'),
        variant: 'ghost',
        onClick: () => onOpenChange(false)
      }}
    >
      <div className="space-y-4">
        {/* Compact summary strip */}
        <div className="px-3 py-2 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-tertiary)]">{t('columnSettings.summary.type')}:</span>
              <span className="font-semibold text-orange-600 dark:text-orange-400">{language === 'en' ? (COLUMN_TYPE_METADATA[draft.type]?.labelEn || draft.type) : (COLUMN_TYPE_METADATA[draft.type]?.label || draft.type)}</span>
            </div>
            <span className="text-[var(--text-tertiary)]">•</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-tertiary)]">{t('columnSettings.summary.format')}:</span>
              <span className="font-medium text-[var(--text-primary)]">
                {draft.config?.cellFormat?.mode === 'formula' ? t('columnSettings.summary.formatFormula') :
                 draft.config?.cellFormat?.mode === 'markdown' ? t('columnSettings.summary.formatMarkdown') :
                 draft.config?.cellFormat?.mode === 'html' ? t('columnSettings.summary.formatHtml') : t('columnSettings.summary.formatText')}
              </span>
            </div>
            <span className="text-[var(--text-tertiary)]">•</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-tertiary)]">{t('columnSettings.summary.behaviorLabel')}:</span>
              <span className={`font-medium ${draft.isRequired ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {draft.isRequired ? t('columnSettings.summary.required') : t('columnSettings.summary.optional')}
              </span>
            </div>
            <span className="text-[var(--text-tertiary)]">•</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-tertiary)]">{t('columnSettings.summary.accessLabel')}:</span>
              <span className={`font-medium ${draft.isReadonly ? 'text-gray-600 dark:text-gray-400' : 'text-primary-600 dark:text-primary-400'}`}>
                {draft.isReadonly ? t('columnSettings.summary.readOnlyAccess') : t('columnSettings.summary.editAccess')}
              </span>
            </div>
            <span className="text-[var(--text-tertiary)]">•</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-tertiary)]">{t('columnSettings.fields.width')}:</span>
              <span className="font-medium text-[var(--text-primary)]">{draft.width}px</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-[var(--border-secondary)] pb-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[var(--color-primary-500)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Display Tab */}
        {activeTab === 'display' && (
          <DisplayTab
            draft={draft}
            setDraft={setDraft}
            t={t}
            keyEditEnabled={keyEditEnabled}
            setKeyEditEnabled={setKeyEditEnabled}
          />
        )}

        {/* Relation Tab */}
        {activeTab === 'relation' && (
          <RelationTab
            draft={draft}
            setDraft={setDraft}
            t={t}
            relationConfig={relationConfig}
            relationProjectId={relationProjectId}
            setRelationProjectId={setRelationProjectId}
            relationProjectTables={relationProjectTables}
            relationTableId={relationTableId}
            relationTableColumns={relationTableColumns as ColumnModel[]}
            availableTables={availableTables as any}
            allTablesData={allTablesData as any}
            creatingColorColumn={creatingColorColumn}
            handleCreateColorColumn={handleCreateColorColumn}
          />
        )}

        {/* Type Tab */}
        {activeTab === 'type' && (
          <TypeTab
            draft={draft}
            setDraft={setDraft}
            column={column}
            t={t}
            options={options}
            allColumns={allColumns}
            firstRow={firstRow}
            rows={rows}
            relationConfig={relationConfig}
            relationTableId={relationTableId}
            relationTableColumns={relationTableColumns as ColumnModel[]}
            relationProjectTables={relationProjectTables as any}
            currentTableColumns={currentTableColumns}
            availableTables={availableTables as any}
            importTableColumns={importTableColumns as ColumnModel[]}
            handleExportOptionsCsv={handleExportOptionsCsv}
            handleImportOptionsCsv={handleImportOptionsCsv}
            handleImportFromTable={handleImportFromTable}
            importFromTableOpen={importFromTableOpen}
            setImportFromTableOpen={setImportFromTableOpen}
            importTableId={importTableId}
            setImportTableId={setImportTableId}
            importValueColumn={importValueColumn}
            setImportValueColumn={setImportValueColumn}
            importLabelColumn={importLabelColumn}
            setImportLabelColumn={setImportLabelColumn}
            currentMappingRow={currentMappingRow}
            mappingRowIndex={mappingRowIndex}
            mappingRows={mappingRows}
            goToPrevMappingRow={goToPrevMappingRow}
            goToNextMappingRow={goToNextMappingRow}
            optionsSubTab={optionsSubTab}
            setOptionsSubTab={setOptionsSubTab}
            setActiveTab={setActiveTab as (tab: string) => void}
          />
        )}

        {/* Cell Tab */}
        {activeTab === 'cell' && (
          <div className="space-y-5">
            <CellFormatSettings
              draft={draft}
              setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
            />
            <TypographySettings
              draft={draft}
              setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
            />
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm border border-gray-200 dark:border-gray-700">
              <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">💡 {t('columnSettings.cell.variablesHint')}</p>
              <p className="text-gray-600 dark:text-gray-400 text-xs">
                {t('columnSettings.cell.variablesDescription')}
              </p>
            </div>
          </div>
        )}

        {/* Summary Tab */}
        {activeTab === 'summary' && (
          <SummaryTab
            draft={draft}
            setDraft={(updaterOrValue) => {
              if (typeof updaterOrValue === 'function') {
                setDraft(prev => prev ? updaterOrValue(prev) : prev);
              } else {
                setDraft(updaterOrValue);
              }
            }}
            allColumns={allColumns}
            rows={rows}
            tableId={tableId}
            projectId={projectId}
          />
        )}

        {/* Back Link Tab */}
        {activeTab === 'backLink' && (
          <BackLinkTab
            draft={draft}
            setDraft={(updaterOrValue) => {
              if (typeof updaterOrValue === 'function') {
                setDraft(prev => prev ? updaterOrValue(prev) : prev);
              } else {
                setDraft(updaterOrValue);
              }
            }}
            allTables={availableTables as any}
            currentTableId={tableId}
          />
        )}

        {/* Automation Tab */}
        {activeTab === 'automation' && (
          <AutomationTab
            draft={draft}
            tableId={tableId}
            projectId={projectId}
            tableName={tableName}
          />
        )}

        {/* Access Tab */}
        {activeTab === 'access' && (
          <AccessTab
            column={column}
            t={t}
            spaceId={spaceId}
            spaceName={spaceName}
            projectId={projectId}
            projectName={projectName}
            tableId={tableId}
            tableName={tableName}
          />
        )}
      </div>
    </Modal>
  );
};
