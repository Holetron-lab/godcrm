import React, { useMemo } from 'react';
import { ColumnModel } from '@/features/tables/types/table.types';

interface CellPreviewProps {
  draft: ColumnModel;
  originalColumn?: ColumnModel;
  firstRow?: Record<string, unknown> | null;
}

export const CellPreview: React.FC<CellPreviewProps> = ({ draft, originalColumn, firstRow }) => {
  // Получаем значение из первой строки
  const cellValue = useMemo(() => {
    if (!firstRow) return null;
    return firstRow[draft.name] ?? firstRow[draft.id] ?? null;
  }, [firstRow, draft]);

  const displayValue = cellValue !== null 
    ? String(cellValue)
    : (draft.type === 'checkbox' ? '☐' :
       draft.type === 'number' ? '0' :
       (draft.type as string) === 'date' ? new Date().toLocaleDateString() :
       draft.type === 'select' ? '— Не выбрано —' :
       'Пример текста');

  // Применяем форматирование из настроек draft
  const getFormattedValue = (value: string, config: typeof draft.config) => {
    let formatted = value;
    
    // Prefix/Suffix для text
    if (config?.text) {
      if (config.text.prefix) formatted = config.text.prefix + formatted;
      if (config.text.suffix) formatted = formatted + config.text.suffix;
    }
    
    // Prefix/Suffix для number
    if (config?.number) {
      if (config.number.prefix) formatted = config.number.prefix + formatted;
      if (config.number.suffix) formatted = formatted + config.number.suffix;
    }
    
    return formatted;
  };

  const beforeValue = originalColumn?.config ? getFormattedValue(displayValue, originalColumn.config) : displayValue;
  const afterValue = getFormattedValue(displayValue, draft.config);

  return (
    <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-primary-50 to-purple-50 dark:from-primary-100 dark:to-purple-900/20 rounded-lg border border-primary-200 dark:border-primary-800">
      {/* До */}
      <div className="flex-1">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
          До (первая ячейка)
        </div>
        <div 
          className="p-2 rounded-lg border-2 border-dashed border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-800 flex items-center overflow-hidden"
          style={{
            width: Math.min(originalColumn?.width || 150, 250),
            height: 40,
            fontFamily: originalColumn?.config?.appearance?.fontFamily || 'inherit',
            fontSize: originalColumn?.config?.appearance?.fontSize || '14px',
            color: originalColumn?.config?.appearance?.textColor || 'inherit',
            textAlign: originalColumn?.config?.appearance?.align || 'left'
          }}
        >
          <span className="truncate">{beforeValue}</span>
        </div>
      </div>

      {/* Стрелка */}
      <div className="flex-shrink-0 text-2xl text-primary-500 dark:text-primary-400">
        →
      </div>

      {/* После */}
      <div className="flex-1">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
          После (предпросмотр)
        </div>
        <div 
          className="p-2 rounded-lg border-2 border-purple-400 dark:border-purple-600 bg-white dark:bg-gray-800 flex items-center overflow-hidden"
          style={{
            width: Math.min(draft.width || 150, 250),
            height: 40,
            fontFamily: draft.config?.appearance?.fontFamily || 'inherit',
            fontSize: draft.config?.appearance?.fontSize || '14px',
            color: draft.config?.appearance?.textColor || 'inherit',
            textAlign: draft.config?.appearance?.align || 'left'
          }}
        >
          <span 
            className="truncate"
            style={{
              whiteSpace: draft.config?.cellFormat?.textWrap === 'wrap' ? 'pre-wrap' :
                         draft.config?.cellFormat?.textWrap === 'wrap-ellipsis' ? 'normal' :
                         'nowrap'
            }}
          >
            {afterValue}
          </span>
        </div>
      </div>
    </div>
  );
};
