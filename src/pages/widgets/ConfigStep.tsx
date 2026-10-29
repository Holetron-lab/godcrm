import { Settings2, Eye, EyeOff, ArrowLeftRight } from 'lucide-react';
import type { WidgetPresetOption, TableInfo, ColumnInfo, WizardStep } from './types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface ConfigStepProps {
  selectedPreset: WidgetPresetOption;
  selectedTable: TableInfo | null;
  columns: ColumnInfo[];
  columnMapping: Record<string, string>;
  visibleColumns: string[];
  setVisibleColumns: React.Dispatch<React.SetStateAction<string[]>>;
  widgetTitle: string;
  setWidgetTitle: (title: string) => void;
  widgetIcon: string | null;
  setWidgetIcon: (icon: string | null) => void;
  presetRequiresTable: (presetId: string) => boolean;
  effectiveProjectId: string | null;
  dashboard: { id: number } | undefined;
  dashboardLoading: boolean;
  dashboardError: Error | null;
  createWidget: { isPending: boolean };
  handleCreateWidget: () => Promise<void>;
  setStep: (step: WizardStep) => void;
  onCancel: () => void;
}

export function ConfigStep({
  selectedPreset,
  selectedTable,
  columns,
  columnMapping,
  visibleColumns,
  setVisibleColumns,
  widgetTitle,
  setWidgetTitle,
  widgetIcon,
  setWidgetIcon,
  presetRequiresTable,
  effectiveProjectId,
  dashboard,
  dashboardLoading,
  dashboardError,
  createWidget,
  handleCreateWidget,
  setStep,
  onCancel,
}: ConfigStepProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">
          {t('Финальные настройки', 'Final settings')}
        </h2>
        <button
          onClick={() => {
            if (!presetRequiresTable(selectedPreset.id)) {
              setStep('preset');
            } else if ((selectedPreset.tables[0]?.requiredColumns || []).length > 0) {
              setStep('mapping');
            } else {
              setStep('table');
            }
          }}
          className="text-sm text-[var(--color-primary-500)] hover:underline"
        >
          &larr; {t('Назад', 'Back')}
        </button>
      </div>

      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border-primary)]">
          <Settings2 className="w-5 h-5 text-[var(--color-primary-500)]" />
          <p className="font-medium text-[var(--text-primary)]">
            {t('Настройки модуля', 'Module settings')}
          </p>
        </div>

        <div className="space-y-4">
          {/* Icon and Title in one row */}
          <div className="flex gap-3 items-end">
            {/* Icon picker */}
            <div className="w-28 flex-shrink-0">
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                {t('Иконка', 'Icon')}
              </label>
              <div className="flex">
                <input
                  type="text"
                  value={widgetIcon || (
                    selectedPreset.id === 'table_view' ? '📊' :
                    selectedPreset.id === 'kanban_board' ? '📋' :
                    selectedPreset.id === 'calendar_widget' ? '📅' :
                    selectedPreset.id === 'timeline_widget' ? '📈' : '📦'
                  )}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value.length <= 2) setWidgetIcon(value);
                  }}
                  maxLength={2}
                  className="h-10 w-12 text-center text-xl rounded-l-lg border border-r-0 border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] placeholder:opacity-50"
                  placeholder="📁"
                />
                <div className="relative group">
                  <button
                    type="button"
                    className="h-10 px-2 rounded-r-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </button>
                  {/* Emoji dropdown on hover */}
                  <div className="absolute top-full right-0 -mt-1 pt-2 hidden group-hover:block z-50">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-2 grid grid-cols-6 gap-1 w-[220px]">
                      {['📊', '📋', '📅', '📈', '📦', '📁', '📝', '📌', '🎯', '⭐', '💡', '🔥', '✅', '💼', '🏷️', '📎', '🔗', '💰', '👥', '🛒', '📱', '💻', '🏠', '🚀', '🗃️', '🗂️', '📄', '📃', '📑', '📒'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setWidgetIcon(emoji)}
                          className={`w-8 h-8 flex items-center justify-center rounded text-lg transition-colors ${
                            (widgetIcon || '📊') === emoji
                              ? 'bg-[var(--color-primary-500)]/20 ring-1 ring-[var(--color-primary-500)]'
                              : 'hover:bg-[var(--bg-tertiary)]'
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Title */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                {t('Название модуля', 'Module name')}
              </label>
              <input
                type="text"
                value={widgetTitle}
                onChange={(e) => setWidgetTitle(e.target.value)}
                placeholder={selectedPreset.name}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
              />
            </div>
          </div>

          {/* Visible Columns for table_view */}
          {selectedPreset.id === 'table_view' && columns.length > 0 && (
            <VisibleColumnsEditor
              columns={columns}
              visibleColumns={visibleColumns}
              setVisibleColumns={setVisibleColumns}
            />
          )}

          {/* Summary */}
          <div className="mt-6 p-4 rounded-lg bg-[var(--bg-tertiary)]">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">{t('Сводка', 'Summary')}</h4>
            <ul className="space-y-1 text-sm text-[var(--text-secondary)]">
              <li>&bull; {t('Тип:', 'Type:')} <span className="font-medium">{selectedPreset.name}</span></li>
              <li>&bull; {t('Таблица:', 'Table:')} <span className="font-medium">{selectedTable?.display_name || selectedTable?.name}</span></li>
              {selectedPreset.id === 'table_view' && visibleColumns.length > 0 && (
                <li>&bull; {t('Колонки:', 'Columns:')} <span className="font-medium">{t(`${visibleColumns.length} выбрано`, `${visibleColumns.length} selected`)}</span></li>
              )}
              {Object.entries(columnMapping).map(([key, value]) => {
                const col = columns.find(c => c.name === value);
                const req = (selectedPreset.tables[0]?.requiredColumns || []).find(r => r.key === key);
                return (
                  <li key={key}>
                    &bull; {req?.description || key}: <span className="font-medium">{col?.display_name || col?.name || value}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Dashboard loading status */}
        {dashboardLoading && (
          <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 text-sm">
            {t('Загрузка dashboard...', 'Loading dashboard...')}
          </div>
        )}

        {dashboardError && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
            {t('Ошибка загрузки dashboard:', 'Dashboard loading error:')} {(dashboardError as Error).message}
          </div>
        )}

        {!dashboardLoading && !dashboard && effectiveProjectId && (
          <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 text-sm">
            {t(`Dashboard будет создан автоматически для проекта ${effectiveProjectId}`, `Dashboard will be created automatically for project ${effectiveProjectId}`)}
          </div>
        )}

        {!effectiveProjectId && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
            {t('Таблица не привязана к проекту. Невозможно создать модуль.', 'The table is not linked to a project. Cannot create a module.')}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-[var(--border-primary)] flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-6 py-2 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition"
          >
            {t('Отмена', 'Cancel')}
          </button>
          <button
            onClick={handleCreateWidget}
            disabled={createWidget.isPending || !effectiveProjectId}
            className="px-6 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition flex items-center gap-2"
          >
            {createWidget.isPending ? t('Создание...', 'Creating...') : t('Создать модуль', 'Create module')}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Sub-component for visible columns editor ---

interface VisibleColumnsEditorProps {
  columns: ColumnInfo[];
  visibleColumns: string[];
  setVisibleColumns: React.Dispatch<React.SetStateAction<string[]>>;
}

function VisibleColumnsEditor({ columns, visibleColumns, setVisibleColumns }: VisibleColumnsEditorProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  return (
    <div className="mt-6">
      <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
        {t('Видимые колонки', 'Visible columns')}
      </label>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        {t('Выберите и упорядочьте колонки для отображения. Если не выбрано ничего — покажутся все.', 'Select and order the columns to display. If nothing is selected, all are shown.')}
      </p>
      <div className="space-y-1 max-h-[300px] overflow-y-auto rounded-lg border border-[var(--border-primary)] p-2 bg-[var(--bg-primary)]">
        {columns
          .filter(col => !col.name.startsWith('_') && col.name !== 'id')
          .map((col) => {
            const isVisible = visibleColumns.includes(col.name);
            const isLink = col.type === 'link';
            const isBacklink = col.type === 'backlink' || (col.config && col.config.isBacklink);
            return (
              <button type="button" aria-pressed={isVisible}
                key={col.id}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition ${
                  isVisible
                    ? 'bg-[var(--bg-tertiary)]'
                    : 'hover:bg-[var(--bg-tertiary)] opacity-50'
                }`}
                onClick={() => {
                  if (isVisible) {
                    setVisibleColumns(visibleColumns.filter(c => c !== col.name));
                  } else {
                    setVisibleColumns([...visibleColumns, col.name]);
                  }
                }}
              >
                <div className={`w-5 h-5 flex items-center justify-center rounded ${
                  isVisible ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'
                }`}>
                  {isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${
                    isVisible ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'
                  }`}>
                    {col.display_name || col.name}
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)] truncate">
                    {col.name}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {(isLink || isBacklink) && (
                    <span className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${
                      isBacklink
                        ? 'bg-purple-500/10 text-purple-500'
                        : 'bg-primary-500/10 text-primary-500'
                    }`}>
                      {isBacklink ? <ArrowLeftRight className="w-3 h-3" /> : <ArrowLeftRight className="w-3 h-3" />}
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-tertiary)] px-2 py-0.5 bg-[var(--bg-tertiary)] rounded">
                    {col.type}
                  </span>
                </div>
              </button>
            );
          })}
      </div>
      {visibleColumns.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-[var(--text-tertiary)]">
            {t(`Выбрано: ${visibleColumns.length} колонок`, `Selected: ${visibleColumns.length} columns`)}
          </span>
          <button
            onClick={() => setVisibleColumns([])}
            className="text-xs text-[var(--color-primary-500)] hover:underline"
          >
            {t('Сбросить', 'Reset')}
          </button>
        </div>
      )}
    </div>
  );
}
