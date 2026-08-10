/**
 * CellPreview - Preview block showing raw data and rendered output
 */
import { ArrowRight } from 'lucide-react';
import { renderTypeCellPreview } from '../UniversalTable/column-settings';
import type { CellPreviewProps } from './types';

export const CellPreview = ({
  column,
  width,
  fontFamily,
  fontSize,
  textColor,
  align,
  rawValue,
  currentRow
}: CellPreviewProps) => {
  return (
    <div className="p-3 bg-gradient-to-r from-slate-50 to-primary-50 dark:from-slate-900/30 dark:to-primary-900/20 rounded-xl border border-slate-200 dark:border-slate-700">
      <div className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide mb-2">Предпросмотр</div>
      <div className="flex items-center gap-3">
        {/* Raw value */}
        <div className="flex-shrink-0" style={{ width: Math.min(width || 150, 200) }}>
          <div className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1">Raw данные</div>
          <div
            className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 flex items-center overflow-hidden font-mono text-sm"
          >
            <span className="truncate text-[var(--text-secondary)]">
              {rawValue !== null && rawValue !== undefined
                ? (typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue))
                : '\u2014'}
            </span>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center px-2 text-primary-400 dark:text-primary-500 flex-shrink-0">
          <ArrowRight className="w-5 h-5" />
        </div>

        {/* Rendered value */}
        <div className="flex-shrink-0" style={{ width: Math.min(width || 150, 200) }}>
          <div className="text-[10px] text-[var(--text-tertiary)] uppercase mb-1">Отображение</div>
          <div
            className="h-9 px-3 rounded-lg border-2 border-primary-400 dark:border-primary-500 bg-white dark:bg-slate-800 flex items-center overflow-hidden text-sm"
            style={{
              fontFamily: fontFamily || 'inherit',
              fontSize: fontSize ? `${fontSize}px` : '14px',
              color: textColor || 'inherit',
              textAlign: (align || 'left') as 'left' | 'center' | 'right',
              justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'
            }}
          >
            {renderTypeCellPreview(column, currentRow || undefined)}
          </div>
        </div>
      </div>
    </div>
  );
};
