import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import type { TableInfo, WizardStep } from './types';

interface ProgressHeaderProps {
  selectedTable: TableInfo | null;
  step: WizardStep;
  getSteps: () => string[];
  onBack: () => void;
}

const stepNames: Record<string, string> = {
  preset: 'Тип',
  table: 'Таблицы',
  config: 'Настройки'
};

export function ProgressHeader({ selectedTable, step, getSteps, onBack }: ProgressHeaderProps) {
  return (
    <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">
              Создать представление
            </h1>
            <p className="text-sm text-[var(--text-tertiary)]">
              {selectedTable
                ? `Для таблицы: ${selectedTable.display_name || selectedTable.name}`
                : 'Выберите таблицу и тип модуля'
              }
            </p>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 mt-4">
          {getSteps().map((s, i) => {
            const isActive = step === s;
            const isPast = getSteps().indexOf(step) > i;

            return (
              <div key={s} className="flex items-center">
                {i > 0 && <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)] mx-2" />}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition ${
                  isActive ? 'bg-[var(--color-primary-500)] text-white' :
                  isPast ? 'bg-green-500/20 text-green-500' :
                  'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
                }`}>
                  {isPast && <Check className="w-4 h-4" />}
                  {stepNames[s]}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
