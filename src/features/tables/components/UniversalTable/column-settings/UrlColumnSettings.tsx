import React, { useMemo } from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ColumnSettingsProps, renderTypeCellPreview } from './types';
import { TemplateHighlight } from './TemplateHighlight';

/**
 * Компонент настроек для колонок типа url
 */
export const UrlColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  allColumns = [],
  firstRow,
}) => {
  // Список доступных колонок для шаблонов
  const availableColumnNames = useMemo(() =>
    new Set(allColumns.map(col => col.name)),
    [allColumns]
  );

  return (
    <div className="space-y-4 p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🔗 Настройки ссылки
      </h4>

      <Select
        label="Стиль отображения"
        value={draft.config?.url?.style ?? 'default'}
        onChange={(value) => setDraft(prev => ({
          ...prev,
          config: {
            ...prev.config,
            url: { ...prev.config?.url, style: value as 'default' | 'button' | 'minimal' | 'badge' }
          }
        }))}
        options={[
          { label: '🔗 Ссылка (по умолчанию)', value: 'default' },
          { label: '🔘 Кнопка', value: 'button' },
          { label: '✨ Минималистичный', value: 'minimal' },
          { label: '🏷️ Бейдж', value: 'badge' }
        ]}
      />

      {/* Color selector for button/badge styles */}
      {(draft.config?.url?.style === 'button' || draft.config?.url?.style === 'badge') && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-[var(--text-primary)]">Цвет</legend>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'blue', color: 'var(--color-primary-600)', label: 'Синий (системный)' },
              { value: 'green', color: '#22c55e', label: 'Зелёный' },
              { value: 'red', color: '#ef4444', label: 'Красный' },
              { value: 'orange', color: '#f97316', label: 'Оранжевый' },
              { value: 'purple', color: '#8b5cf6', label: 'Фиолетовый' },
              { value: 'pink', color: '#ec4899', label: 'Розовый' },
              { value: 'teal', color: '#14b8a6', label: 'Бирюзовый' },
              { value: 'indigo', color: '#6366f1', label: 'Индиго' },
              { value: 'gray', color: '#6b7280', label: 'Серый' },
              { value: 'system', color: 'var(--bg-tertiary)', label: 'Нейтральный (по теме)' },
            ].map((colorOption) => (
              <button
                key={colorOption.value}
                type="button"
                title={colorOption.label}
                onClick={() => setDraft(prev => ({
                  ...prev,
                  config: {
                    ...prev.config,
                    url: { ...prev.config?.url, buttonColor: colorOption.value }
                  }
                }))}
                className={`w-8 h-8 rounded-lg transition-all hover:scale-110 ${
                  (draft.config?.url?.buttonColor ?? 'blue') === colorOption.value
                    ? 'ring-2 ring-offset-2 ring-[var(--color-primary-500)] scale-110'
                    : 'hover:ring-1 hover:ring-[var(--border-primary)]'
                }`}
                style={{ backgroundColor: colorOption.color }}
              />
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
        <input
          type="checkbox"
          id="multipleLinks"
          checked={draft.config?.url?.multipleLinks ?? false}
          onChange={(e) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              url: { ...prev.config?.url, multipleLinks: e.target.checked }
            }
          }))}
          className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
        />
        <label htmlFor="multipleLinks" className="flex-1 cursor-pointer">
          <span className="text-sm font-medium text-[var(--text-primary)]">Множественные ссылки</span>
          <p className="text-xs text-[var(--text-tertiary)]">
            Разделители: запятая, точка с запятой, перенос строки
          </p>
        </label>
      </div>

      <div>
        <Input
          label="Значение ячейки"
          placeholder="{{id}} — откуда брать значение"
          value={draft.config?.url?.valueTemplate ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              url: { ...prev.config?.url, valueTemplate: event.target.value }
            }
          }))}
        />
        <TemplateHighlight text={draft.config?.url?.valueTemplate ?? ''} availableColumns={availableColumnNames} />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Если пусто — используется значение из этой колонки
        </p>
      </div>

      <div>
        <Input
          label="Префикс URL"
          placeholder="https://example.com/product/"
          value={draft.config?.url?.prefix ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              url: { ...prev.config?.url, prefix: event.target.value }
            }
          }))}
        />
        <TemplateHighlight text={draft.config?.url?.prefix ?? ''} availableColumns={availableColumnNames} />
      </div>

      <div>
        <Input
          label="Суффикс URL"
          placeholder="/edit?mode=admin"
          value={draft.config?.url?.suffix ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              url: { ...prev.config?.url, suffix: event.target.value }
            }
          }))}
        />
        <TemplateHighlight text={draft.config?.url?.suffix ?? ''} availableColumns={availableColumnNames} />
      </div>

      <div>
        <Input
          label="Текст ссылки"
          placeholder="Открыть #{{id}}"
          value={draft.config?.url?.linkText ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              url: { ...prev.config?.url, linkText: event.target.value }
            }
          }))}
        />
        <TemplateHighlight text={draft.config?.url?.linkText ?? ''} availableColumns={availableColumnNames} />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Если пусто — отображается значение ячейки
        </p>
      </div>

      <div className="p-3 bg-primary-50 dark:bg-primary-900 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
        <p className="font-medium text-primary-800 dark:text-primary-200 flex items-center gap-2 mb-2">
          💡 Переменные
        </p>
        <p className="text-primary-600 dark:text-primary-300 text-xs">
          <code className="bg-primary-100 dark:bg-primary-800 px-1 rounded">{`{{value}}`}</code> — текущее значение ячейки
        </p>
        <p className="text-primary-600 dark:text-primary-300 text-xs mt-1">
          <code className="bg-primary-100 dark:bg-primary-800 px-1 rounded">{`{{column_name}}`}</code> — значение из другой колонки
        </p>
      </div>

      {/* Preview */}
      <div className="flex flex-col gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
        <span className="text-sm text-[var(--text-secondary)]">Превью стилей:</span>
        <div className="flex flex-wrap gap-3">
          {/* Default style */}
          <div className="flex items-center gap-1.5 text-sm text-[var(--color-primary-500)]">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>12345</span>
          </div>
          {/* Button style */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-primary-50 text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)]">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span>12345</span>
            <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
          </div>
          {/* Minimal style */}
          <div className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)]">
            <span className="underline underline-offset-2 decoration-dotted">12345</span>
            <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </div>
        </div>
        {draft.config?.url?.multipleLinks && (
          <p className="text-xs text-[var(--text-tertiary)]">
            При множественных ссылках: <span className="font-mono">2354, 2234, 25434</span> → 3 ссылки
          </p>
        )}
      </div>
    </div>
  );
};
