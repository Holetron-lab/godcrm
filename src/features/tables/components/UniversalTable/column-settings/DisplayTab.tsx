/**
 * DisplayTab — Display settings tab for column configuration
 * Extracted from ColumnSettingsDrawer for modularity
 */
import React, { useState } from 'react';
import { Input, Select, Switch } from '@/shared/components/ui';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { EmojiPicker } from '../EmojiPicker';
import { getColumnMinMaxSize } from '@/features/tables/utils/columnSizing';
import { isSystemColumnId } from '@/features/tables/utils/systemColumns';
import type { TFunction } from './shared';

interface DisplayTabProps {
  draft: ColumnModel;
  setDraft: React.Dispatch<React.SetStateAction<ColumnModel | null>>;
  t: TFunction;
  keyEditEnabled: boolean;
  setKeyEditEnabled: (enabled: boolean) => void;
}

export const DisplayTab = ({ draft, setDraft, t, keyEditEnabled, setKeyEditEnabled }: DisplayTabProps) => {
  const indicator = draft?.config?.appearance?.indicator;
  const isSystem = isSystemColumnId(draft.id);

  return (
    <div className="space-y-4">
      {/* Row 1: Icon + Name + Color */}
      <div className="flex gap-3 items-end">
        <EmojiPicker
          value={indicator?.value ?? ''}
          onChange={(emoji) =>
            setDraft({
              ...draft,
              config: {
                ...draft.config,
                appearance: {
                  ...draft.config?.appearance,
                  indicator: {
                    ...(draft.config?.appearance?.indicator ?? { type: 'emoji' }),
                    value: emoji
                  }
                }
              }
            })
          }
          label={t('columnSettings.fields.icon')}
          size="md"
        />
        <div className="flex-1">
          <Input
            label={t('columnSettings.fields.columnName')}
            value={draft.displayName}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            placeholder={t('columnSettings.fields.enterName')}
          />
        </div>
        <div className="flex-shrink-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {t('colors.color')}
          </label>
          <div className="flex gap-1">
            <input
              type="color"
              value={draft.config?.appearance?.columnColor ?? '#6366f1'}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    appearance: {
                      ...draft.config?.appearance,
                      columnColor: event.target.value
                    }
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
                    appearance: {
                      ...draft.config?.appearance,
                      columnColor: undefined
                    }
                  }
                })
              }
              className="w-8 h-10 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Column Key with checkbox */}
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="flex items-center gap-3 mb-3">
          <svg className="w-4 h-4 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <span className="text-sm font-medium text-[var(--text-primary)]">{t('columnSettings.fields.columnKey')}</span>
          <div className="flex-1" />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={keyEditEnabled}
              onChange={(e) => setKeyEditEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--border-primary)] bg-[var(--bg-primary)] accent-[var(--color-primary-500)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">{t('columnSettings.fields.allowEditing')}</span>
          </label>
        </div>

        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
          placeholder="column_key"
          disabled={!keyEditEnabled}
          className="font-mono"
        />

        {keyEditEnabled && (
          <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-xs text-amber-400">
              {t('columnSettings.fields.keyChangeWarning')}
            </p>
          </div>
        )}
      </div>

      {/* Comment */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] mb-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          {t('columnSettings.fields.comment')}
        </label>
        <textarea
          value={draft.config?.comment ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              config: {
                ...draft.config,
                comment: e.target.value || undefined
              }
            })
          }
          placeholder={t('columnSettings.fields.commentPlaceholder')}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
        />
      </div>

      {/* Visibility & Header toggles */}
      <div className="flex gap-6">
        <div className="flex items-center gap-3">
          <Switch
            checked={draft.isVisible}
            onCheckedChange={(checked) => setDraft({ ...draft, isVisible: checked === true })}
          />
          <label className="text-sm text-[var(--text-secondary)]">{t('columnSettings.fields.visibleColumn')}</label>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={draft.config?.appearance?.showHeader !== false}
            onCheckedChange={(checked) =>
              setDraft({
                ...draft,
                config: {
                  ...draft.config,
                  appearance: {
                    ...draft.config?.appearance,
                    showHeader: checked === true
                  }
                }
              })
            }
          />
          <label className="text-sm text-[var(--text-secondary)]">{t('columnSettings.fields.showHeader')}</label>
        </div>
      </div>

      {/* Секция 2: Размеры и позиционирование */}
      <div className="space-y-3 pt-3 border-t border-[var(--border-primary)]">
        <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          {t('columnSettings.fields.sizePosition')}
        </div>
        <div className="flex gap-3 items-end">
          <div className="w-24 flex-shrink-0">
            <Input
              label={t('columnSettings.fields.order')}
              type="number"
              min={0}
              value={String(draft.orderIndex ?? 0)}
              onChange={(event) => setDraft({ ...draft, orderIndex: parseInt(event.target.value, 10) || 0 })}
            />
          </div>
          <div className="w-28 flex-shrink-0">
            <Select
              label={t('columnSettings.fields.alignment')}
              value={draft.config?.appearance?.align ?? 'left'}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    appearance: {
                      ...draft.config?.appearance,
                      align: value as 'left' | 'center' | 'right'
                    }
                  }
                })
              }
              options={[
                { label: t('columnSettings.fields.alignLeft'), value: 'left' },
                { label: t('columnSettings.fields.alignCenter'), value: 'center' },
                { label: t('columnSettings.fields.alignRight'), value: 'right' }
              ]}
            />
          </div>
          <div className="w-28 flex-shrink-0">
            {(() => {
              const { minSize, maxSize } = getColumnMinMaxSize(draft);
              return (
                <Input
                  label={t('columnSettings.fields.width')}
                  type="number"
                  min={minSize}
                  max={maxSize}
                  value={draft.width}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDraft({
                      ...draft,
                      width: Math.max(minSize, Math.min(maxSize, value || minSize))
                    });
                  }}
                />
              );
            })()}
          </div>
          <div className="flex-shrink-0">
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              {t('columnSettings.fields.textWrap')}
            </label>
            <Select
              value={draft.config?.cellFormat?.textWrap || 'nowrap'}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    cellFormat: {
                      ...draft.config?.cellFormat,
                      textWrap: value as 'nowrap' | 'wrap' | 'wrap-ellipsis'
                    }
                  }
                })
              }
              options={[
                { value: 'nowrap', label: t('columnSettings.fields.textWrapNowrap') },
                { value: 'wrap', label: t('columnSettings.fields.textWrapWrap') },
                { value: 'wrap-ellipsis', label: t('columnSettings.fields.textWrapEllipsis') }
              ]}
            />
          </div>
        </div>
      </div>

      {/* Секция 3: Behavior */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          {t('columnSettings.fields.behavior')}
        </div>
        <div className="flex gap-6">
          <div className="flex items-center gap-3">
            <Switch
              checked={draft.isRequired}
              onCheckedChange={(checked) => setDraft({ ...draft, isRequired: checked === true })}
            />
            <label className="text-sm text-[var(--text-secondary)]">{t('columnSettings.fields.requiredField')}</label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={isSystem ? true : draft.isReadonly}
              disabled={isSystem}
              onCheckedChange={(checked) => {
                if (isSystem) return; // locked on for system columns
                setDraft({ ...draft, isReadonly: checked === true });
              }}
            />
            <label className={`text-sm ${isSystem ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'}`}>
              {t('columnSettings.fields.readOnly')}
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
