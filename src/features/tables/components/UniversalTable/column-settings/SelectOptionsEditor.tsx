/**
 * SelectOptionsEditor — Options editor for select/multi-select columns
 * Includes manual options, nested options, import/export
 * Extracted from TypeTab for modularity
 */
import React, { useEffect, useRef, useState } from 'react';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { ColorPicker } from '../../columns-editing/ColorPicker';
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
  const [collecting, setCollecting] = useState(false);
  const [collectionResult, setCollectionResult] = useState<'done' | 'empty' | 'error' | null>(null);
  const collectionRun = useRef(0);
  useEffect(() => () => { collectionRun.current += 1; }, []);

  const collectFromTable = async () => {
    if (!column?.tableId || collecting) return;
    const run = ++collectionRun.current;
    setCollecting(true);
    setCollectionResult(null);
    try {
      const values = new Set<string>();
      for (let page = 1; ; page += 1) {
        const result = await tablesApi.getRows(column.tableId, page, 500, false, '__row_id', 'asc');
        if (run !== collectionRun.current) return;
        const { pagination } = result;
        if (!pagination || pagination.page !== page || !Number.isInteger(pagination.pages)
          || pagination.pages < 0 || (page < pagination.pages && result.rows.length === 0)) {
          throw new Error('Incomplete table pagination');
        }
        collectUniqueValues(result.rows, column.name, column.id).forEach(value => values.add(value));
        if (page >= pagination.pages) break;
      }
      setDraft(current => {
        if (!current || current.id !== column.id || current.tableId !== column.tableId
          || current.type !== draft.type || current.config?.relation?.enabled) return current;
        const existing = current.config?.options || [];
        const known = new Set(existing.flatMap(option => [option.value, ...(option.children || []).map(child => child.value)]));
        const added = [...values].sort().filter(value => !known.has(value))
          .map((value, index) => ({ value, label: value, color: getDefaultColor(existing.length + index) }));
        return added.length ? { ...current, config: { ...current.config, options: [...existing, ...added] } } : current;
      });
      setCollectionResult(values.size ? 'done' : 'empty');
    } catch {
      if (run === collectionRun.current) setCollectionResult('error');
    } finally {
      if (run === collectionRun.current) setCollecting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Мини-вкладки */}
      <div className="flex gap-1 border-b border-[var(--border-primary)]">
        <button
          type="button"
          onClick={() => setOptionsSubTab('options')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            optionsSubTab === 'options'
              ? 'text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)] border-b-2 border-[var(--color-primary-500)]'
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
              ? 'text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)] border-b-2 border-[var(--color-primary-500)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {t('columnSettings.options.formula')}
        </button>
      </div>

      {/* Вкладка Формула */}
      {optionsSubTab === 'formula' && (
        <div className="space-y-3 p-3 border border-[var(--border-primary)] rounded-lg">
          <Input
            label={t('columnSettings.options.formulaLabel')}
            placeholder="CONCAT(name, '-', status)"
            value={draft.formula ?? ''}
            onChange={(event) => setDraft({ ...draft, formula: event.target.value })}
          />
          <p className="text-xs text-[var(--text-secondary)]">
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
                    {t('columnSettings.options.linkedFrom')} &quot;{availableTables.find(tbl => String(tbl.id) === relationConfig.tableId)?.displayName || t('columnSettings.notSelected')}&quot;
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
                  className="text-xs text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)] hover:underline"
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
                onClick={collectFromTable}
                loading={collecting}
                disabled={!column?.tableId}
                aria-busy={collecting}
                title={t('columnSettings.options.collectFromDataTitle')}
              >
                📊 {t(collecting ? 'columnSettings.options.collecting' : 'columnSettings.options.collectFromData')}
              </Button>

              {collectionResult && (
                <p role={collectionResult === 'error' ? 'alert' : 'status'} className="text-sm text-[var(--text-secondary)]">
                  {t(`columnSettings.options.collect${collectionResult === 'error' ? 'Error' : collectionResult === 'empty' ? 'Empty' : 'Done'}`)}
                </p>
              )}

              {/* Import/Export buttons */}
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--border-primary)]">
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
        <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] [&>div>div]:h-10">
          <Input
            label={t('columnSettings.options.label')} aria-label={t('columnSettings.options.label')}
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
            label={t('columnSettings.options.value')} aria-label={t('columnSettings.options.value')}
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
          <div className="flex flex-col gap-1 text-sm font-medium text-[var(--text-secondary)]">
            <span>{t('columnSettings.options.color')}</span>
            <ColorPicker
              value={option.color ?? null}
              onChange={(color) =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    options: options.map((opt, idx) =>
                      idx === optionIndex ? { ...opt, color: color ?? undefined } : opt
                    )
                  }
                })
              }
            />
          </div>
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
          <p className="text-xs text-[var(--text-secondary)]">{t('columnSettings.options.nestedOptions')}</p>
          {option.children.map((child, childIndex) => (
            <div key={child.value ?? childIndex} className="flex gap-2 items-end">
              <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] [&>div>div]:h-10">
                <Input
                  label={t('columnSettings.options.label')} aria-label={t('columnSettings.options.label')}
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
                  label={t('columnSettings.options.value')} aria-label={t('columnSettings.options.value')}
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
                <div className="flex flex-col gap-1 text-sm font-medium text-[var(--text-secondary)]">
                  <span>{t('columnSettings.options.color')}</span>
                  <ColorPicker
                    value={child.color ?? option.color ?? null}
                    onChange={(color) =>
                      setDraft({
                        ...draft,
                        config: {
                          ...draft.config,
                          options: options.map((opt, idx) =>
                            idx === optionIndex
                              ? {
                                  ...opt,
                                  children: (opt.children || []).map((ch, chIdx) =>
                                    chIdx === childIndex ? { ...ch, color: color ?? undefined } : ch
                                  )
                                }
                              : opt
                          )
                        }
                      })
                    }
                  />
                </div>
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
    <div className="mt-4 p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)]">
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
