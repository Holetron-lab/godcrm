import React, { useMemo } from 'react';
import { ColumnModel } from '@/features/tables/types/table.types';

interface DashboardPanelProps {
  draft: ColumnModel;
  rows?: Array<{ id: string; data: Record<string, unknown> }>;
}

export const DashboardPanel: React.FC<DashboardPanelProps> = ({ draft, rows = [] }) => {
  // Находим последнюю непустую ячейку
  const lastNonEmptyCell = useMemo(() => {
    const lastRow = [...rows].reverse().find(row => {
      const value = row.data[draft?.name || ''] ?? row.data[draft?.id || ''];
      return value !== null && value !== undefined && value !== '';
    });
    if (!lastRow) return null;
    return lastRow.data[draft?.name || ''] ?? lastRow.data[draft?.id || ''];
  }, [draft, rows]);

  const displayValue = lastNonEmptyCell !== null 
    ? String(lastNonEmptyCell)
    : (draft?.type === 'checkbox' ? '☐' :
       draft?.type === 'number' ? '—' :
       (draft?.type as string) === 'date' ? '—' :
       draft?.type === 'select' ? '—' :
       '—');

  const hasAutomations = Boolean(draft?.config?.automation?.webhook?.enabled);

  return (
    <div className="flex flex-wrap gap-3 p-3 rounded-lg bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 border border-orange-200 dark:border-orange-800">
      <div className="flex gap-4 w-full">
        {/* Превью ячейки */}
        <div className="flex-shrink-0" style={{ width: Math.min(draft?.width || 150, 200) }}>
          <div className="text-[var(--text-tertiary)] text-[10px] uppercase tracking-wide mb-1">Ячейка</div>
          <div 
            className="rounded-lg border-2 border-dashed border-orange-300 dark:border-orange-700 bg-white dark:bg-gray-800 flex items-center px-2 overflow-hidden"
            style={{
              width: Math.min(draft?.width || 150, 200),
              height: 36,
              fontFamily: draft?.config?.appearance?.fontFamily || 'inherit',
              fontSize: draft?.config?.appearance?.fontSize || '13px',
              color: draft?.config?.appearance?.textColor || 'inherit',
              textAlign: draft?.config?.appearance?.align || 'left',
              justifyContent: draft?.config?.appearance?.align === 'center' ? 'center' : 
                              draft?.config?.appearance?.align === 'right' ? 'flex-end' : 'flex-start'
            }}
          >
            <span className="truncate">
              {draft?.config?.cellFormat?.mode === 'formula' ? 'ƒx' : displayValue}
            </span>
          </div>
        </div>
        
        {/* Метрики */}
        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {/* Тип */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-200 flex items-center justify-center">
              <span className="text-primary-600 dark:text-primary-400 font-bold text-sm">
                {draft?.type === 'number' ? '#' : draft?.type === 'text' ? 'T' : (draft?.type as string) === 'date' ? '📅' : '◈'}
              </span>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase tracking-wide">Тип</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{draft?.type}</div>
            </div>
          </div>
          
          {/* Статус обязательности */}
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              draft?.isRequired 
                ? 'bg-red-100 dark:bg-red-900/30' 
                : 'bg-green-100 dark:bg-green-900/30'
            }`}>
              <span className={`text-sm ${
                draft?.isRequired 
                  ? 'text-red-600 dark:text-red-400' 
                  : 'text-green-600 dark:text-green-400'
              }`}>
                {draft?.isRequired ? '❗' : '✓'}
              </span>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase tracking-wide">Статус</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {draft?.isRequired ? 'Обязательный' : 'Опционально'}
              </div>
            </div>
          </div>
          
          {/* Формат */}
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              draft?.config?.cellFormat?.mode === 'formula' 
                ? 'bg-purple-100 dark:bg-purple-900/30' 
                : 'bg-gray-100 dark:bg-gray-700'
            }`}>
              <span className={`text-sm ${
                draft?.config?.cellFormat?.mode === 'formula' 
                  ? 'text-purple-600 dark:text-purple-400' 
                  : 'text-gray-400'
              }`}>
                {draft?.config?.cellFormat?.mode === 'formula' ? 'ƒx' : 
                 draft?.config?.cellFormat?.mode === 'markdown' ? '📑' :
                 draft?.config?.cellFormat?.mode === 'html' ? '🌐' : '📝'}
              </span>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase tracking-wide">Формат</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {draft?.config?.cellFormat?.mode === 'formula' ? 'Формула' : 
                 draft?.config?.cellFormat?.mode === 'markdown' ? 'Markdown' :
                 draft?.config?.cellFormat?.mode === 'html' ? 'HTML' : 'Текст'}
              </div>
            </div>
          </div>
          
          {/* Webhook/Автоматизация */}
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              hasAutomations 
                ? 'bg-amber-100 dark:bg-amber-900/30' 
                : 'bg-gray-100 dark:bg-gray-700'
            }`}>
              <span className={`text-sm ${
                hasAutomations 
                  ? 'text-amber-600 dark:text-amber-400' 
                  : 'text-gray-400'
              }`}>
                {hasAutomations ? '⚡' : '—'}
              </span>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase tracking-wide">Webhook</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {hasAutomations ? 'Активен' : 'Нет'}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Индикатор webhook с URL */}
      {hasAutomations && draft?.config?.automation?.webhook?.url && (
        <div className="w-full pt-2 border-t border-orange-200 dark:border-orange-700">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-amber-600 dark:text-amber-400">⚡ Webhook:</span>
            <code className="flex-1 truncate bg-white/50 dark:bg-gray-800/50 px-2 py-0.5 rounded text-gray-700 dark:text-gray-300">
              {draft.config.automation.webhook.method} {draft.config.automation.webhook.url}
            </code>
          </div>
        </div>
      )}
    </div>
  );
};
