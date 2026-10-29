/**
 * CellFormatSettings - Настройки формата содержимого ячейки
 * Извлечено из ColumnSettingsDrawer для модульности
 */

import React, { useId } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Select } from '@/shared/components/ui';
import type { ColumnSettingsProps } from './types';

export const CellFormatSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft }) => {
  const { t } = useLanguage();
  const fieldId = useId();
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
        {t('columnSettings.cell.format')}
      </div>
      <Select
        label={t('columnSettings.cell.displayMode')}
        value={draft.config?.cellFormat?.mode ?? 'text'}
        onChange={(value) =>
          setDraft({
            ...draft,
            config: {
              ...draft.config,
              cellFormat: {
                ...draft.config?.cellFormat,
                mode: value as 'text' | 'markdown' | 'html' | 'formula'
              }
            }
          })
        }
        options={[
          { label: t('columnSettings.cell.modeText'), value: 'text' },
          { label: t('columnSettings.cell.modeMarkdown'), value: 'markdown' },
          { label: t('columnSettings.cell.modeHtml'), value: 'html' },
          { label: t('columnSettings.cell.modeFormula'), value: 'formula' }
        ]}
      />

      {draft.config?.cellFormat?.mode === 'markdown' && (
        <div className="p-3 bg-primary-50 dark:bg-primary-900 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
          <p className="text-primary-600 dark:text-primary-300">
            {t('columnSettings.cell.markdownHint')}
          </p>
        </div>
      )}

      {draft.config?.cellFormat?.mode === 'html' && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm border border-amber-200 dark:border-amber-800">
          <p className="text-amber-600 dark:text-amber-300">
            {t('columnSettings.cell.htmlHint')}
          </p>
        </div>
      )}

      {draft.config?.cellFormat?.mode === 'formula' && (
        <div className="space-y-3">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-sm border border-purple-200 dark:border-purple-800">
            <p className="font-medium text-purple-700 dark:text-purple-300">{t('columnSettings.cell.formulaTitle')}</p>
            <p className="text-purple-600 dark:text-purple-400 mt-1">
              {t('columnSettings.cell.formulaDescription')}
            </p>
          </div>

          <div>
            <label htmlFor={fieldId} className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              {t('columnSettings.cell.formulaLabel')}
            </label>
            <textarea id={fieldId}
              className="w-full h-32 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm font-mono resize-y"
              placeholder={t('columnSettings.cell.formulaPlaceholder')}
              value={draft.config?.cellFormat?.formula ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    cellFormat: {
                      ...draft.config?.cellFormat,
                      formula: e.target.value
                    }
                  }
                })
              }
            />
          </div>

          <div className="text-xs text-[var(--text-tertiary)] space-y-1">
            <p>{t('columnSettings.cell.examples')}</p>
            <code className="block bg-[var(--bg-tertiary)] p-2 rounded">row.price * row.quantity</code>
            <code className="block bg-[var(--bg-tertiary)] p-2 rounded">{'{{employees.salary}} * 0.13'}</code>
            <code className="block bg-[var(--bg-tertiary)] p-2 rounded">row.status === &apos;active&apos; ? &apos;✅&apos; : &apos;❌&apos;</code>
          </div>
        </div>
      )}
    </div>
  );
};
