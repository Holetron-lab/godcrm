import React from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';

type PasswordDisplayFormat = 'dots' | 'asterisks' | 'hidden' | 'length';

const displayFormats: Array<{ value: PasswordDisplayFormat; label: string; example: string; icon: string }> = [
  { value: 'dots', label: 'Точки', example: '••••••••', icon: '⚫' },
  { value: 'asterisks', label: 'Звёздочки', example: '********', icon: '✳️' },
  { value: 'hidden', label: 'Скрыто', example: '[пароль скрыт]', icon: '🔒' },
  { value: 'length', label: 'Длина', example: '8 символов', icon: '📏' },
];

/**
 * Компонент настроек для колонок типа password
 */
export const PasswordColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  firstRow,
}) => {
  const passwordConfig = draft.config?.password || {};

  const updateConfig = (updates: Partial<typeof passwordConfig>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        password: { ...passwordConfig, ...updates }
      }
    }));
  };

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🔐 Настройки пароля
      </h4>

      <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm border border-yellow-200 dark:border-yellow-800">
        <p className="text-yellow-600 dark:text-yellow-300">
          ⚠️ Пароли отображаются скрыто. Используйте кнопку "показать" для просмотра.
        </p>
      </div>

      {/* Формат отображения */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          Формат отображения
        </label>
        <div className="grid grid-cols-2 gap-2">
          {displayFormats.map(format => (
            <button
              key={format.value}
              type="button"
              onClick={() => updateConfig({ displayFormat: format.value })}
              className={`p-3 rounded-lg border text-left transition-all ${
                (passwordConfig.displayFormat || 'dots') === format.value
                  ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400'
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

      {/* Требования к паролю */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-[var(--text-primary)]">
          Требования к паролю
        </label>
        
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Мин. длина"
            type="number"
            min={1}
            max={100}
            value={passwordConfig.minLength || 8}
            onChange={(e) => updateConfig({ minLength: parseInt(e.target.value) || 8 })}
          />
          <Input
            label="Макс. длина"
            type="number"
            min={1}
            max={256}
            value={passwordConfig.maxLength || 128}
            onChange={(e) => updateConfig({ maxLength: parseInt(e.target.value) || 128 })}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={passwordConfig.requireUppercase === true}
              onChange={(e) => updateConfig({ requireUppercase: e.target.checked })}
              className="rounded border-[var(--border-primary)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">Требовать заглавные буквы (A-Z)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={passwordConfig.requireLowercase === true}
              onChange={(e) => updateConfig({ requireLowercase: e.target.checked })}
              className="rounded border-[var(--border-primary)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">Требовать строчные буквы (a-z)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={passwordConfig.requireNumbers === true}
              onChange={(e) => updateConfig({ requireNumbers: e.target.checked })}
              className="rounded border-[var(--border-primary)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">Требовать цифры (0-9)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={passwordConfig.requireSpecial === true}
              onChange={(e) => updateConfig({ requireSpecial: e.target.checked })}
              className="rounded border-[var(--border-primary)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">Требовать спецсимволы (!@#$%)</span>
          </label>
        </div>
      </div>

      {/* Опции отображения */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--text-primary)]">
          Опции отображения
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={passwordConfig.showToggle !== false}
            onChange={(e) => updateConfig({ showToggle: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Кнопка "Показать/Скрыть"</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={passwordConfig.showCopy === true}
            onChange={(e) => updateConfig({ showCopy: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Кнопка "Копировать"</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={passwordConfig.showGenerator === true}
            onChange={(e) => updateConfig({ showGenerator: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Кнопка "Сгенерировать"</span>
        </label>
      </div>

      {/* Превью */}
      <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-secondary)]">
        <p className="text-xs text-[var(--text-tertiary)] mb-2">Превью:</p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-primary)] font-mono">
            {passwordConfig.displayFormat === 'asterisks' ? '********' :
             passwordConfig.displayFormat === 'hidden' ? '[пароль скрыт]' :
             passwordConfig.displayFormat === 'length' ? '8 символов' :
             '••••••••'}
          </span>
          <div className="flex gap-1">
            {passwordConfig.showToggle !== false && (
              <button className="p-1 rounded bg-gray-500/10 text-gray-500 text-xs">👁️</button>
            )}
            {passwordConfig.showCopy && (
              <button className="p-1 rounded bg-primary-50 text-primary-500 text-xs">📋</button>
            )}
            {passwordConfig.showGenerator && (
              <button className="p-1 rounded bg-purple-500/10 text-purple-500 text-xs">🎲</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
