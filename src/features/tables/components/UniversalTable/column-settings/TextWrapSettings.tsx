import React, { useId } from 'react';
import { ColumnModel, TextWrapMode } from '@/features/tables/types/table.types';

interface TextWrapSettingsProps {
  draft: ColumnModel;
  setDraft: (updater: (prev: ColumnModel) => ColumnModel) => void;
}

export const TextWrapSettings: React.FC<TextWrapSettingsProps> = ({ draft, setDraft }) => {
  const currentMode = draft.config?.cellFormat?.textWrap || 'nowrap';

  const modes: Array<{ value: TextWrapMode; label: string; description: string; example: string }> = [
    {
      value: 'nowrap',
      label: 'В одну строку (обрезка многоточием)',
      description: 'Текст в одну строку с ellipsis',
      example: 'Очень длинный текст...'
    },
    {
      value: 'wrap',
      label: 'Перенос строки (высота по содержимому)',
      description: 'Текст переносится, высота растёт',
      example: 'Очень длинный текст\nпродолжается здесь'
    },
    {
      value: 'wrap-ellipsis',
      label: 'Ограниченный перенос (фикс. высота)',
      description: 'Текст переносится, ограничен 2-3 строками',
      example: 'Очень длинный текст\nпродолжается...'
    }
  ];

  const handleModeChange = (mode: TextWrapMode) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        cellFormat: {
          ...prev.config?.cellFormat,
          textWrap: mode
        }
      }
    }));
  };

  const groupId = useId();

  return (
    <div className="space-y-4 p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        📏 Перенос текста
      </h4>

      <div className="space-y-3">
        {modes.map(mode => (
          <label
            aria-label={mode.label}
            htmlFor={`${groupId}-${mode.value}`}
            key={mode.value}
            className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
              currentMode === mode.value
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-100'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <input
              type="radio"
              id={`${groupId}-${mode.value}`}
              aria-label={mode.label}
              name={groupId}
              value={mode.value}
              checked={currentMode === mode.value}
              onChange={() => handleModeChange(mode.value)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium text-gray-900 dark:text-gray-100 mb-1">
                {mode.label}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {mode.description}
              </div>
              <div 
                className="p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 text-sm font-mono"
                style={{
                  whiteSpace: mode.value === 'wrap' ? 'pre-wrap' : mode.value === 'wrap-ellipsis' ? 'normal' : 'nowrap',
                  overflow: mode.value === 'nowrap' ? 'hidden' : 'visible',
                  textOverflow: mode.value === 'nowrap' ? 'ellipsis' : 'clip',
                  display: mode.value === 'wrap-ellipsis' ? '-webkit-box' : 'block',
                  WebkitLineClamp: mode.value === 'wrap-ellipsis' ? 2 : undefined,
                  WebkitBoxOrient: mode.value === 'wrap-ellipsis' ? 'vertical' : undefined,
                  maxWidth: '200px'
                }}
              >
                {mode.example}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="p-3 bg-primary-50 dark:bg-primary-900 rounded-lg text-sm border border-primary-200 dark:border-primary-800">
        <p className="text-primary-600 dark:text-primary-300">
          💡 <strong>Совет:</strong> Для длинных текстов используйте &quot;Перенос строки&quot;, 
          для коротких идентификаторов - &quot;В одну строку&quot;
        </p>
      </div>
    </div>
  );
};
