import React from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ColumnSettingsProps, renderTypeCellPreview } from './types';
import type { TableColumnConfig } from '@/features/tables/types/table.types';

// Иконки для типа таблицы
const TABLE_ICONS = [
  { value: 'table', label: '📋 Таблица', icon: '📋' },
  { value: 'list', label: '📝 Список', icon: '📝' },
  { value: 'grid', label: '⊞ Сетка', icon: '⊞' },
  { value: 'folder', label: '📁 Папка', icon: '📁' },
  { value: 'box', label: '📦 Коробка', icon: '📦' },
  { value: 'eye', label: '👁 Просмотр', icon: '👁' },
  { value: 'link', label: '🔗 Связь', icon: '🔗' },
  { value: 'none', label: '— Без иконки', icon: '' },
];

/**
 * Компонент настроек для колонок типа table (встроенная таблица)
 */
export const TableColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  relationTableColumns = [],
  currentTableColumns = [],
  firstRow,
}) => {
  return (
    <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📊 Настройки встроенной таблицы
      </h4>
      
      <Select
        label="Режим отображения"
        value={draft.config?.table?.displayMode ?? 'modal'}
        onChange={(value) => setDraft(prev => ({
          ...prev,
          config: {
            ...prev.config,
            table: { ...prev.config?.table, displayMode: value as 'modal' | 'inline' | 'embedded' }
          }
        }))}
        options={[
          { label: '🪟 Модальное окно (кнопка)', value: 'modal' },
          { label: '📋 Встроенная (разворачивается)', value: 'inline' },
          { label: '📊 CSV-вид (в ячейке)', value: 'embedded' }
        ]}
      />
      
      {/* Настройки отображения кнопки */}
      {draft.config?.table?.displayMode === 'modal' && (
        <div className="space-y-3 p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-secondary)]">
          <h5 className="text-sm font-medium text-[var(--text-secondary)]">Отображение кнопки</h5>
          
          <Select
            label="Иконка"
            value={draft.config?.table?.icon ?? 'table'}
            onChange={(value) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                table: { ...prev.config?.table, icon: value as TableColumnConfig['icon'] }
              }
            }))}
            options={TABLE_ICONS}
          />
          
          <Input
            label="Текст кнопки"
            placeholder="Показать записи"
            value={draft.config?.table?.buttonLabel ?? ''}
            onChange={(event) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                table: { ...prev.config?.table, buttonLabel: event.target.value }
              }
            }))}
            hint="Поддерживает переменные: {{column_name}}"
          />
          
          <Select
            label="Стиль кнопки"
            value={draft.config?.table?.buttonStyle ?? 'default'}
            onChange={(value) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                table: { ...prev.config?.table, buttonStyle: value as 'default' | 'outline' | 'ghost' | 'link' }
              }
            }))}
            options={[
              { label: '🔘 Обычная кнопка', value: 'default' },
              { label: '⬜ Контурная', value: 'outline' },
              { label: '👻 Прозрачная', value: 'ghost' },
              { label: '🔗 Ссылка', value: 'link' }
            ]}
          />
          
          {/* Превью кнопки */}
          <div className="pt-2 border-t border-[var(--border-secondary)]">
            <div className="text-xs text-[var(--text-tertiary)] mb-2">Превью:</div>
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 cursor-default ${
                draft.config?.table?.buttonStyle === 'outline' 
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-primary-500 hover:bg-primary-50'
                  : draft.config?.table?.buttonStyle === 'ghost'
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-primary-50'
                  : draft.config?.table?.buttonStyle === 'link'
                  ? 'text-primary-600 underline hover:no-underline p-0'
                  : 'bg-primary-100 text-primary-600'
              }`}
            >
              <span className="text-sm">{TABLE_ICONS.find(i => i.value === (draft.config?.table?.icon ?? 'table'))?.icon}</span>
              <span>{draft.config?.table?.buttonLabel || 'Показать записи'}</span>
            </div>
          </div>
        </div>
      )}
      
      {draft.config?.table?.displayMode === 'embedded' && (
        <>
          <Select
            label="Действие 'Показать все'"
            value={draft.config?.table?.expandAction ?? 'modal'}
            onChange={(value) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                table: { ...prev.config?.table, expandAction: value as 'modal' | 'inline' | 'expand' }
              }
            }))}
            options={[
              { label: '🪟 Открыть в модалке', value: 'modal' },
              { label: '📋 Развернуть под строкой', value: 'inline' },
              { label: '⬇️ Показать все в ячейке', value: 'expand' }
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Макс. строк"
              type="number"
              placeholder="3"
              value={draft.config?.table?.maxRows ?? 3}
              onChange={(event) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  table: { ...prev.config?.table, maxRows: parseInt(event.target.value) || 3 }
                }
              }))}
            />
            <Input
              label="Макс. колонок"
              type="number"
              placeholder="4"
              value={draft.config?.table?.maxColumns ?? 4}
              onChange={(event) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  table: { ...prev.config?.table, maxColumns: parseInt(event.target.value) || 4 }
                }
              }))}
            />
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">
            💡 Если строк/колонок больше лимита, будет показано "... и ещё N"
          </p>
        </>
      )}
      
      <div className="pt-3 border-t border-[var(--border-color)] space-y-3">
        <h5 className="text-sm font-medium text-[var(--text-secondary)]">Фильтрация связанных записей</h5>
        
        {draft.config?.relation?.tableId ? (
          <>
            <Select
              label="Колонка для фильтрации"
              value={draft.config?.table?.filterColumn ?? '__none__'}
              onChange={(value) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  table: { ...prev.config?.table, filterColumn: value === '__none__' ? '' : value }
                }
              }))}
              options={[
                { label: '— Без фильтра (все записи) —', value: '__none__' },
                ...relationTableColumns.map(c => ({ 
                  label: `${c.displayName || c.name} (${c.type})`, 
                  value: c.name 
                }))
              ]}
            />
            
            {draft.config?.table?.filterColumn && (
              <Select
                label="Колонка текущей таблицы для сравнения"
                value={draft.config?.table?.filterSourceColumn ?? '__none__'}
                onChange={(value) => setDraft(prev => ({
                  ...prev,
                  config: {
                    ...prev.config,
                    table: { ...prev.config?.table, filterSourceColumn: value === '__none__' ? '' : value }
                  }
                }))}
                options={[
                  { label: '— Выберите колонку —', value: '__none__' },
                  ...currentTableColumns.map(c => ({ 
                    label: `${c.displayName || c.name} (${c.type})`, 
                    value: c.name 
                  }))
                ]}
                /* hint: filterColumn='client_id', sourceColumn='id' -> shows records where client_id = current id */
              />
            )}
          </>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400 p-3 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800">
            ⚠️ Сначала привяжите таблицу на вкладке "Источник данных" → "Связь с таблицей"
          </p>
        )}
      </div>
      
      <div className="p-3 bg-primary-50 dark:bg-primary-100 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
        <p className="font-medium text-primary-800 dark:text-primary-200 flex items-center gap-2">
          💡 Режимы отображения
        </p>
        <ul className="text-primary-600 dark:text-primary-300 mt-2 space-y-1 text-xs ml-4 list-disc">
          <li><strong>Модальное окно:</strong> Кнопка открывает полную таблицу</li>
          <li><strong>Встроенная:</strong> Клик разворачивает таблицу под строкой</li>
          <li><strong>CSV-вид:</strong> Компактное отображение прямо в ячейке</li>
        </ul>
      </div>
    </div>
  );
};
