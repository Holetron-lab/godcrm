/**
 * RelationTab — Relation settings tab for column configuration
 * Extracted from ColumnSettingsDrawer for modularity
 */
import React from 'react';
import { Select, Switch } from '@/shared/components/ui';
import type { ColumnModel, ColumnRelationConfig } from '@/features/tables/types/table.types';
import type { TFunction } from './shared';

interface RelationTabProps {
  draft: ColumnModel;
  setDraft: React.Dispatch<React.SetStateAction<ColumnModel | null>>;
  t: TFunction;
  relationConfig: ColumnRelationConfig | undefined;
  relationProjectId: number | null;
  setRelationProjectId: (id: number | null) => void;
  relationProjectTables: Array<{ id: string; displayName?: string; name: string; icon?: string }>;
  relationTableId: string | undefined;
  relationTableColumns: ColumnModel[];
  availableTables: Array<{ id: string; displayName?: string; name: string; icon?: string }>;
  allTablesData: { spaces?: Array<{ id: number; name: string; icon?: string; projects: Array<{ id: number; name: string; icon?: string }> }> } | undefined;
  creatingColorColumn: boolean;
  handleCreateColorColumn: () => void;
}

export const RelationTab = ({
  draft,
  setDraft,
  t,
  relationConfig,
  relationProjectId,
  setRelationProjectId,
  relationProjectTables,
  relationTableId,
  relationTableColumns,
  availableTables,
  allTablesData,
  creatingColorColumn,
  handleCreateColorColumn,
}: RelationTabProps) => {
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          🔗 {t('columnSettings.relation.title')}
        </h4>
        <p className="text-xs text-[var(--text-tertiary)] mb-4">
          {t('columnSettings.relation.description')}
        </p>

        {/* Переключатель связи */}
        <div className="flex items-center gap-3 mb-4">
          <Switch
            checked={relationConfig?.enabled === true}
            onCheckedChange={(checked) =>
              setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  relation: checked
                    ? { enabled: true, tableId: '', valueColumn: '', labelColumn: '' }
                    : { enabled: false, tableId: '', valueColumn: '', labelColumn: '' }
                }
              })
            }
          />
          <span className="text-sm text-[var(--text-secondary)]">
            {relationConfig?.enabled ? t('columnSettings.relation.enabled') : t('columnSettings.relation.disabled')}
          </span>
        </div>

        {/* Настройки связи */}
        {relationConfig?.enabled && (
          <div className="space-y-4 pt-4 border-t border-[var(--border-secondary)]">
            {/* Каскадные селекторы: Проект → Таблица */}
            <div className="grid grid-cols-2 gap-3">
              {/* Проект - сгруппированный по пространствам */}
              <Select
                label={t('columnSettings.relation.project')}
                value={relationProjectId ? String(relationProjectId) : '__none__'}
                onChange={(value) => {
                  const projId = value === '__none__' ? null : Number(value);
                  setRelationProjectId(projId);
                  setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      relation: {
                        ...relationConfig,
                        tableId: '',
                        valueColumn: '',
                        labelColumn: ''
                      }
                    }
                  });
                }}
                options={[{ label: t('columnSettings.relation.selectProject'), value: '__none__' }]}
                groups={(allTablesData?.spaces || []).map((space) => ({
                  label: `${space.icon || '🏢'} ${space.name} (${space.id})`,
                  options: space.projects.map((p) => ({
                    label: `${p.icon || '📂'} ${p.name} (${p.id})`,
                    value: String(p.id)
                  }))
                }))}
              />

              {/* Table */}
              <Select
                label={t('columnSettings.relation.table')}
                value={relationConfig.tableId || '__none__'}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      relation: {
                        ...relationConfig,
                        tableId: value === '__none__' ? '' : value,
                        valueColumn: '',
                        labelColumn: ''
                      }
                    }
                  })
                }
                disabled={!relationProjectId}
                options={[
                  { label: t('columnSettings.relation.selectTable'), value: '__none__' },
                  ...relationProjectTables.map((tbl) => ({
                    label: `${tbl.icon || '📋'} ${tbl.displayName} (${tbl.id})`,
                    value: tbl.id
                  }))
                ]}
              />
            </div>

            {relationTableId && relationTableColumns.length > 0 && (
              <>
                <Select
                  label={t('columnSettings.relation.valueColumn')}
                  value={relationConfig.valueColumn || '__none__'}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      config: {
                        ...draft.config,
                        relation: {
                          ...relationConfig,
                          valueColumn: value === '__none__' ? '' : value
                        }
                      }
                    })
                  }
                  options={[
                    { label: t('columnSettings.relation.selectColumn'), value: '__none__' },
                    ...(relationTableColumns || []).map((c) => ({
                      label: `${c.displayName || c.name} (${c.type})`,
                      value: c.name
                    }))
                  ]}
                />
                <Select
                  label={t('columnSettings.relation.displayColumn')}
                  value={relationConfig.labelColumn || '__none__'}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      config: {
                        ...draft.config,
                        relation: {
                          ...relationConfig,
                          labelColumn: value === '__none__' ? '' : value
                        }
                      }
                    })
                  }
                  options={[
                    { label: t('columnSettings.relation.selectColumn'), value: '__none__' },
                    ...(relationTableColumns || []).map((c) => ({
                      label: `${c.displayName || c.name} (${c.type})`,
                      value: c.name
                    }))
                  ]}
                />

                {/* Color Column with Create option */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    {t('columnSettings.relation.colorColumn')}
                  </label>
                  <select
                    value={relationConfig.colorColumn || '__none__'}
                    onChange={(e) => {
                      if (e.target.value === '__create_color__') {
                        handleCreateColorColumn();
                      } else {
                        setDraft({
                          ...draft,
                          config: {
                            ...draft.config,
                            relation: {
                              ...relationConfig,
                              colorColumn: e.target.value === '__none__' ? undefined : e.target.value
                            }
                          }
                        });
                      }
                    }}
                    disabled={creatingColorColumn}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                  >
                    <option value="__none__">{t('columnSettings.relation.dontUse')}</option>
                    {(relationTableColumns || []).map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.displayName || c.name} ({c.type})
                      </option>
                    ))}
                    <option value="__create_color__" className="text-[var(--color-primary-500)]">
                      {t('columnSettings.relation.createColorColumn')}
                    </option>
                  </select>
                  {creatingColorColumn && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-1 animate-pulse">
                      {t('columnSettings.relation.creatingColumn')}
                    </p>
                  )}
                </div>

                {relationConfig.valueColumn && relationConfig.labelColumn && (
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 text-sm">
                    ✅ {t('columnSettings.relation.configured')} "
                    {availableTables.find((tbl) => String(tbl.id) === relationTableId)?.displayName}"
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Подсказка */}
      {!relationConfig?.enabled && (
        <div className="p-3 rounded-lg bg-primary-50 border border-primary-500 text-primary-600 dark:text-primary-400 text-sm">
          💡 {t('columnSettings.relation.enableHint')}
        </div>
      )}
    </div>
  );
};
