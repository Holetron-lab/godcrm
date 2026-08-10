/**
 * TypographySettings - Настройки типографики ячейки
 * Извлечено из ColumnSettingsDrawer для модульности
 */

import React from 'react';
import { Select } from '@/shared/components/ui';
import type { ColumnSettingsProps } from './types';

export const TypographySettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft }) => {
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
        Типографика
      </div>
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[150px]">
          <Select
            label="Шрифт"
            value={draft.config?.appearance?.fontFamily ?? 'default'}
            onChange={(value) =>
              setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  appearance: {
                    ...draft.config?.appearance,
                    fontFamily: value === 'default' ? undefined : value
                  }
                }
              })
            }
            options={[
              { label: 'По умолчанию', value: 'default' },
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
            label="Размер"
            value={draft.config?.appearance?.fontSize ?? 'default'}
            onChange={(value) =>
              setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  appearance: {
                    ...draft.config?.appearance,
                    fontSize: value === 'default' ? undefined : value
                  }
                }
              })
            }
            options={[
              { label: 'Авто', value: 'default' },
              { label: '12px', value: '12px' },
              { label: '14px', value: '14px' },
              { label: '16px', value: '16px' },
              { label: '18px', value: '18px' }
            ]}
          />
        </div>
        <div className="flex-shrink-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Цвет</label>
          <div className="flex gap-1">
            <input
              type="color"
              value={draft.config?.appearance?.textColor ?? '#1f2937'}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    appearance: { ...draft.config?.appearance, textColor: e.target.value }
                  }
                })
              }
              className="h-10 w-12 rounded-lg border border-[var(--border-primary)] cursor-pointer"
            />
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    appearance: { ...draft.config?.appearance, textColor: undefined }
                  }
                })
              }
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
          onClick={() =>
            setDraft({
              ...draft,
              config: {
                ...draft.config,
                appearance: {
                  ...draft.config?.appearance,
                  fontWeight: draft.config?.appearance?.fontWeight === 'bold' ? undefined : 'bold'
                }
              }
            })
          }
          className={`w-10 h-10 rounded-lg border flex items-center justify-center font-bold text-lg transition ${
            draft.config?.appearance?.fontWeight === 'bold'
              ? 'bg-[var(--color-primary-500)] text-white border-[var(--color-primary-500)]'
              : 'border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'
          }`}
          title="Жирный"
        >
          B
        </button>
        <button
          type="button"
          onClick={() =>
            setDraft({
              ...draft,
              config: {
                ...draft.config,
                appearance: {
                  ...draft.config?.appearance,
                  fontStyle: draft.config?.appearance?.fontStyle === 'italic' ? undefined : 'italic'
                }
              }
            })
          }
          className={`w-10 h-10 rounded-lg border flex items-center justify-center italic text-lg transition ${
            draft.config?.appearance?.fontStyle === 'italic'
              ? 'bg-[var(--color-primary-500)] text-white border-[var(--color-primary-500)]'
              : 'border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'
          }`}
          title="Курсив"
        >
          I
        </button>
        <button
          type="button"
          onClick={() =>
            setDraft({
              ...draft,
              config: {
                ...draft.config,
                appearance: {
                  ...draft.config?.appearance,
                  textDecoration: draft.config?.appearance?.textDecoration === 'underline' ? undefined : 'underline'
                }
              }
            })
          }
          className={`w-10 h-10 rounded-lg border flex items-center justify-center underline text-lg transition ${
            draft.config?.appearance?.textDecoration === 'underline'
              ? 'bg-[var(--color-primary-500)] text-white border-[var(--color-primary-500)]'
              : 'border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'
          }`}
          title="Подчёркивание"
        >
          U
        </button>
      </div>
    </div>
  );
};
