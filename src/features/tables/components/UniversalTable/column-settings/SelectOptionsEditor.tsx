/**
 * SelectOptionsEditor — Options editor for select/multi-select columns
 * Includes manual options, nested options, import/export
 * Extracted from TypeTab for modularity
 */
import React from 'react';
import { Input, Select, Button } from '@/shared/components/ui';
import type { ColumnModel, ColumnRelationConfig } from '@/features/tables/types/table.types';
import { getDefaultColor, collectUniqueValues } from './shared';
import type { TFunction } from './shared';

interface SelectOptionsEditorProps {
  draft: ColumnModel;
  setDraft: React.Dispatch<React.SetStateAction<ColumnModel | null>>;
  column: ColumnModel | null;
  t: TFunction;
  options: Array<{ label: string; value: string; color?: string; children?: Array<{ label: string; value: string; color?: string }> }>;
  rows: Array<{ id: string; data: Record<string, unknown> }>;
  relationConfig: ColumnRelationConfig | undefined;
  availableTables: Array<{ id: string; displayName?: string; name: string }>;
  importTableColumns: ColumnModel[];
  handleExportOptionsCsv: () => void;
  handleImportOptionsCsv: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleImportFromTable: () => void;
  importFromTableOpen: boolean;
  setImportFromTableOpen: (open: boolean) => void;
  importTableId: string;
  setImportTableId: (id: string) => void;
  importValueColumn: string;
  setImportValueColumn: (col: string) => void;
  importLabelColumn: string;
  setImportLabelColumn: (col: string) => void;
  optionsSubTab: 'options' | 'formula';
  setOptionsSubTab: (tab: 'options' | 'formula') => void;
  setActiveTab: (tab: string) => void;
}

export const SelectOptionsEditor = ({
  draft,
  setDraft,
  column,
  t,
  options,
  rows,
  relationConfig,
  availableTables,
  importTableColumns,
  handleExportOptionsCsv,
  handleImportOptionsCsv,
  handleImportFromTable,
  importFromTableOpen,
  setImportFromTableOpen,
  importTableId,
  setImportTableId,
  importValueColumn,
  setImportValueColumn,
  importLabelColumn,
  setImportLabelColumn,
  optionsSubTab,
  setOptionsSubTab,
  setActiveTab,
}: SelectOptionsEditorProps) => {
  return (
    <div className="space-y-3">
      {/* Мини-вкладки */}
      <div className="flex gap-1 border-b border-[var(--border-primary)]">
        <button
          type="button"
          onClick={() => setOptionsSubTab('options')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            optionsSubTab === 'options'
              ? 'text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {t('columnSettings.options.title')}
        </button>
        <button
          type="button"
          onClick={() => setOptionsSubTab('formula')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            optionsSubTab === 'formula'
              ? 'text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {t('columnSettings.options.formula')}
        </button>
      </div>

      {/* Вкладка Формула */}
      {optionsSubTab === 'formula' && (
        <div className="space-y-3 p-3 border border-[var(--border-color)] rounded-lg">
          <Input
            label={t('columnSettings.options.formulaLabel')}
            placeholder="CONCAT(name, '-', status)"
            value={draft.formula ?? ''}
            onChange={(event) => setDraft({ ...draft, formula: event.target.value })}
          />
          <p className="text-xs text-[var(--text-tertiary)]">
            {t('columnSettings.options.availableFunctions')}
          </p>
        </div>
      )}

      {/* Вкладка Опции */}
      {optionsSubTab === 'options' && (
        <div className="space-y-4">
          {/* Статус связи */}
          {relationConfig?.enabled ? (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <span>🔗</span>
                  <span className="text-sm font-medium">
                    {t('columnSettings.options.linkedFrom')} "{availableTables.find(tbl => String(tbl.id) === relationConfig.tableId)?.displayName || t('columnSettings.notSelected')}"
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('relation')}
                  className="text-xs text-green-600 dark:text-green-400 hover:underline"
                >
                  {t('columnSettings.options.configure')}
                </button>
              </div>
              {relationConfig.valueColumn && relationConfig.labelColumn && (
                <p className="text-xs text-green-600/70 dark:text-green-400/70 mt-1">
                  {t('columnSettings.relation.valueColumn')}: {relationConfig.valueColumn} • {t('columnSettings.relation.displayColumn')}: {relationConfig.labelColumn}
                </p>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-secondary)]">
                  📝 {t('columnSettings.options.manualOptions')}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('relation')}
                  className="text-xs text-[var(--color-primary-500)] hover:underline"
                >
                  🔗 {t('columnSettings.options.linkToTable')}
                </button>
              </div>
            </div>
          )}

          {/* Ручные опции с поддержкой вложенных */}
          {!relationConfig?.enabled && (
            <div className="space-y-3">
              {options.map((option, optionIndex) => (
                <OptionItem
                  key={option.value ?? optionIndex}
                  draft={draft}
                  setDraft={setDraft}
                  t={t}
                  option={option}
                  optionIndex={optionIndex}
                  options={options}
                />
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      options: [...options, { label: t('columnSettings.options.newOption'), value: `option_${options.length + 1}` }]
                    }
                  })
                }
              >
                {t('columnSettings.options.addOption')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!column) return;
                  const uniqueValues = collectUniqueValues(rows, column.name, column.id);
                  if (uniqueValues.length === 0) return;

                  const existingValues = new Set(options.map(o => o.value));
                  const newOptions = uniqueValues
                    .filter(v => !existingValues.has(v))
                    .map((value, index) => ({
                      value,
                      label: value,
                      color: getDefaultColor(options.length + index)
                    }));

                  if (newOptions.length > 0) {
                    setDraft({
                      ...draft,
                      config: {
                        ...draft.config,
                        options: [...options, ...newOptions]
                      }
                    });
                  }
                }}
                title={t('columnSettings.options.collectFromDataTitle', { default: 'Collect unique values from table data' })}
              >
                📊 {t('columnSettings.options.collectFromData', { count: rows.length })}
              </Button>

              {/* Import/Export buttons */}
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--border-color)]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportOptionsCsv}
                  disabled={options.length === 0}
                  title={t('columnSettings.options.exportCsvTitle', { default: 'Export options to CSV file' })}
                >
                  📥 {t('columnSettings.options.exportCsv')}
                </Button>

                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleImportOptionsCsv}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      (e.target as HTMLElement).closest('label')?.querySelector('input')?.click();
                    }}
                    title={t('columnSettings.options.importCsvTitle', { default: 'Import options from CSV file (value,label,color)' })}
                  >
                    📤 {t('columnSettings.options.importCsv')}
                  </Button>
                </label>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setImportFromTableOpen(true)}
                  title={t('columnSettings.options.fromTableTitle', { default: 'Import options from another table (one-time)' })}
                >
                  🔄 {t('columnSettings.options.fromTable')}
                </Button>
              </div>

              {/* Import from table modal */}
              {importFromTableOpen && (
                <ImportFromTableModal
                  t={t}
                  availableTables={availableTables}
                  importTableId={importTableId}
                  setImportTableId={setImportTableId}
                  importValueColumn={importValueColumn}
                  setImportValueColumn={setImportValueColumn}
                  importLabelColumn={importLabelColumn}
                  setImportLabelColumn={setImportLabelColumn}
                  importTableColumns={importTableColumns}
                  handleImportFromTable={handleImportFromTable}
                  onClose={() => {
                    setImportFromTableOpen(false);
                    setImportTableId('');
                    setImportValueColumn('');
                    setImportLabelColumn('');
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- Option Item Sub-Component ---

interface OptionItemProps {
  draft: ColumnModel;
  setDraft: React.Dispatch<React.SetStateAction<ColumnModel | null>>;
  t: TFunction;
  option: { label: string; value: string; color?: string; children?: Array<{ label: string; value: string; color?: string }> };
  optionIndex: number;
  options: Array<{ label: string; value: string; color?: string; children?: Array<{ label: string; value: string; color?: string }> }>;
}

const OptionItem = ({ draft, setDraft, t, option, optionIndex, options }: OptionItemProps) => {
  return (
    <div className="border border-[var(--border-primary)] rounded-lg p-3">
      <div className="flex gap-2 items-end">
        <div className="grid gap-2 md:grid-cols-3 flex-1">
          <Input
            label="Label"
            value={option.label}
            onChange={(event) =>
              setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  options: options.map((opt, idx) =>
                    idx === optionIndex ? { ...opt, label: event.target.value } : opt
                  )
                }
              })
            }
          />
          <Input
            label="Value"
            value={option.value}
            onChange={(event) =>
              setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  options: options.map((opt, idx) =>
                    idx === optionIndex ? { ...opt, value: event.target.value } : opt
                  )
                }
              })
            }
          />
          <Input
            label="Color"
            type="color"
            value={option.color ?? '#6366f1'}
            onChange={(event) =>
              setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  options: options.map((opt, idx) =>
                    idx === optionIndex ? { ...opt, color: event.target.value } : opt
                  )
                }
              })
            }
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 mb-1 px-2"
          onClick={() =>
            setDraft({
              ...draft,
              config: {
                ...draft.config,
                options: options.filter((_, idx) => idx !== optionIndex)
              }
            })
          }
          title={t('columnSettings.options.deleteOption', { default: 'Delete option' })}
        >
          🗑️
        </Button>
      </div>

      {/* Вложенные опции */}
      {option.children && option.children.length > 0 && (
        <div className="mt-3 ml-4 pl-3 border-l-2 border-[var(--border-secondary)] space-y-2">
          <p className="text-xs text-[var(--text-tertiary)]">{t('columnSettings.options.nestedOptions')}</p>
          {option.children.map((child, childIndex) => (
            <div key={child.value ?? childIndex} className="flex gap-2 items-end">
              <div className="grid gap-2 md:grid-cols-3 flex-1">
                <Input
                  label="Label"
                  value={child.label}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      config: {
                        ...draft.config,
                        options: options.map((opt, idx) =>
                          idx === optionIndex
                            ? {
                                ...opt,
                                children: (opt.children || []).map((ch, chIdx) =>
                                  chIdx === childIndex ? { ...ch, label: event.target.value } : ch
                                )
                              }
                            : opt
                        )
                      }
                    })
                  }
                />
                <Input
                  label="Value"
                  value={child.value}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      config: {
                        ...draft.config,
                        options: options.map((opt, idx) =>
                          idx === optionIndex
                            ? {
                                ...opt,
                                children: (opt.children || []).map((ch, chIdx) =>
                                  chIdx === childIndex ? { ...ch, value: event.target.value } : ch
                                )
                              }
                            : opt
                        )
                      }
                    })
                  }
                />
                <Input
                  label="Color"
                  type="color"
                  value={child.color ?? option.color ?? '#6366f1'}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      config: {
                        ...draft.config,
                        options: options.map((opt, idx) =>
                          idx === optionIndex
                            ? {
                                ...opt,
                                children: (opt.children || []).map((ch, chIdx) =>
                                  chIdx === childIndex ? { ...ch, color: event.target.value } : ch
                                )
                              }
                            : opt
                        )
                      }
                    })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 mb-1 px-2"
                onClick={() =>
                  setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      options: options.map((opt, idx) =>
                        idx === optionIndex
                          ? { ...opt, children: (opt.children || []).filter((_, chIdx) => chIdx !== childIndex) }
                          : opt
                      )
                    }
                  })
                }
                title={t('common.delete', { default: 'Delete' })}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Кнопка добавления вложенной опции */}
      <Button
        type="button"
        variant="ghost"
        className="mt-2 text-xs"
        onClick={() =>
          setDraft({
            ...draft,
            config: {
              ...draft.config,
              options: options.map((opt, idx) =>
                idx === optionIndex
                  ? {
                      ...opt,
                      children: [
                        ...(opt.children || []),
                        { label: t('columnSettings.options.suboption'), value: `${opt.value}_sub_${(opt.children?.length || 0) + 1}` }
                      ]
                    }
                  : opt
              )
            }
          })
        }
      >
        {t('columnSettings.options.addSuboption')}
      </Button>
    </div>
  );
};

// --- Import from Table Modal ---

interface ImportFromTableModalProps {
  t: TFunction;
  availableTables: Array<{ id: string; displayName?: string; name: string }>;
  importTableId: string;
  setImportTableId: (id: string) => void;
  importValueColumn: string;
  setImportValueColumn: (col: string) => void;
  importLabelColumn: string;
  setImportLabelColumn: (col: string) => void;
  importTableColumns: ColumnModel[];
  handleImportFromTable: () => void;
  onClose: () => void;
}

const ImportFromTableModal = ({
  t,
  availableTables,
  importTableId,
  setImportTableId,
  importValueColumn,
  setImportValueColumn,
  importLabelColumn,
  setImportLabelColumn,
  importTableColumns,
  handleImportFromTable,
  onClose,
}: ImportFromTableModalProps) => {
  return (
    <div className="mt-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <div className="flex justify-between items-center mb-4">
        <h5 className="font-medium text-[var(--text-primary)]">📥 {t('columnSettings.options.importFromTable', { default: 'Import from table' })}</h5>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
        >
          ✕
        </Button>
      </div>

      <div className="space-y-3">
        <Select
          label={t('columnSettings.relation.table')}
          value={importTableId || '__none__'}
          onChange={(value) => {
            setImportTableId(value === '__none__' ? '' : value);
            setImportValueColumn('');
            setImportLabelColumn('');
          }}
          options={[
            { label: t('columnSettings.options.selectTable', { default: '— Select table —' }), value: '__none__' },
            ...(availableTables || []).map(tbl => ({
              label: tbl.displayName || tbl.name,
              value: String(tbl.id)
            }))
          ]}
        />

        {importTableId && (
          <>
            <Select
              label={t('columnSettings.options.valueColumn', { default: 'Column for Value' })}
              value={importValueColumn || '__none__'}
              onChange={(value) => setImportValueColumn(value === '__none__' ? '' : value)}
              options={[
                { label: t('columnSettings.relation.selectColumn'), value: '__none__' },
                ...(importTableColumns || []).map(c => ({
                  label: `${c.displayName || c.name} (${c.type})`,
                  value: c.name
                }))
              ]}
            />

            <Select
              label={t('columnSettings.options.labelColumn', { default: 'Column for Label' })}
              value={importLabelColumn || '__none__'}
              onChange={(value) => setImportLabelColumn(value === '__none__' ? '' : value)}
              options={[
                { label: t('columnSettings.relation.selectColumn'), value: '__none__' },
                ...(importTableColumns || []).map(c => ({
                  label: `${c.displayName || c.name} (${c.type})`,
                  value: c.name
                }))
              ]}
            />

            <p className="text-xs text-[var(--text-tertiary)]">
              💡 {t('columnSettings.options.oneTimeImportHint', { default: 'This is a one-time import. Unlike "Table Relation", options will not auto-update.' })}
            </p>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleImportFromTable}
              disabled={!importValueColumn || !importLabelColumn}
            >
              ✅ {t('columnSettings.options.importOptions', { default: 'Import options' })}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
