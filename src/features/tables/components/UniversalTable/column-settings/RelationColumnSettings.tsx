import React from 'react';
import { Select, Switch } from '@/shared/components/ui';
import { ColumnSettingsProps, renderTypeCellPreview } from './types';

/**
 * Компонент настроек для колонок типа relation
 */
export const RelationColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  relationTableId,
  relationTableColumns = [],
  relationProjectTables = [],
  firstRow,
}) => {
  return (
    <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🔗 Настройки связи
      </h4>
      
      {/* Настройки колонок - показываем только если таблица уже выбрана */}
      {relationTableId && relationTableColumns.length > 0 ? (
        <>
          {/* Маппинг колонок */}
          <div className="space-y-3">
            <h5 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
              Маппинг колонок
            </h5>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Колонка для значения (ID)"
                value={draft.config?.relation?.valueColumn || '__none__'}
                onChange={(value) =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      relation: {
                        ...prev.config?.relation,
                        valueColumn: value === '__none__' ? '' : value
                      }
                    }
                  }))
                }
                options={[
                  { label: '— Выберите колонку —', value: '__none__' },
                  ...relationTableColumns.map((c) => ({
                    label: `${c.displayName || c.name} (${c.type})`,
                    value: c.name
                  }))
                ]}
              />
              
              <Select
                label="Колонка для отображения"
                value={draft.config?.relation?.labelColumn || '__none__'}
                onChange={(value) =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      relation: {
                        ...prev.config?.relation,
                        labelColumn: value === '__none__' ? '' : value
                      }
                    }
                  }))
                }
                options={[
                  { label: '— Выберите колонку —', value: '__none__' },
                  ...relationTableColumns.map((c) => ({
                    label: `${c.displayName || c.name} (${c.type})`,
                    value: c.name
                  }))
                ]}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Дополнительная строка (опционально)"
                value={draft.config?.relation?.descriptionColumn || '__none__'}
                onChange={(value) =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      relation: {
                        ...prev.config?.relation,
                        descriptionColumn: value === '__none__' ? undefined : value
                      }
                    }
                  }))
                }
                options={[
                  { label: '— Не показывать —', value: '__none__' },
                  ...relationTableColumns.map((c) => ({
                    label: `${c.displayName || c.name} (${c.type})`,
                    value: c.name
                  }))
                ]}
              />
              
              <Select
                label="Колонка для цвета"
                value={draft.config?.relation?.colorColumn || '__none__'}
                onChange={(value) =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      relation: {
                        ...prev.config?.relation,
                        colorColumn: value === '__none__' ? undefined : value
                      }
                    }
                  }))
                }
                options={[
                  { label: '— Не использовать —', value: '__none__' },
                  ...relationTableColumns.map((c) => ({
                    label: `${c.displayName || c.name} (${c.type})`,
                    value: c.name
                  }))
                ]}
              />
            </div>
          </div>
          
          {/* Настройки хранения и отображения */}
          <div className="pt-3 border-t border-[var(--border-secondary)] space-y-4">
            <h5 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
              Формат хранения и отображения
            </h5>
            
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Формат хранения"
                value={draft.config?.relation?.storageFormat || 'json'}
                onChange={(value) =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      relation: {
                        ...prev.config?.relation,
                        storageFormat: value as 'json' | 'comma' | 'semicolon' | 'newline' | 'single'
                      }
                    }
                  }))
                }
                options={[
                  { label: '["a","b"] — JSON', value: 'json' },
                  { label: 'a, b — Запятая', value: 'comma' },
                  { label: 'a; b — Точка с запятой', value: 'semicolon' },
                  { label: 'Перенос строки', value: 'newline' },
                  { label: 'Одно значение', value: 'single' }
                ]}
              />
              
              <Select
                label="Отображение в таблице"
                value={draft.config?.relation?.displayMode || 'badges'}
                onChange={(value) =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      relation: {
                        ...prev.config?.relation,
                        displayMode: value as 'badges' | 'cards' | 'list' | 'raw' | 'count' | 'first'
                      }
                    }
                  }))
                }
                options={[
                  { label: '🏷️ Бейджи (теги)', value: 'badges' },
                  { label: '🃏 Карточки (название + описание)', value: 'cards' },
                  { label: '📝 Список (через запятую)', value: 'list' },
                  { label: '🔢 Только количество', value: 'count' },
                  { label: '1️⃣ Только первое', value: 'first' },
                  { label: '{ } Raw JSON', value: 'raw' }
                ]}
              />
            </div>
            
            {/* Превью формата */}
            <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg text-xs">
              <div className="text-[var(--text-tertiary)] mb-2">Пример хранения:</div>
              <code className="text-[var(--text-primary)] font-mono">
                {draft.config?.relation?.storageFormat === 'json' && '["TSK001","TSK002","TSK003"]'}
                {draft.config?.relation?.storageFormat === 'comma' && 'TSK001, TSK002, TSK003'}
                {draft.config?.relation?.storageFormat === 'semicolon' && 'TSK001; TSK002; TSK003'}
                {draft.config?.relation?.storageFormat === 'newline' && 'TSK001\\nTSK002\\nTSK003'}
                {draft.config?.relation?.storageFormat === 'single' && 'TSK001'}
                {!draft.config?.relation?.storageFormat && '["TSK001","TSK002","TSK003"]'}
              </code>
            </div>
          </div>
          
          {/* Дополнительные настройки */}
          <div className="pt-3 border-t border-[var(--border-secondary)]">
            <div className="flex items-center gap-3">
              <Switch
                checked={draft.config?.relation?.multiple !== false}
                onCheckedChange={(checked) =>
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      relation: {
                        ...prev.config?.relation,
                        multiple: checked
                      }
                    }
                  }))
                }
              />
              <span className="text-sm text-[var(--text-secondary)]">
                Множественный выбор
              </span>
            </div>
          </div>
          
          {draft.config?.relation?.valueColumn && draft.config?.relation?.labelColumn && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm border border-green-200 dark:border-green-800">
              <p className="font-medium text-green-800 dark:text-green-200 flex items-center gap-2">
                ✅ Связь настроена
              </p>
              <p className="text-green-600 dark:text-green-300 mt-1">
                Таблица: {relationProjectTables.find(t => t.id === relationTableId)?.displayName || 'Выбрана'}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm border border-amber-200 dark:border-amber-800">
          <p className="font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2">
            ⚠️ Таблица не выбрана
          </p>
          <p className="text-amber-600 dark:text-amber-300 mt-1">
            Перейдите на вкладку "Источник данных" чтобы выбрать проект и таблицу для связи.
          </p>
        </div>
      )}
    </div>
  );
};
