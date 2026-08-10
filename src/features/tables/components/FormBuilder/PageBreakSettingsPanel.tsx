import React from 'react';
import { X } from 'lucide-react';
import type { FormPageBreak } from '../../types/form-config.types';

// Page break settings panel
export function PageBreakSettingsPanel({
  pageBreak,
  onUpdate,
  onClose,
}: {
  pageBreak: FormPageBreak;
  onUpdate: (updates: Partial<FormPageBreak>) => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-3">
      {/* Compact row layout */}
      <div className="flex items-center gap-4">
        {/* Header */}
        <span className="text-xs font-medium text-[var(--text-tertiary)] whitespace-nowrap">
          Новая страница
        </span>

        {/* Button text */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-tertiary)]">Кнопка:</span>
          <input
            type="text"
            value={pageBreak.buttonText || ''}
            onChange={(e) => onUpdate({ buttonText: e.target.value })}
            placeholder="Далее"
            className="w-24 px-2 py-1 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]"
          />
        </div>

        {/* Show back button checkbox */}
        <label className="flex items-center gap-1.5 cursor-pointer" title="Показывать кнопку Назад">
          <input
            type="checkbox"
            checked={pageBreak.showBackButton !== false}
            onChange={(e) => onUpdate({ showBackButton: e.target.checked })}
            className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
          />
          <span className="text-xs text-[var(--text-secondary)]">Назад</span>
        </label>

        {/* Save intermediate checkbox */}
        <label className="flex items-center gap-1.5 cursor-pointer" title="Сохранить данные при переходе">
          <input
            type="checkbox"
            checked={pageBreak.saveIntermediate || false}
            onChange={(e) => onUpdate({ saveIntermediate: e.target.checked })}
            className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
          />
          <span className="text-xs text-[var(--text-secondary)]">Сохранять</span>
        </label>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <X className="w-4 h-4 text-[var(--text-tertiary)]" />
        </button>
      </div>
    </div>
  );
}
