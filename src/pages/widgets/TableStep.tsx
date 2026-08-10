import { ChevronRight } from 'lucide-react';
import { TableMappingSelector, type TableMapping } from '@/features/widgets/components/TableMappingSelector';
import type { WidgetPresetOption, WizardStep } from './types';

interface TableStepProps {
  selectedPreset: WidgetPresetOption;
  tableMappings: TableMapping[];
  onMappingsChange: (mappings: TableMapping[]) => void;
  isTableMappingComplete: boolean;
  defaultProjectId?: number;
  setStep: (step: WizardStep) => void;
}

export function TableStep({
  selectedPreset,
  tableMappings,
  onMappingsChange,
  isTableMappingComplete,
  defaultProjectId,
  setStep,
}: TableStepProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">
          Настройка таблиц для модуля
        </h2>
        <button
          onClick={() => setStep('preset')}
          className="text-sm text-[var(--color-primary-500)] hover:underline"
        >
          &larr; Назад к выбору типа
        </button>
      </div>

      {/* Show selected preset */}
      <div className="mb-6 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${selectedPreset.color}20`, color: selectedPreset.color }}
        >
          {selectedPreset.icon}
        </div>
        <span className="text-sm text-[var(--text-secondary)]">
          Тип: <span className="font-medium text-[var(--text-primary)]">{selectedPreset.name}</span>
        </span>
      </div>

      <p className="text-sm text-[var(--text-tertiary)] mb-6">
        Выберите существующие таблицы или создайте новые для работы модуля.
        Для каждой таблицы настройте маппинг колонок.
      </p>

      {/* Table Mapping Selector */}
      <TableMappingSelector
        tableRequirements={selectedPreset.tables}
        mappings={tableMappings}
        onMappingsChange={onMappingsChange}
        defaultProjectId={defaultProjectId}
      />

      {/* Continue button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => setStep('config')}
          disabled={!isTableMappingComplete}
          className="px-6 py-2 rounded-lg bg-[var(--color-primary-500)] text-white font-medium hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          Далее
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
