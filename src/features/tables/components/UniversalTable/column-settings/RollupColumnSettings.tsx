import React, { useId, useMemo } from 'react';
import { Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ColumnSettingsProps } from './types';
import { TemplateHighlight } from './TemplateHighlight';
import { Plus, Trash2 } from 'lucide-react';

interface RollupField {
  id: string;
  label: string;
  formula: string;
  prefix?: string;
  suffix?: string;
}

export const RollupColumnSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft, allColumns }) => {
  const { t } = useLanguage();
  const id = useId();
  const fields: RollupField[] = draft.config?.rollup?.fields || [];
  
  const availableColumns = useMemo(() => 
    new Set(allColumns?.map(c => c.name) || []), 
    [allColumns]
  );

  const updateConfig = (updates: Partial<{ fields: RollupField[] }>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        rollup: { ...prev.config?.rollup, ...updates }
      }
    }));
  };

  const addField = () => {
    const newField: RollupField = {
      id: `field_${Date.now()}`,
      label: '',
      formula: ''
    };
    updateConfig({ fields: [...fields, newField] });
  };

  const updateField = (id: string, updates: Partial<RollupField>) => {
    updateConfig({
      fields: fields.map(f => f.id === id ? { ...f, ...updates } : f)
    });
  };

  const removeField = (id: string) => {
    updateConfig({ fields: fields.filter(f => f.id !== id) });
  };

  return (
    <div className="space-y-4 p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📊 {t('columnSettings.rollup.title')}
      </h4>
      
      <div className="p-3 bg-primary-50 dark:bg-primary-900 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
        <p className="text-primary-600 dark:text-primary-300">
          💡 {t('columnSettings.text.templateBefore')} <code className="bg-primary-100 dark:bg-primary-800 px-1 rounded">{'{{column_key}}'}</code> {t('columnSettings.text.templateAfter')}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-medium text-[var(--text-secondary)]">
            {t('columnSettings.rollup.fields')}
          </h5>
          <button
            type="button"
            onClick={addField}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 dark:bg-primary-100 dark:hover:bg-primary-200 rounded transition-colors"
          >
            <Plus size={14} />
            {t('columnSettings.rollup.addField')}
          </button>
        </div>

        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)] space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex items-center justify-center w-6 h-6 rounded bg-[var(--bg-primary)] text-xs font-medium text-[var(--text-secondary)] flex-shrink-0 mt-1">
                  {index + 1}
                </div>
                
                <div className="flex-1 space-y-2">
                  <div>
                    <label htmlFor={`${id}-${field.id}-label`} className="text-xs text-[var(--text-tertiary)] mb-1 block">{t('columnSettings.rollup.name')}</label>
                    <Input
                      id={`${id}-${field.id}-label`}
                      placeholder={t('columnSettings.rollup.namePlaceholder')}
                      value={field.label}
                      onChange={(e) => updateField(field.id, { label: e.target.value })}
                    />
                  </div>
                  
                  <div>
                    <label htmlFor={`${id}-${field.id}-formula`} className="text-xs text-[var(--text-tertiary)] mb-1 block">{t('columnSettings.rollup.formula')}</label>
                    <Input
                      id={`${id}-${field.id}-formula`}
                      placeholder="{{column_key}}"
                      value={field.formula}
                      onChange={(e) => updateField(field.id, { formula: e.target.value })}
                    />
                    <TemplateHighlight text={field.formula} availableColumns={availableColumns} />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`${id}-${field.id}-prefix`} className="text-xs text-[var(--text-tertiary)] mb-1 block">{t('columnSettings.text.prefix')}</label>
                      <Input
                        id={`${id}-${field.id}-prefix`}
                        placeholder="$ "
                        value={field.prefix || ''}
                        onChange={(e) => updateField(field.id, { prefix: e.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${id}-${field.id}-suffix`} className="text-xs text-[var(--text-tertiary)] mb-1 block">{t('columnSettings.text.suffix')}</label>
                      <Input
                        id={`${id}-${field.id}-suffix`}
                        placeholder={t('columnSettings.text.suffixPlaceholder')}
                        value={field.suffix || ''}
                        onChange={(e) => updateField(field.id, { suffix: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={t('columnSettings.rollup.removeField', { number: index + 1 })}
                  onClick={() => removeField(field.id)}
                  className="p-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {fields.length === 0 && (
            <div className="p-4 text-center text-sm text-[var(--text-tertiary)] border-2 border-dashed border-[var(--border-secondary)] rounded-lg">
              {t('columnSettings.rollup.empty')}
            </div>
          )}
        </div>
      </div>
      
      {fields.length > 0 && (
        <div className="p-2 bg-[var(--bg-tertiary)] rounded text-sm">
          <span className="font-medium text-[var(--text-secondary)]">{t('columnSettings.text.preview')}: </span>
          <div className="mt-1 space-y-0.5">
            {fields.map((field, index) => (
              <div key={index} className="text-xs">
                <span className="text-[var(--text-tertiary)]">{field.label || t('columnSettings.rollup.field', { number: index + 1 })}:</span>{' '}
                <span className="font-mono text-[var(--text-primary)]">
                  {field.prefix || ''}{field.formula || '—'}{field.suffix || ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
