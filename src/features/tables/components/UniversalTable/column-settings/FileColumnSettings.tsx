import React, { useMemo } from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';
import { TemplateHighlight } from './TemplateHighlight';
import type { ColumnFileVisibility } from '@/features/tables/types/table.types';

const VISIBILITY_OPTIONS: ReadonlyArray<{
  value: ColumnFileVisibility;
  label: string;
  description: string;
}> = [
  {
    value: 'private',
    label: '🔒 Private — только участники этого спейса',
    description: 'По умолчанию. Файл доступен только пользователям, входящим в space этой таблицы.',
  },
  {
    value: 'internal',
    label: '🔓 Internal — любой залогиненный в CRM',
    description: 'Файл доступен любому авторизованному пользователю CRM (требуется JWT).',
  },
  {
    value: 'public',
    label: '🌍 Public — открытая ссылка',
    description: 'Файл отдаётся без авторизации. Прямая ссылка работает в incognito.',
  },
];

const isVisibilityValue = (value: string): value is ColumnFileVisibility =>
  value === 'private' || value === 'internal' || value === 'public';

/**
 * Компонент настроек для колонок типа file
 * Поддерживает формулы {{column_key}} для prefix/suffix
 */
export const FileColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  allColumns = [],
}) => {
  const availableColumns = useMemo(() =>
    new Set(allColumns?.map(c => c.name) || []),
    [allColumns]
  );

  // ADR-0016 Phase 2: missing visibility on legacy columns falls back to 'private'.
  const visibility: ColumnFileVisibility = draft.config?.visibility ?? 'private';
  const visibilityHint = VISIBILITY_OPTIONS.find((opt) => opt.value === visibility)?.description;

  return (
    <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📎 Настройки файла
      </h4>

      <div className="p-3 bg-primary-50 dark:bg-primary-100 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
        <p className="text-primary-600 dark:text-primary-300">
          💡 Используйте <code className="bg-primary-100 dark:bg-primary-800 px-1 rounded">{'{{column_key}}'}</code> для подстановки значений из других колонок
        </p>
      </div>

      {/* ADR-0016 Phase 2: per-column visibility (private / internal / public). */}
      <div>
        <Select
          label="Кто видит файлы"
          value={visibility}
          onChange={(value) => {
            if (!isVisibilityValue(value)) return;
            setDraft((prev) => ({
              ...prev,
              config: {
                ...prev.config,
                visibility: value,
              },
            }));
          }}
          options={VISIBILITY_OPTIONS.map(({ value, label }) => ({ value, label }))}
        />
        {visibilityHint && (
          <p className="text-xs text-[var(--text-tertiary)] mt-1">{visibilityHint}</p>
        )}
      </div>

      <Select
        label="Формат сохранения (RAW)"
        value={draft.config?.file?.saveFormat ?? 'url'}
        onChange={(value) => setDraft(prev => ({
          ...prev,
          config: {
            ...prev.config,
            file: { ...prev.config?.file, saveFormat: value as 'url' | 'filename' | 'path' }
          }
        }))}
        options={[
          { label: '🔗 Полная ссылка (https://...)', value: 'url' },
          { label: '📄 Только имя файла (document.pdf)', value: 'filename' },
          { label: '📂 Путь + имя (/files/document.pdf)', value: 'path' }
        ]}
      />

      <div>
        <Input
          label="Формула (необязательно)"
          placeholder="{{folder}}/{{filename}}"
          value={draft.config?.file?.formula ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              file: { ...prev.config?.file, formula: event.target.value || undefined }
            }
          }))}
        />
        <TemplateHighlight text={draft.config?.file?.formula || ''} availableColumns={availableColumns} />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Если указана, значение ячейки игнорируется и вычисляется по формуле
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Input
            label="Префикс"
            placeholder="https://cdn.example.com/"
            value={draft.config?.file?.prefix ?? ''}
            onChange={(event) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                file: { ...prev.config?.file, prefix: event.target.value || undefined }
              }
            }))}
          />
          <TemplateHighlight text={draft.config?.file?.prefix || ''} availableColumns={availableColumns} />
        </div>

        <div>
          <Input
            label="Суффикс"
            placeholder="?v={{version}}"
            value={draft.config?.file?.suffix ?? ''}
            onChange={(event) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                file: { ...prev.config?.file, suffix: event.target.value || undefined }
              }
            }))}
          />
          <TemplateHighlight text={draft.config?.file?.suffix || ''} availableColumns={availableColumns} />
        </div>
      </div>

      {(draft.config?.file?.formula || draft.config?.file?.prefix || draft.config?.file?.suffix) && (
        <div className="p-2 bg-[var(--bg-tertiary)] rounded text-sm text-[var(--text-secondary)]">
          <span className="font-medium">Превью: </span>
          <span className="font-mono">
            {draft.config?.file?.prefix || ''}
            {draft.config?.file?.formula || '[файл]'}
            {draft.config?.file?.suffix || ''}
          </span>
        </div>
      )}

      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm border border-amber-200 dark:border-amber-800">
        <p className="font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2 mb-2">
          📋 Примеры использования
        </p>
        <div className="space-y-2 text-xs text-amber-700 dark:text-amber-300">
          <div>
            <span className="font-medium">CDN URL:</span>
            <div className="font-mono bg-amber-100 dark:bg-amber-800/50 px-2 py-1 rounded mt-1">
              prefix: https://cdn.site.com/ → https://cdn.site.com/image.jpg
            </div>
          </div>
          <div>
            <span className="font-medium">Версионирование:</span>
            <div className="font-mono bg-amber-100 dark:bg-amber-800/50 px-2 py-1 rounded mt-1">
              suffix: ?v={'{{version}}'} → file.pdf?v=1.2.3
            </div>
          </div>
          <div>
            <span className="font-medium">Динамический путь:</span>
            <div className="font-mono bg-amber-100 dark:bg-amber-800/50 px-2 py-1 rounded mt-1">
              formula: /uploads/{'{{category}}'}/{'{{filename}}'} → /uploads/docs/report.pdf
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
