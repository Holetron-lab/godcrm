import React, { useId } from 'react';
import { Select, Input } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';

type PersonDisplayFormat = 'name' | 'avatar' | 'avatarName' | 'email' | 'card';

const displayFormats: Array<{ value: PersonDisplayFormat; label: string; description: string; icon: string }> = [
  { value: 'name', label: 'Только имя', description: 'Иван Петров', icon: '👤' },
  { value: 'avatar', label: 'Только аватар', description: 'Круглая иконка', icon: '🔵' },
  { value: 'avatarName', label: 'Аватар + Имя', description: '🔵 Иван Петров', icon: '👤' },
  { value: 'email', label: 'Имя и Email', description: 'Иван • ivan@...', icon: '📧' },
  { value: 'card', label: 'Карточка', description: 'Полная информация', icon: '🪪' },
];

/**
 * Компонент настроек для колонок типа person
 */
export const PersonColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  allColumns = [],
  firstRow,
}) => {
  const fieldId = useId();
  const personConfig = draft.config?.person || {};

  const updateConfig = (updates: Partial<typeof personConfig>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        person: { ...personConfig, ...updates }
      }
    }));
  };

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        👤 Настройки пользователя
      </h4>

      <div className="p-3 bg-primary-50 dark:bg-primary-900 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
        <p className="text-primary-600 dark:text-primary-300">
          💡 Колонка &quot;Пользователь&quot; связывает запись с пользователем системы или таблицей пользователей.
        </p>
      </div>

      {/* Источник данных */}
      <Select
        label="Источник пользователей"
        value={personConfig.source || 'system'}
        onChange={(value) => updateConfig({ source: value })}
        options={[
          { value: 'system', label: '🔐 Системные пользователи' },
          { value: 'table', label: '📋 Из таблицы' },
          { value: 'manual', label: '✏️ Ручной ввод' },
        ]}
      />

      {personConfig.source === 'table' && (
        <>
          <Input id={`${fieldId}-input-1`}
            label="ID таблицы пользователей"
            placeholder="users_table_id"
            value={personConfig.usersTableId || ''}
            onChange={(e) => updateConfig({ usersTableId: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input id={`${fieldId}-input-2`}
              label="Колонка ID"
              placeholder="id"
              value={personConfig.idColumn || 'id'}
              onChange={(e) => updateConfig({ idColumn: e.target.value })}
            />
            <Input id={`${fieldId}-input-3`}
              label="Колонка имени"
              placeholder="name"
              value={personConfig.nameColumn || 'name'}
              onChange={(e) => updateConfig({ nameColumn: e.target.value })}
            />
          </div>
        </>
      )}

      {/* Формат отображения */}
      <fieldset className="min-w-0">
        <legend className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          Формат отображения
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {displayFormats.map(format => (
            <button aria-pressed={(personConfig.displayFormat || 'avatarName') === format.value}
              key={format.value}
              type="button"
              onClick={() => updateConfig({ displayFormat: format.value })}
              className={`p-3 rounded-lg border text-left transition-all ${
                (personConfig.displayFormat || 'avatarName') === format.value
                  ? 'border-primary-500 bg-primary-50 text-primary-600 dark:text-primary-400'
                  : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span>{format.icon}</span>
                <span className="font-medium text-sm">{format.label}</span>
              </div>
              <div className="text-xs text-[var(--text-tertiary)]">{format.description}</div>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Дополнительные опции */}
      <fieldset className="min-w-0 space-y-2">
        <legend className="block text-sm font-medium text-[var(--text-primary)]">
          Опции
        </legend>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={personConfig.showOnlineStatus === true}
            onChange={(e) => updateConfig({ showOnlineStatus: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Показывать статус онлайн</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={personConfig.clickToProfile !== false}
            onChange={(e) => updateConfig({ clickToProfile: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Клик открывает профиль</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={personConfig.allowMultiple === true}
            onChange={(e) => updateConfig({ allowMultiple: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Разрешить несколько пользователей</span>
        </label>
      </fieldset>

      {/* Превью */}
      <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-secondary)]">
        <p className="text-xs text-[var(--text-tertiary)] mb-2">Превью:</p>
        <div className="flex items-center gap-2">
          {(personConfig.displayFormat === 'avatar' || personConfig.displayFormat === 'avatarName' || personConfig.displayFormat === 'card') && (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
              ИП
            </div>
          )}
          {personConfig.displayFormat !== 'avatar' && (
            <div>
              <div className="text-sm text-[var(--text-primary)] font-medium flex items-center gap-1">
                Иван Петров
                {personConfig.showOnlineStatus && (
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                )}
              </div>
              {(personConfig.displayFormat === 'email' || personConfig.displayFormat === 'card') && (
                <div className="text-xs text-[var(--text-tertiary)]">ivan@example.com</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
