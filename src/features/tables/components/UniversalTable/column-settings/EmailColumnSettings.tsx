import React, { useId } from 'react';
import { Select } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';

type EmailDisplayFormat = 'full' | 'link' | 'masked' | 'domain';

const displayFormats: Array<{ value: EmailDisplayFormat; label: string; example: string; icon: string }> = [
  { value: 'full', label: 'Полный адрес', example: 'user@example.com', icon: '📧' },
  { value: 'link', label: 'Кликабельная ссылка', example: 'user@example.com →', icon: '🔗' },
  { value: 'masked', label: 'Скрытый', example: 'u***@e***.com', icon: '🔒' },
  { value: 'domain', label: 'Только домен', example: '@example.com', icon: '🌐' },
];

/**
 * Компонент настроек для колонок типа email
 */
export const EmailColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  firstRow,
}) => {
  const fieldId = useId();
  const emailConfig = draft.config?.email || {};

  const updateConfig = (updates: Partial<typeof emailConfig>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        email: { ...emailConfig, ...updates }
      }
    }));
  };

  // Пример значения для превью
  const exampleEmail = firstRow?.[draft.name] || firstRow?.[draft.id] || 'user@example.com';

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📧 Настройки Email
      </h4>

      {/* Формат отображения */}
      <div role="group" aria-labelledby={`${fieldId}-label-0`}>
        <span id={`${fieldId}-label-0`} className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          Формат отображения
        </span>
        <div className="grid grid-cols-2 gap-2">
          {displayFormats.map(format => (
            <button
              key={format.value}
              type="button"
              onClick={() => updateConfig({ displayFormat: format.value })}
              className={`p-3 rounded-lg border text-left transition-all ${
                (emailConfig.displayFormat || 'full') === format.value
                  ? 'border-primary-500 bg-primary-50 text-primary-600 dark:text-primary-400'
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
      </div>

      {/* Дополнительные опции */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={emailConfig.showMailtoButton !== false}
            onChange={(e) => updateConfig({ showMailtoButton: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Показывать кнопку &quot;Написать&quot;</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={emailConfig.copyOnClick === true}
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
          {emailConfig.displayFormat === 'masked' ? (
            <span className="text-sm text-[var(--text-primary)]">u***@e***.com</span>
          ) : emailConfig.displayFormat === 'domain' ? (
            <span className="text-sm text-[var(--text-primary)]">@example.com</span>
          ) : (
            <span className="text-sm text-primary-500">
              {String(exampleEmail)}
            </span>
          )}
          {emailConfig.showMailtoButton !== false && (
            <button className="p-1 rounded bg-primary-50 text-primary-500 text-xs">✉️</button>
          )}
        </div>
      </div>
    </div>
  );
};
