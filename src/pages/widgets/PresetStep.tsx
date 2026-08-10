import { Plus } from 'lucide-react';
import type { WidgetPresetOption, WizardStep } from './types';

interface PresetStepProps {
  widgetPresets: WidgetPresetOption[];
  onPresetSelect: (preset: WidgetPresetOption) => void;
  setSelectedPreset: (preset: WidgetPresetOption) => void;
  setWidgetTitle: (title: string) => void;
  setStep: (step: WizardStep) => void;
}

export function PresetStep({
  widgetPresets,
  onPresetSelect,
  setSelectedPreset,
  setWidgetTitle,
  setStep,
}: PresetStepProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">
          Выберите тип представления
        </h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {widgetPresets.map(preset => (
          <button
            key={preset.id}
            onClick={() => onPresetSelect(preset)}
            className="p-6 rounded-xl border-2 border-[var(--border-primary)] hover:border-[var(--color-primary-500)] bg-[var(--bg-secondary)] transition-all hover:shadow-lg group text-left"
          >
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
              style={{ backgroundColor: `${preset.color}20`, color: preset.color }}
            >
              {preset.icon}
            </div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-1">
              {preset.name}
            </h3>
            <p className="text-sm text-[var(--text-tertiary)] line-clamp-2">
              {preset.description}
            </p>
          </button>
        ))}

        {/* Custom Widget Option */}
        <button
          onClick={() => {
            setSelectedPreset({
              id: 'custom',
              name: 'Свой модуль',
              description: 'Создайте полностью кастомный модуль',
              icon: <Plus className="w-8 h-8" />,
              color: '#64748b',
              tables: []
            });
            setWidgetTitle('Мой модуль');
            setStep('config');
          }}
          className="p-6 rounded-xl border-2 border-dashed border-[var(--border-secondary)] hover:border-[var(--color-primary-500)] bg-transparent transition-all hover:bg-[var(--bg-secondary)]/50 group text-left flex flex-col items-center justify-center min-h-[200px]"
        >
          <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 border-2 border-dashed border-[var(--text-tertiary)] group-hover:border-[var(--color-primary-500)]">
            <Plus className="w-8 h-8 text-[var(--text-tertiary)] group-hover:text-[var(--color-primary-500)]" />
          </div>
          <h3 className="font-semibold text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] mb-1 text-center">
            Создать свой
          </h3>
          <p className="text-sm text-[var(--text-tertiary)] text-center">
            Полностью кастомный модуль
          </p>
        </button>
      </div>
    </div>
  );
}
