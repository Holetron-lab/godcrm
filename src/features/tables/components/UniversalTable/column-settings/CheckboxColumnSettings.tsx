import React from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ColumnSettingsProps, renderTypeCellPreview } from './types';

/**
 * Компонент настроек для колонок типа checkbox
 */
export const CheckboxColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  firstRow,
}) => {
  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        ☑️ Настройки чекбокса
      </h4>

      <Select
        label="Стиль отображения"
        value={draft.config?.checkbox?.style ?? 'checkbox'}
        onChange={(value) => setDraft(prev => ({
          ...prev,
          config: {
            ...prev.config,
            checkbox: { ...prev.config?.checkbox, style: value as 'checkbox' | 'toggle' | 'emoji' }
          }
        }))}
        options={[
          { label: '☑️ Чекбокс', value: 'checkbox' },
          { label: '🔘 Переключатель', value: 'toggle' },
          { label: '✅ Эмодзи', value: 'emoji' }
        ]}
      />

      <div className="flex items-start gap-3">
        <div className="flex-1">
          <Input
            label="Значение TRUE"
            placeholder="1"
            value={String(draft.config?.checkbox?.trueValue ?? '1')}
            onChange={(event) => {
              const val = event.target.value;
              // Попытка распарсить как число
              const parsed = val === 'true' ? true : val === 'false' ? false : !isNaN(Number(val)) && val !== '' ? Number(val) : val;
              setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  checkbox: { ...prev.config?.checkbox, trueValue: parsed }
                }
              }));
            }}
          />
        </div>

        {draft.config?.checkbox?.style === 'emoji' && (
          <div className="flex-1">
            <Input
              label="Эмодзи TRUE"
              placeholder="✅"
              value={draft.config?.checkbox?.trueEmoji ?? '✅'}
              onChange={(event) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  checkbox: { ...prev.config?.checkbox, trueEmoji: event.target.value || '✅' }
                }
              }))}
            />
          </div>
        )}

        <div className="h-full flex items-center pt-6">
          <div className="w-px h-8 bg-[var(--border-color)]"></div>
        </div>

        <div className="flex-1">
          <Input
            label="Значение FALSE"
            placeholder="0"
            value={String(draft.config?.checkbox?.falseValue ?? '0')}
            onChange={(event) => {
              const val = event.target.value;
              const parsed = val === 'true' ? true : val === 'false' ? false : !isNaN(Number(val)) && val !== '' ? Number(val) : val;
              setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  checkbox: { ...prev.config?.checkbox, falseValue: parsed }
                }
              }));
            }}
          />
        </div>

        {draft.config?.checkbox?.style === 'emoji' && (
          <div className="flex-1">
            <Input
              label="Эмодзи FALSE"
              placeholder="⬜️"
              value={draft.config?.checkbox?.falseEmoji ?? '⬜️'}
              onChange={(event) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  checkbox: { ...prev.config?.checkbox, falseEmoji: event.target.value || '⬜️' }
                }
              }))}
            />
          </div>
        )}
      </div>

      <p className="text-xs text-[var(--text-tertiary)]">
        💡 Примеры: 1/0, true/false, да/нет, Y/N
      </p>
      <div className="flex items-center gap-4 p-3 rounded-lg bg-[var(--bg-tertiary)]">
        <span className="text-sm text-[var(--text-secondary)]">Превью:</span>
        <div className="flex items-center gap-2">
          {draft.config?.checkbox?.style === 'toggle' ? (
            <>
              <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-green-500">
                <span className="inline-block h-4 w-4 transform rounded-full bg-white translate-x-6" />
              </div>
              <span className="text-xs text-[var(--text-tertiary)]">= {String(draft.config?.checkbox?.trueValue ?? 1)}</span>
              <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-300 dark:bg-gray-600 ml-3">
                <span className="inline-block h-4 w-4 transform rounded-full bg-white translate-x-1" />
              </div>
              <span className="text-xs text-[var(--text-tertiary)]">= {String(draft.config?.checkbox?.falseValue ?? 0)}</span>
            </>
          ) : draft.config?.checkbox?.style === 'emoji' ? (
            <>
              <span className="text-xl">{draft.config?.checkbox?.trueEmoji || '✅'}</span>
              <span className="text-xs text-[var(--text-tertiary)]">= {String(draft.config?.checkbox?.trueValue ?? 1)}</span>
              <span className="text-xl ml-3">{draft.config?.checkbox?.falseEmoji || '⬜️'}</span>
              <span className="text-xs text-[var(--text-tertiary)]">= {String(draft.config?.checkbox?.falseValue ?? 0)}</span>
            </>
          ) : (
            <>
              <div className="h-5 w-5 rounded border-2 flex items-center justify-center bg-[var(--color-primary-500)] border-[var(--color-primary-500)]">
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-xs text-[var(--text-tertiary)]">= {String(draft.config?.checkbox?.trueValue ?? 1)}</span>
              <div className="h-5 w-5 rounded border-2 border-gray-400 dark:border-gray-500 ml-3" />
              <span className="text-xs text-[var(--text-tertiary)]">= {String(draft.config?.checkbox?.falseValue ?? 0)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
