import React, { useState, useEffect, useMemo } from 'react';
import { ColumnModel, TableModel } from '@/features/tables/types/table.types';
import { Switch, Select } from '@/shared/components/ui';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';

interface BackLinkTabProps {
  draft: ColumnModel;
  setDraft: (updater: (prev: ColumnModel) => ColumnModel) => void;
  allTables?: TableModel[];
  currentTableId?: number;
}

export const BackLinkTab: React.FC<BackLinkTabProps> = ({ 
  draft, 
  setDraft, 
  currentTableId 
}) => {
  const { data: allTablesData } = useAllTables();
  const [backLinkProjectId, setBackLinkProjectId] = useState<number | null>(null);
  const backLinkConfig = draft.config?.backLink;
  
  const backLinkProjectTables = useMemo(() => {
    if (!backLinkProjectId || !allTablesData?.projects) return [];
    const project = allTablesData.projects.find(p => p.id === backLinkProjectId);
    return project?.tables || [];
  }, [backLinkProjectId, allTablesData]);
  
  const backLinkTableId = backLinkConfig?.targetTableId;
  const { data: backLinkTableColumns = [] } = useTableColumns(backLinkTableId || undefined, true);
  
  useEffect(() => {
    if (!allTablesData?.flat || !backLinkConfig?.targetTableId) return;
    const tableInfo = allTablesData.flat.find(t => t.id === backLinkConfig.targetTableId);
    if (tableInfo?.projectId && tableInfo.projectId !== backLinkProjectId) {
      setBackLinkProjectId(tableInfo.projectId);
    }
  }, [allTablesData, backLinkConfig?.targetTableId, backLinkProjectId]);

  const handleToggleBackLink = (enabled: boolean) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        backLink: enabled
          ? { enabled: true, targetTableId: '', targetColumnId: '', displayColumn: '', displayMode: 'badges' as const }
          : { enabled: false, targetTableId: '', targetColumnId: '', displayColumn: '', displayMode: 'badges' as const }
      }
    }));
  };

  const hasActiveDataSource = draft.config?.relation?.enabled && draft.config?.relation?.tableId;

  return (
    <div className="space-y-4">
      {hasActiveDataSource && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <div className="flex items-start gap-3">
            <span className="text-2xl">✅</span>
            <div className="flex-1">
              <h4 className="font-medium text-green-900 dark:text-green-100 mb-1">
                Источник данных подключен
              </h4>
              <p className="text-sm text-green-700 dark:text-green-300">
                Эта колонка получает данные из связанной таблицы (ID: {draft.config?.relation?.tableId}).
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          🔄 Обратная связь с таблицей
        </h4>
        <p className="text-xs text-[var(--text-tertiary)] mb-4">
          Настройте обратную связь для синхронизации данных между связанными таблицами.
        </p>
        
        <div className="flex items-center gap-3 mb-4">
          <Switch
            checked={backLinkConfig?.enabled === true}
            onCheckedChange={handleToggleBackLink}
          />
          <span className="text-sm text-[var(--text-secondary)]">
            {backLinkConfig?.enabled ? 'Обратная связь включена' : 'Связь выключена'}
          </span>
        </div>
        
        {backLinkConfig?.enabled && (
          <div className="space-y-4 pt-4 border-t border-[var(--border-secondary)]">
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Проект"
                value={backLinkProjectId ? String(backLinkProjectId) : '__none__'}
                onChange={(value) => {
                  const projId = value === '__none__' ? null : Number(value);
                  setBackLinkProjectId(projId);
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      backLink: { enabled: true, targetTableId: '', targetColumnId: '', displayColumn: '', displayMode: 'badges' as const }
                    }
                  }));
                }}
                options={[{ label: '— Выберите проект —', value: '__none__' }]}
                groups={(allTablesData?.spaces || []).map((space) => ({
                  label: `${space.icon || '🏢'} ${space.name} (${space.id})`,
                  options: space.projects.map((p) => ({
                    label: `${p.icon || '📂'} ${p.name} (${p.id})`,
                    value: String(p.id)
                  }))
                }))}
              />
              
              <Select
                label="Целевая таблица"
                value={backLinkConfig.targetTableId || '__none__'}
                onChange={(value) =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      backLink: { enabled: true, targetTableId: value === '__none__' ? '' : value, targetColumnId: '', displayColumn: '', displayMode: 'badges' as const }
                    }
                  }))
                }
                disabled={!backLinkProjectId}
                options={[
                  { label: '— Выберите таблицу —', value: '__none__' },
                  ...backLinkProjectTables.map((t) => ({
                    label: `${t.icon || '📋'} ${t.displayName} (${t.id})`,
                    value: t.id
                  }))
                ]}
              />
            </div>

            {backLinkTableId && backLinkTableColumns.length > 0 && (
              <>
                <Select
                  label="Целевая колонка (куда записывать)"
                  value={backLinkConfig.targetColumnId || '__none__'}
                  onChange={(value) =>
                    setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        backLink: {
                          ...prev.config?.backLink,
                          enabled: true,
                          targetTableId: backLinkConfig.targetTableId,
                          targetColumnId: value === '__none__' ? '' : value,
                          displayColumn: prev.config?.backLink?.displayColumn || '',
                          displayMode: prev.config?.backLink?.displayMode || 'badges'
                        }
                      }
                    }))
                  }
                  options={[
                    { label: '— Выберите колонку —', value: '__none__' },
                    ...(backLinkTableColumns || []).map((c) => ({
                      label: (c.displayName || c.name) + ' (' + c.type + ')',
                      value: c.name
                    }))
                  ]}
                />
                
                <Select
                  label="Колонка для отображения"
                  value={backLinkConfig.displayColumn || '__none__'}
                  onChange={(value) =>
                    setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        backLink: {
                          ...prev.config?.backLink,
                          enabled: true,
                          targetTableId: backLinkConfig.targetTableId,
                          targetColumnId: backLinkConfig.targetColumnId || '',
                          displayColumn: value === '__none__' ? '' : value,
                          displayMode: prev.config?.backLink?.displayMode || 'badges'
                        }
                      }
                    }))
                  }
                  options={[
                    { label: '— Выберите колонку —', value: '__none__' },
                    ...(backLinkTableColumns || []).map((c) => ({
                      label: (c.displayName || c.name) + ' (' + c.type + ')',
                      value: c.name
                    }))
                  ]}
                />

                <Select
                  label="Режим отображения"
                  value={backLinkConfig.displayMode || 'badges'}
                  onChange={(value) =>
                    setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        backLink: {
                          ...prev.config?.backLink,
                          enabled: true,
                          targetTableId: backLinkConfig.targetTableId,
                          targetColumnId: backLinkConfig.targetColumnId || '',
                          displayColumn: backLinkConfig.displayColumn || '',
                          displayMode: value as 'count' | 'badges' | 'list'
                        }
                      }
                    }))
                  }
                  options={[
                    { label: '🔢 Количество', value: 'count' },
                    { label: '🏷️ Бейджи', value: 'badges' },
                    { label: '📋 Список', value: 'list' },
                  ]}
                />

                {backLinkConfig.targetColumnId && backLinkConfig.displayColumn && (
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 text-sm">
                    ✅ Обратная связь настроена!
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      
      {!backLinkConfig?.enabled && (
        <div className="p-3 rounded-lg bg-primary-50 border border-primary-500 text-primary-600 dark:text-primary-400 text-sm">
          💡 Включите обратную связь для синхронизации с другой таблицей.
        </div>
      )}

      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-2">
          <span className="text-sm">💡</span>
          <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <p><strong>Как это работает:</strong></p>
            <p>• Выберите целевую таблицу и колонку</p>
            <p>• Изменения будут автоматически синхронизироваться</p>
          </div>
        </div>
      </div>
    </div>
  );
};
