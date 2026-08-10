import React, { useState } from 'react';
import { Select } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { ColumnSettingsProps } from './types';
import type { DateColumnConfig } from '@/features/tables/types/table.types';

type DateMode = 'date' | 'datetime' | 'month' | 'year' | 'week' | 'quarter';

/** Available date column modes (ADR-070) */
const DATE_MODES: Array<{ value: DateMode; icon: string }> = [
  { value: 'date', icon: '📅' },
  { value: 'datetime', icon: '📅⏰' },
  { value: 'month', icon: '🗓️' },
  { value: 'year', icon: '📆' },
  { value: 'week', icon: '📋' },
  { value: 'quarter', icon: 'Q' },
];

/** Display format options filtered by mode */
const DISPLAY_FORMATS_BY_MODE: Record<string, Array<{ label: string; value: string }>> = {
  date: [
    { label: '15 дек. 2025', value: 'default' },
    { label: '15 декабря 2025 г.', value: 'full' },
    { label: '15.12.2025', value: 'short' },
    { label: '2025-12-15', value: 'iso_date' },
    { label: '3 дня назад', value: 'relative' },
  ],
  datetime: [
    { label: '15 дек. 2025, 14:30', value: 'datetime_default' },
    { label: '15.12.2025 14:30', value: 'datetime_short' },
    { label: '2025-12-15 14:30:00', value: 'datetime_iso' },
    { label: '15 дек. 2025, 14:30:45', value: 'datetime_seconds' },
    { label: '3 дня назад', value: 'relative' },
    { label: '14:30', value: 'time_only' },
    { label: '14:30:45', value: 'time_seconds' },
  ],
  month: [
    { label: 'Декабрь 2025', value: 'default' },
    { label: 'Дек. 2025', value: 'short' },
    { label: '12.2025', value: 'numeric' },
    { label: '2025-12', value: 'iso' },
  ],
  year: [
    { label: '2025', value: 'default' },
    { label: '2025 г.', value: 'full' },
  ],
  week: [
    { label: 'Неделя 50, 2025', value: 'default' },
    { label: 'Нед. 50', value: 'short' },
    { label: '2025-W50', value: 'iso' },
    { label: '9-15 дек. 2025', value: 'range' },
  ],
  quarter: [
    { label: '4 квартал 2025', value: 'default' },
    { label: 'Q4 2025', value: 'short' },
    { label: '4/2025', value: 'numeric' },
  ],
};

/** Storage format options for date mode */
const DATE_STORAGE_FORMATS = [
  { label: 'ISO 8601 (YYYY-MM-DD)', value: 'iso' },
  { label: 'EU (DD.MM.YYYY)', value: 'eu' },
  { label: 'US (MM/DD/YYYY)', value: 'us' },
];

/** Storage format options for datetime mode */
const DATETIME_STORAGE_FORMATS = [
  { label: 'ISO 8601', value: 'iso' },
  { label: 'EU (DD.MM.YYYY HH:mm)', value: 'eu' },
  { label: 'US (MM/DD/YYYY HH:mm)', value: 'us' },
  { label: 'Unix Timestamp', value: 'unix' },
  { label: 'Unix (ms)', value: 'unix_ms' },
];

type ConvertState = 'idle' | 'confirm' | 'loading' | 'success' | 'error';

/**
 * Компонент настроек для колонок типа date/datetime
 * Режим (mode) определяет доступные форматы отображения и хранения (ADR-070)
 */
export const DateColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  tableId,
}) => {
  const { t } = useLanguage();
  const mode = (draft.config?.date?.mode ?? 'datetime') as DateMode;
  const displayTimezoneType = draft.config?.date?.displayTimezoneType ?? 'local';
  const storageFormat = draft.config?.date?.storageFormat ?? 'iso';
  const storageTimezone = draft.config?.date?.storageTimezone ?? 'utc';

  const [convertState, setConvertState] = useState<ConvertState>('idle');
  const [convertResult, setConvertResult] = useState<{ converted: number; failed: number } | null>(null);
  const [convertError, setConvertError] = useState<string>('');

  const getRawPreview = (): string => {
    const now = new Date('2025-12-12T14:30:45.123Z');

    switch (mode) {
      case 'date':
        if (storageFormat === 'eu') return '12.12.2025';
        if (storageFormat === 'us') return '12/12/2025';
        return '2025-12-12';
      case 'month':
        return '2025-12';
      case 'year':
        return '2025';
      case 'week':
        return '2025-W50';
      case 'quarter':
        return '2025-Q4';
      case 'datetime':
      default: {
        if (storageFormat === 'eu') return '12.12.2025 14:30:45';
        if (storageFormat === 'us') return '12/12/2025 14:30:45';
        if (storageFormat === 'unix') {
          return Math.floor(now.getTime() / 1000).toString();
        }
        if (storageFormat === 'unix_ms') {
          return now.getTime().toString();
        }
        if (storageTimezone === 'utc') {
          return now.toISOString();
        }
        if (storageTimezone === 'server') {
          const mskDate = new Date(now.getTime() + 3 * 60 * 60 * 1000);
          return mskDate.toISOString().replace('Z', '+03:00');
        }
        if (storageTimezone === 'browser') {
          return now.toISOString().replace('Z', '');
        }
        return now.toISOString();
      }
    }
  };

  const handleConvertToIso = async () => {
    if (!tableId || !draft.id) return;
    setConvertState('loading');
    setConvertError('');
    try {
      const result = await apiClient.post<{ converted: number; failed: number; skipped: number }>(
        `/api/v3/tables/${tableId}/columns/${draft.id}/convert-to-iso`
      );
      setConvertResult({ converted: result.converted, failed: result.failed });
      setConvertState('success');
      // Update draft to reflect new storageFormat
      setDraft(prev => ({
        ...prev,
        config: {
          ...prev.config,
          date: { ...prev.config?.date, storageFormat: 'iso' },
        },
      }));
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : 'Unknown error');
      setConvertState('error');
    }
  };

  const showFormatSelector = mode === 'date' || mode === 'datetime';
  const isEuOrUs = storageFormat === 'eu' || storageFormat === 'us';
  const displayFormats = DISPLAY_FORMATS_BY_MODE[mode] ?? DISPLAY_FORMATS_BY_MODE.datetime;

  return (
    <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)]">
        📅 {t('dateSettings.title')}
      </h4>

      {/* Mode selector (ADR-070) */}
      <div className="space-y-2">
        <h5 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          {t('dateSettings.mode')}
        </h5>
        <div className="flex flex-wrap gap-1">
          {DATE_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                setDraft(prev => ({
                  ...prev,
                  config: {
                    ...prev.config,
                    date: {
                      ...prev.config?.date,
                      mode: m.value,
                      displayFormat: 'default',
                    },
                  },
                }));
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                mode === m.value
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
              }`}
            >
              {m.icon} {t(`dateSettings.modes.${m.value}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Storage section */}
      <div className="space-y-2">
        <h5 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          {t('dateSettings.storage')}
        </h5>

        {showFormatSelector ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Select
                label={t('dateSettings.storageFormat')}
                value={storageFormat}
                onChange={(value) => {
                  setConvertState('idle');
                  setConvertResult(null);
                  setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      date: { ...prev.config?.date, storageFormat: value as DateColumnConfig['storageFormat'] }
                    }
                  }));
                }}
                options={mode === 'date' ? DATE_STORAGE_FORMATS : DATETIME_STORAGE_FORMATS}
              />
              {mode === 'datetime' && storageFormat === 'iso' ? (
                <Select
                  label={t('dateSettings.storageTz')}
                  value={storageTimezone}
                  onChange={(value) => setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      date: { ...prev.config?.date, storageTimezone: value as DateColumnConfig['storageTimezone'] }
                    }
                  }))}
                  options={[
                    { label: 'UTC', value: 'utc' },
                    { label: t('dateSettings.tzServer'), value: 'server' },
                    { label: t('dateSettings.tzLocal'), value: 'browser' },
                  ]}
                />
              ) : mode === 'datetime' && (storageFormat === 'unix' || storageFormat === 'unix_ms') ? (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">
                    {t('dateSettings.displayTz')}
                  </label>
                  <div className="h-[38px] px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-xs text-[var(--text-tertiary)] flex items-center">
                    {t('dateSettings.storageAlwaysUtc')}
                  </div>
                </div>
              ) : (
                <div />
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  {t('dateSettings.rawPreview')}
                </label>
                <div className="h-[38px] px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-xs text-[var(--text-primary)] flex items-center overflow-x-auto whitespace-nowrap">
                  {getRawPreview()}
                </div>
              </div>
            </div>

            {/* Warning for EU/US formats */}
            {isEuOrUs && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50">
                <span className="text-amber-500 mt-0.5">⚠</span>
                <div className="flex-1">
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    {t('dateSettings.storageFormatWarning')}
                  </p>

                  {/* Convert to ISO button */}
                  {tableId && draft.id && (
                    <div className="mt-2">
                      {convertState === 'idle' && (
                        <button
                          type="button"
                          onClick={() => setConvertState('confirm')}
                          className="text-xs px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                        >
                          {t('dateSettings.convertToIso')}
                        </button>
                      )}

                      {convertState === 'confirm' && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-amber-800 dark:text-amber-200">
                            {t('dateSettings.convertConfirm')}
                          </span>
                          <button
                            type="button"
                            onClick={handleConvertToIso}
                            className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                          >
                            {t('dateSettings.convertYes')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConvertState('idle')}
                            className="text-xs px-3 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
                          >
                            {t('dateSettings.picker.cancel')}
                          </button>
                        </div>
                      )}

                      {convertState === 'loading' && (
                        <span className="text-xs text-[var(--text-tertiary)] animate-pulse">
                          {t('dateSettings.convertLoading')}
                        </span>
                      )}

                      {convertState === 'success' && convertResult && (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          ✓ {t('dateSettings.convertSuccess').replace('{n}', String(convertResult.converted))}
                          {convertResult.failed > 0 && (
                            <span className="text-red-500 ml-2">
                              ({convertResult.failed} {t('dateSettings.convertFailed')})
                            </span>
                          )}
                        </span>
                      )}

                      {convertState === 'error' && (
                        <span className="text-xs text-red-500">
                          ✗ {t('dateSettings.convertError')}: {convertError}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* month/year/week/quarter — always ISO */
          <div className="flex flex-col gap-1">
            <div className="h-[38px] px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono text-xs text-[var(--text-primary)] flex items-center overflow-x-auto whitespace-nowrap">
              {getRawPreview()}
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">
              {t('dateSettings.storageAlwaysIso')}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-color)]" />

      {/* Display */}
      <div className="space-y-2">
        <h5 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          {t('dateSettings.display')}
        </h5>
        <div className="grid grid-cols-3 gap-3">
          <Select
            label={t('dateSettings.displayFormat')}
            value={draft.config?.date?.displayFormat ?? 'default'}
            onChange={(value) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                date: { ...prev.config?.date, displayFormat: value }
              }
            }))}
            options={displayFormats}
          />
          <Select
            label={t('dateSettings.displayTz')}
            value={displayTimezoneType}
            onChange={(value) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                date: { ...prev.config?.date, displayTimezoneType: value as DateColumnConfig['displayTimezoneType'] }
              }
            }))}
            options={[
              { label: t('dateSettings.tzLocal'), value: 'local' },
              { label: t('dateSettings.tzServer'), value: 'server' },
              { label: t('dateSettings.tzFixed'), value: 'fixed' },
            ]}
          />
          {displayTimezoneType === 'fixed' ? (
            <Select
              label={t('dateSettings.utcOffset')}
              value={draft.config?.date?.timezoneOffset ?? '+3'}
              onChange={(value) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  date: { ...prev.config?.date, timezoneOffset: value }
                }
              }))}
              options={[
                { label: 'UTC-12:00', value: '-12' },
                { label: 'UTC-8:00 (LA)', value: '-8' },
                { label: 'UTC-5:00 (NY)', value: '-5' },
                { label: 'UTC+0:00 (London)', value: '+0' },
                { label: 'UTC+1:00 (Paris)', value: '+1' },
                { label: 'UTC+2:00 (Kyiv)', value: '+2' },
                { label: 'UTC+3:00 (Moscow)', value: '+3' },
                { label: 'UTC+5:30 (India)', value: '+5.5' },
                { label: 'UTC+8:00 (Beijing)', value: '+8' },
                { label: 'UTC+9:00 (Tokyo)', value: '+9' },
                { label: 'UTC+10:00 (Sydney)', value: '+10' },
              ]}
            />
          ) : (
            <div /> /* Empty placeholder to maintain 3-column grid */
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border-color)]" />

      <p className="text-xs text-[var(--text-tertiary)]">
        💡 {t('dateSettings.hint')}
      </p>
    </div>
  );
};
