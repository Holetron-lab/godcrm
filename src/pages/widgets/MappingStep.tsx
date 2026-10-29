import { Check, Columns } from 'lucide-react';
import type { WidgetPresetOption, ColumnInfo, WizardStep } from './types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface MappingStepProps {
  selectedPreset: WidgetPresetOption;
  columns: ColumnInfo[];
  columnsLoading: boolean;
  columnMapping: Record<string, string>;
  setColumnMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  allRequiredMapped: boolean;
  setStep: (step: WizardStep) => void;
}

export function MappingStep({
  selectedPreset,
  columns,
  columnsLoading,
  columnMapping,
  setColumnMapping,
  allRequiredMapped,
  setStep,
}: MappingStepProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">
          {t('Настройка колонок', 'Column setup')}
        </h2>
        <button
          onClick={() => setStep('table')}
          className="text-sm text-[var(--color-primary-500)] hover:underline"
        >
          &larr; {t('Назад к выбору таблицы', 'Back to table selection')}
        </button>
      </div>

      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border-primary)]">
          <Columns className="w-5 h-5 text-[var(--color-primary-500)]" />
          <div>
            <p className="font-medium text-[var(--text-primary)]">
              {t('Автоматический маппинг', 'Automatic mapping')}
            </p>
            <p className="text-sm text-[var(--text-tertiary)]">
              {t('Мы попытались автоматически сопоставить колонки. Проверьте и исправьте при необходимости.', 'We tried to map the columns automatically. Please review and fix them if needed.')}
            </p>
          </div>
        </div>

        {columnsLoading ? (
          <div className="text-center py-8 text-[var(--text-tertiary)]">
            {t('Загрузка колонок...', 'Loading columns...')}
          </div>
        ) : (
          <div className="space-y-4">
            {(selectedPreset.tables[0]?.requiredColumns || []).map(req => (
              <div key={req.name} className="flex items-center gap-4">
                <div className="w-1/3">
                  <label className="block text-sm font-medium text-[var(--text-primary)]">
                    {req.description}
                    {req.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    {t('Типы:', 'Types:')} {req.types.join(', ')}
                  </p>
                </div>
                <div className="flex-1">
                  <select
                    value={columnMapping[req.name] || ''}
                    onChange={(e) => setColumnMapping(prev => ({
                      ...prev,
                      [req.name]: e.target.value
                    }))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                  >
                    <option value="">{t('— Выберите колонку —', '— Select a column —')}</option>
                    {columns
                      .filter(col => col.type !== undefined && req.types.includes(col.type))
                      .map(col => (
                        <option key={col.id} value={col.name}>
                          {col.display_name || col.name} ({col.type})
                        </option>
                      ))}
                  </select>
                </div>
                {columnMapping[req.name] && (
                  <Check className="w-5 h-5 text-green-500" />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-[var(--border-primary)] flex justify-end">
          <button
            onClick={() => setStep('config')}
            disabled={!allRequiredMapped}
            className="px-6 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {t('Далее', 'Next')}
          </button>
        </div>
      </div>
    </div>
  );
}
