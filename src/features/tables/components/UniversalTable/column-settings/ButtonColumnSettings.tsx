import React from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ColumnSettingsProps, renderTypeCellPreview } from './types';

/**
 * Компонент настроек для колонок типа button
 */
export const ButtonColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  firstRow,
}) => {
  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        ⚡ Настройки кнопки
      </h4>

      <Input
        label="Текст кнопки"
        placeholder="Действие"
        value={draft.config?.button?.label ?? 'Действие'}
        onChange={(event) => setDraft(prev => ({
          ...prev,
          config: {
            ...prev.config,
            button: { ...prev.config?.button, label: event.target.value }
          }
        }))}
      />

      <Select
        label="Иконка"
        value={draft.config?.button?.icon ?? 'zap'}
        onChange={(value) => setDraft(prev => ({
          ...prev,
          config: {
            ...prev.config,
            button: { ...prev.config?.button, icon: value }
          }
        }))}
        options={[
          { label: '⚡ Zap', value: 'zap' },
          { label: '▶️ Play', value: 'play' },
          { label: '📤 Send', value: 'send' },
          { label: '🔗 Link', value: 'link' },
          { label: '📋 Copy', value: 'copy' },
          { label: '✏️ Edit', value: 'edit' },
          { label: '🗑️ Trash', value: 'trash' },
          { label: '⋯ More', value: 'more' }
        ]}
      />

      <Select
        label="Стиль кнопки"
        value={draft.config?.button?.variant ?? 'secondary'}
        onChange={(value) => setDraft(prev => ({
          ...prev,
          config: {
            ...prev.config,
            button: { ...prev.config?.button, variant: value as 'primary' | 'secondary' | 'ghost' | 'danger' }
          }
        }))}
        options={[
          { label: 'Primary', value: 'primary' },
          { label: 'Secondary', value: 'secondary' },
          { label: 'Ghost', value: 'ghost' },
          { label: 'Danger', value: 'danger' }
        ]}
      />

      <Select
        label="Тип действия"
        value={draft.config?.button?.action?.type ?? 'automation'}
        onChange={(value) => setDraft(prev => ({
          ...prev,
          config: {
            ...prev.config,
            button: {
              ...prev.config?.button,
              action: {
                ...prev.config?.button?.action,
                type: value as 'automation' | 'url' | 'copy' | 'custom'
              }
            }
          }
        }))}
        options={[
          { label: '⚡ Автоматизация', value: 'automation' },
          { label: '🔗 Открыть URL', value: 'url' },
          { label: '📋 Копировать поле', value: 'copy' },
          { label: '⚙️ Кастомное', value: 'custom' }
        ]}
      />

      {draft.config?.button?.action?.type === 'automation' && (
        <Input
          label="ID автоматизации"
          placeholder="auto_..."
          value={draft.config?.button?.action?.automationId ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              button: {
                ...prev.config?.button,
                action: {
                  type: 'automation',
                  ...prev.config?.button?.action,
                  automationId: event.target.value
                }
              }
            }
          }))}
        />
      )}

      {draft.config?.button?.action?.type === 'url' && (
        <Input
          label="URL (можно использовать {field_name})"
          placeholder="https://example.com/item/{id}"
          value={draft.config?.button?.action?.url ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              button: {
                ...prev.config?.button,
                action: {
                  type: 'url',
                  ...prev.config?.button?.action,
                  url: event.target.value
                }
              }
            }
          }))}
        />
      )}

      {draft.config?.button?.action?.type === 'copy' && (
        <Input
          label="Поле для копирования"
          placeholder="email, phone, id..."
          value={draft.config?.button?.action?.copyField ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              button: {
                ...prev.config?.button,
                action: {
                  type: 'copy',
                  ...prev.config?.button?.action,
                  copyField: event.target.value
                }
              }
            }
          }))}
        />
      )}

      {draft.config?.button?.action?.type === 'custom' && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm border border-yellow-200 dark:border-yellow-800">
          <p className="text-yellow-600 dark:text-yellow-300">
            💡 Кастомное действие будет вызывать событие <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">onButtonClick</code> с данными строки
          </p>
        </div>
      )}
    </div>
  );
};
