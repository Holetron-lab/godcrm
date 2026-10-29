/**
 * TypographySettings - Настройки типографики ячейки
 * Извлечено из ColumnSettingsDrawer для модульности
 */

import React, { useId } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Select } from '@/shared/components/ui';
import type { ColumnSettingsProps } from './types';

export const TypographySettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft }) => {
  const { t } = useLanguage();
  const fieldId = useId();
  const appearance = draft.config?.appearance;
  const isBold = appearance?.fontWeight === 'bold';
  const isItalic = appearance?.fontStyle === 'italic';
  const isUnderline = appearance?.textDecoration === 'underline';

  const toggleClass = (active: boolean) =>
    `w-10 h-10 rounded-lg border flex items-center justify-center text-lg transition ${
      active
        ? 'bg-[var(--color-primary-500)] text-white border-[var(--color-primary-500)]'
        : 'border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'
    }`;

  const setAppearance = (patch: Record<string, string | undefined>) =>
    setDraft({
      ...draft,
      config: { ...draft.config, appearance: { ...appearance, ...patch } }
    });

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
        {t('columnSettings.typography.title')}
      </div>
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[150px]">
          <Select
            label={t('columnSettings.typography.font')}
            value={appearance?.fontFamily ?? 'default'}
            onChange={(value) => setAppearance({ fontFamily: value === 'default' ? undefined : value })}
            options={[
              { label: t('columnSettings.typography.fontDefault'), value: 'default' },
              { label: 'Inter', value: 'Inter, sans-serif' },
              { label: 'Roboto', value: 'Roboto, sans-serif' },
              { label: 'Open Sans', value: 'Open Sans, sans-serif' },
              { label: 'Montserrat', value: 'Montserrat, sans-serif' },
              { label: 'Mono', value: 'ui-monospace, monospace' }
            ]}
          />
        </div>
        <div className="w-24">
          <Select
            label={t('columnSettings.typography.size')}
            value={appearance?.fontSize ?? 'default'}
            onChange={(value) => setAppearance({ fontSize: value === 'default' ? undefined : value })}
            options={[
              { label: t('columnSettings.typography.sizeAuto'), value: 'default' },
              { label: '12px', value: '12px' },
              { label: '14px', value: '14px' },
              { label: '16px', value: '16px' },
              { label: '18px', value: '18px' }
            ]}
          />
        </div>
        <div className="flex-shrink-0">
          <label htmlFor={fieldId} className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {t('columnSettings.typography.color')}
          </label>
          <div className="flex gap-1">
            <input id={fieldId}
              type="color"
              value={appearance?.textColor ?? '#1f2937'}
              onChange={(e) => setAppearance({ textColor: e.target.value })}
              className="h-10 w-12 rounded-lg border border-[var(--border-primary)] cursor-pointer"
            />
            <button
              type="button"
              aria-label={t('columnSettings.typography.clearColor')}
              title={t('columnSettings.typography.clearColor')}
              onClick={() => setAppearance({ textColor: undefined })}
              className="w-8 h-10 text-xs border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Стили текста: жирный, курсив, подчёркивание */}
      <div className="flex gap-2">
        <button
          type="button"
          aria-label={t('columnSettings.typography.bold')}
          aria-pressed={isBold}
          title={t('columnSettings.typography.bold')}
          onClick={() => setAppearance({ fontWeight: isBold ? undefined : 'bold' })}
          className={`${toggleClass(isBold)} font-bold`}
        >
          B
        </button>
        <button
          type="button"
          aria-label={t('columnSettings.typography.italic')}
          aria-pressed={isItalic}
          title={t('columnSettings.typography.italic')}
          onClick={() => setAppearance({ fontStyle: isItalic ? undefined : 'italic' })}
          className={`${toggleClass(isItalic)} italic`}
        >
          I
        </button>
        <button
          type="button"
          aria-label={t('columnSettings.typography.underline')}
          aria-pressed={isUnderline}
          title={t('columnSettings.typography.underline')}
          onClick={() => setAppearance({ textDecoration: isUnderline ? undefined : 'underline' })}
          className={`${toggleClass(isUnderline)} underline`}
        >
          U
        </button>
      </div>
    </div>
  );
};
