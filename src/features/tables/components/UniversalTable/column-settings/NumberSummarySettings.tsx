import React from 'react';
import { ColumnSettingsProps } from './types';

/**
 * Компонент настроек суммарной строки для числовых колонок
 */
export const NumberSummarySettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
}) => {
  // Показываем только для числовых типов
  if (!['number', 'integer', 'float', 'decimal'].includes(draft.type)) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
        Суммарная строка
      </div>
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.config?.summary?.sum !== false}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  summary: { ...prev.config?.summary, sum: e.target.checked }
                }
              }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Σ Сумма</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.config?.summary?.avg !== false}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  summary: { ...prev.config?.summary, avg: e.target.checked }
                }
              }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Среднее</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.config?.summary?.min === true}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  summary: { ...prev.config?.summary, min: e.target.checked }
                }
              }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Минимум</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.config?.summary?.max === true}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  summary: { ...prev.config?.summary, max: e.target.checked }
                }
              }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Максимум</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.config?.summary?.count === true}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: {
                  ...prev.config,
                  summary: { ...prev.config?.summary, count: e.target.checked }
                }
              }))}
              className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
            />
            <span className="text-sm text-[var(--text-primary)]">Количество</span>
          </label>
        </div>
      </div>
    </div>
  );
};
