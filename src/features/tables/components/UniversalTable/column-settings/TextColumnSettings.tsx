import React, { useId, useMemo } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Input } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';
import { TemplateHighlight } from './TemplateHighlight';

export const TextColumnSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft, allColumns }) => {
  const { t } = useLanguage();
  const fieldId = useId();
  const availableColumns = useMemo(() =>
    new Set(allColumns?.map(c => c.name) || []),
    [allColumns]
  );

  return (
    <div className="space-y-4 p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📝 {t('columnSettings.text.title')}
      </h4>

      <div className="p-3 bg-primary-50 dark:bg-primary-900 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
        <p className="text-primary-600 dark:text-primary-300">
          💡 {t('columnSettings.text.templateBefore')} <code className="bg-primary-100 dark:bg-primary-800 px-1 rounded">{'{{column_key}}'}</code> {t('columnSettings.text.templateAfter')}
        </p>
      </div>

      <div>
        <Input
          id={`${fieldId}-formula`}
          label={t('columnSettings.text.formula')}
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
          {t('columnSettings.text.formulaHint')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Input
            id={`${fieldId}-prefix`}
            label={t('columnSettings.text.prefix')}
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
            id={`${fieldId}-suffix`}
            label={t('columnSettings.text.suffix')}
            placeholder={t('columnSettings.text.suffixPlaceholder')}
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
          <span className="font-medium">{t('columnSettings.text.preview')}: </span>
          <span className="font-mono">
            {draft.config?.text?.prefix || ''}
            {draft.config?.text?.formula || t('columnSettings.text.placeholder')}
            {draft.config?.text?.suffix || ''}
          </span>
        </div>
      )}
    </div>
  );
};
