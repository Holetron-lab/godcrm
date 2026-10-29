import React, { useId } from 'react';
import { ColumnSettingsProps } from './types';
import { BarChart3, Calculator, Info, Zap, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

/**
 * Вкладка "Сводка" - настройки агрегаций и будущий конструктор переменных
 */
export const SummaryTab: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
}) => {
  const { t } = useLanguage();
  const fieldId = useId();
  const isNumericType = ['number', 'integer', 'float', 'decimal'].includes(draft.type);
  const isTextType = ['text', 'email', 'url', 'phone'].includes(draft.type);
  const isSelectType = ['select', 'multi-select', 'multi_select'].includes(draft.type);
  const isCheckboxType = draft.type === 'checkbox';
  const isDateType = ['date', 'datetime'].includes(draft.type);

  return (
    <div className="space-y-6">
      {/* Агрегации для суммарной строки */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[var(--text-tertiary)]" />
          <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
            {t('columnSettings.summaryTab.title')}
          </span>
        </div>
        
        <div className="space-y-4">
          {/* Числовые агрегации */}
          {isNumericType && (
            <div className="space-y-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {t('columnSettings.summaryTab.numeric')}
              </div>
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
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.sum')}</span>
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
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.avg')}</span>
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
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.min')}</span>
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
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.max')}</span>
                </label>
              </div>
            </div>
          )}

          {/* Чекбокс агрегации */}
          {isCheckboxType && (
            <div className="space-y-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {t('columnSettings.summaryTab.checkboxStats')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.config?.summary?.checked === true}
                    onChange={(e) => setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        summary: { ...prev.config?.summary, checked: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.checked')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.config?.summary?.unchecked === true}
                    onChange={(e) => setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        summary: { ...prev.config?.summary, unchecked: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.unchecked')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.config?.summary?.percentChecked === true}
                    onChange={(e) => setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        summary: { ...prev.config?.summary, percentChecked: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.percentChecked')}</span>
                </label>
              </div>
            </div>
          )}

          {/* Дата агрегации */}
          {isDateType && (
            <div className="space-y-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {t('columnSettings.summaryTab.dateStats')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.config?.summary?.earliest === true}
                    onChange={(e) => setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        summary: { ...prev.config?.summary, earliest: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.earliest')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.config?.summary?.latest === true}
                    onChange={(e) => setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        summary: { ...prev.config?.summary, latest: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.latest')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.config?.summary?.dateRange === true}
                    onChange={(e) => setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        summary: { ...prev.config?.summary, dateRange: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.dateRange')}</span>
                </label>
              </div>
            </div>
          )}

          {/* Общие агрегации (для всех типов) */}
          <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] space-y-3">
            <div className="text-sm font-medium text-[var(--text-primary)]">
              {t('columnSettings.summaryTab.general')}
            </div>
            <div className="grid grid-cols-2 gap-3">
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
                <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.count')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.config?.summary?.countUnique === true}
                  onChange={(e) => setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      summary: { ...prev.config?.summary, countUnique: e.target.checked }
                    }
                  }))}
                  className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                />
                <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.countUnique')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.config?.summary?.countEmpty === true}
                  onChange={(e) => setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      summary: { ...prev.config?.summary, countEmpty: e.target.checked }
                    }
                  }))}
                  className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                />
                <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.countEmpty')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.config?.summary?.countFilled === true}
                  onChange={(e) => setDraft(prev => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      summary: { ...prev.config?.summary, countFilled: e.target.checked }
                    }
                  }))}
                  className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                />
                <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.countFilled')}</span>
              </label>
              {(isTextType || isSelectType) && (
                <label className="flex items-center gap-2 cursor-pointer col-span-2">
                  <input
                    type="checkbox"
                    checked={draft.config?.summary?.percentFilled === true}
                    onChange={(e) => setDraft(prev => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        summary: { ...prev.config?.summary, percentFilled: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4 rounded border-gray-300 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">{t('columnSettings.summaryTab.percentFilled')}</span>
                </label>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Конструктор переменных колонки (ADR-026) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-[var(--accent-primary)]" />
          <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
            {t('columnSettings.summaryTab.variables')}
          </span>
        </div>
        
        <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] space-y-4">
          {/* Formula input */}
          <div className="space-y-2">
            <label htmlFor={fieldId} className="text-sm font-medium text-[var(--text-primary)]">
              {t('columnSettings.summaryTab.formula')}
            </label>
            <textarea id={fieldId}
              value={draft.formula || ''}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                formula: e.target.value
              }))}
              placeholder={t('columnSettings.summaryTab.formulaPlaceholder')}
              rows={2}
              className="w-full px-3 py-2 text-sm font-mono bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 resize-none"
            />
            <p className="text-xs text-[var(--text-tertiary)]">
              {t('columnSettings.summaryTab.hintUse')} <code className="text-[var(--accent-primary)]">{'{{'}{t('columnSettings.summaryTab.hintColumn')}{'}}'}</code> {t('columnSettings.summaryTab.hintColumns')}{' '}
              <code className="text-[var(--accent-primary)]">{t('columnSettings.summaryTab.hintVariable')}</code> {t('columnSettings.summaryTab.hintSpace')}
            </p>
          </div>

          {/* Quick formulas */}
          <div className="space-y-2">
            <span className="text-xs text-[var(--text-tertiary)]">{t('columnSettings.summaryTab.quickFormulas')}</span>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'SUM', formula: `SUM({{${draft.name || 'column'}}})` },
                { label: 'AVG', formula: `AVG({{${draft.name || 'column'}}})` },
                { label: 'COUNT', formula: `COUNT({{${draft.name || 'column'}}})` },
                { label: 'MIN', formula: `MIN({{${draft.name || 'column'}}})` },
                { label: 'MAX', formula: `MAX({{${draft.name || 'column'}}})` },
              ].map(item => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setDraft(prev => ({
                    ...prev,
                    formula: (prev.formula || '') + item.formula
                  }))}
                  className="px-2 py-1 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--accent-primary)]/10 border border-[var(--border-primary)] rounded text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Информация */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--color-primary-50)] border border-[var(--color-primary-200)]">
        <Info className="w-4 h-4 text-[var(--accent-primary)] mt-0.5 flex-shrink-0" />
        <p className="text-xs text-[var(--text-secondary)]">
          {t('columnSettings.summaryTab.info')}
        </p>
      </div>
    </div>
  );
};
