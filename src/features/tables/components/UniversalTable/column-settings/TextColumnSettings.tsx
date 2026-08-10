import React from 'react';
import { Input } from '@/shared/components/ui';
import { ColumnSettingsProps, renderTypeCellPreview } from './types';
import { TemplateHighlight } from './TemplateHighlight';
import { useMemo } from 'react';

export const TextColumnSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft, allColumns, firstRow }) => {
  const availableColumns = useMemo(() => 
    new Set(allColumns?.map(c => c.name) || []), 
    [allColumns]
  );

  return (
    <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📝 Настройки текста
      </h4>
      
      <div className="p-3 bg-primary-50 dark:bg-primary-100 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
        <p className="text-primary-600 dark:text-primary-300">
          💡 Используйте <code className="bg-primary-100 dark:bg-primary-800 px-1 rounded">{'{{column_key}}'}</code> для подстановки значений из других колонок
        </p>
      </div>
      
      <div>
        <Input
          label="Формула (необязательно)"
          placeholder="{{name}} - {{code}}"
          value={draft.config?.text?.formula ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              text: { ...prev.config?.text, formula: event.target.value || undefined }
            }
          }))}
        />
        <TemplateHighlight text={draft.config?.text?.formula || ''} availableColumns={availableColumns} />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Если указана, значение ячейки игнорируется и вычисляется по формуле
        </p>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Input
            label="Префикс"
            placeholder="№ "
            value={draft.config?.text?.prefix ?? ''}
            onChange={(event) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                text: { ...prev.config?.text, prefix: event.target.value || undefined }
              }
            }))}
          />
        </div>
        
        <div>
          <Input
            label="Суффикс"
            placeholder=" шт."
            value={draft.config?.text?.suffix ?? ''}
            onChange={(event) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                text: { ...prev.config?.text, suffix: event.target.value || undefined }
              }
            }))}
          />
        </div>
      </div>
      
      {(draft.config?.text?.formula || draft.config?.text?.prefix || draft.config?.text?.suffix) && (
        <div className="p-2 bg-[var(--bg-tertiary)] rounded text-sm text-[var(--text-secondary)]">
          <span className="font-medium">Превью: </span>
          <span className="font-mono">
            {draft.config?.text?.prefix || ''}
            {draft.config?.text?.formula || '[значение]'}
            {draft.config?.text?.suffix || ''}
          </span>
        </div>
      )}
    </div>
  );
};
