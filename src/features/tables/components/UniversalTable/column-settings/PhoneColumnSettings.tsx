import React from 'react';
import { Select, Input } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';

type PhoneDisplayFormat = 'full' | 'national' | 'international' | 'masked';

const displayFormats: Array<{ value: PhoneDisplayFormat; label: string; example: string; icon: string }> = [
  { value: 'full', label: 'Как есть', example: '+79001234567', icon: '📱' },
  { value: 'national', label: 'Национальный', example: '8 (900) 123-45-67', icon: '🇷🇺' },
  { value: 'international', label: 'Международный', example: '+7 900 123-45-67', icon: '🌍' },
  { value: 'masked', label: 'Скрытый', example: '+7 *** ***-**-67', icon: '🔒' },
];

type DefaultCountry = 'ru' | 'us' | 'uk' | 'de' | 'auto';

const countries: Array<{ value: DefaultCountry; label: string; code: string }> = [
  { value: 'ru', label: 'Россия', code: '+7' },
  { value: 'us', label: 'США', code: '+1' },
  { value: 'uk', label: 'Великобритания', code: '+44' },
  { value: 'de', label: 'Германия', code: '+49' },
  { value: 'auto', label: 'Автоопределение', code: '' },
];

/**
 * Компонент настроек для колонок типа phone
 */
export const PhoneColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  firstRow,
}) => {
  const phoneConfig = draft.config?.phone || {};

  const updateConfig = (updates: Partial<typeof phoneConfig>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        phone: { ...phoneConfig, ...updates }
      }
    }));
  };

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📱 Настройки телефона
      </h4>

      {/* Формат отображения */}
      <fieldset>
        <legend className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          Формат отображения
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {displayFormats.map(format => (
            <button
              key={format.value}
              type="button"
              onClick={() => updateConfig({ displayFormat: format.value })}
              className={`p-3 rounded-lg border text-left transition-all ${
                (phoneConfig.displayFormat || 'full') === format.value
                  ? 'border-green-500 bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span>{format.icon}</span>
                <span className="font-medium text-sm">{format.label}</span>
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-mono">{format.example}</div>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Страна по умолчанию */}
      <Select
        label="Страна по умолчанию"
        value={phoneConfig.defaultCountry || 'ru'}
        onChange={(value) => updateConfig({ defaultCountry: value as DefaultCountry })}
        options={countries.map(c => ({
          value: c.value,
          label: `${c.label} ${c.code ? `(${c.code})` : ''}`
        }))}
      />

      {/* Дополнительные опции */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={phoneConfig.showCallButton !== false}
            onChange={(e) => updateConfig({ showCallButton: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Показывать кнопку &quot;Позвонить&quot;</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={phoneConfig.showWhatsApp === true}
            onChange={(e) => updateConfig({ showWhatsApp: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Показывать кнопку WhatsApp</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={phoneConfig.showTelegram === true}
            onChange={(e) => updateConfig({ showTelegram: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Показывать кнопку Telegram</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={phoneConfig.copyOnClick === true}
            onChange={(e) => updateConfig({ copyOnClick: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Копировать по клику</span>
        </label>
      </div>

      {/* Превью */}
      <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-secondary)]">
        <p className="text-xs text-[var(--text-tertiary)] mb-2">Превью:</p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-primary)]">
            {phoneConfig.displayFormat === 'national' ? '8 (900) 123-45-67' :
             phoneConfig.displayFormat === 'international' ? '+7 900 123-45-67' :
             phoneConfig.displayFormat === 'masked' ? '+7 *** ***-**-67' :
             '+79001234567'}
          </span>
          <div className="flex gap-1">
            {phoneConfig.showCallButton !== false && (
              <button className="p-1 rounded bg-green-500/10 text-green-500 text-xs">📞</button>
            )}
            {phoneConfig.showWhatsApp && (
              <button className="p-1 rounded bg-green-500/10 text-green-600 text-xs">💬</button>
            )}
            {phoneConfig.showTelegram && (
              <button className="p-1 rounded bg-primary-50 text-primary-500 text-xs">✈️</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
