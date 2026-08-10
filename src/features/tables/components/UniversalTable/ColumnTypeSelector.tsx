import { useMemo } from 'react';
import { getColumnTypeOptionsWithEmoji, type ColumnType } from '@/shared/types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface ColumnTypeSelectorProps {
  value: ColumnType;
  onChange: (type: ColumnType) => void;
}

export const ColumnTypeSelector = ({ value, onChange }: ColumnTypeSelectorProps) => {
  const { language, t } = useLanguage();
  const columnTypes = useMemo(() => getColumnTypeOptionsWithEmoji(language as 'ru' | 'en'), [language]);

  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-[var(--text-secondary)]">
        {t('columnSettings.columnType')}
      </label>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {columnTypes.map((type) => (
          <button
            key={type.value}
            type="button"
            onClick={() => onChange(type.value)}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all hover:scale-105 ${
              value === type.value
                ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/20 shadow-sm'
                : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--color-primary-300)]'
            }`}
          >
            <span className="text-3xl">{type.emoji}</span>
            <div className="text-center">
              <div className={`text-sm font-semibold ${
                value === type.value ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-primary)]'
              }`}>
                {type.label}
              </div>
              <div className="text-xs text-[var(--text-tertiary)]">
                {type.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
