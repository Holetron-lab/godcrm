import { useMemo } from 'react';
import { AlertTriangle, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import { cellAddress } from './excel-utils';
import type { CSVFileData, ExcelWarning } from './types';

interface ExcelSheetPanelProps {
  file: CSVFileData;
  onSelectSheet: (fileId: string, sheetIndex: number) => void;
  onRetryPreview: (fileId: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

interface WarningGroup {
  code: string;
  message: string;
  count: number;
  cells: string[];
}

const UNVERIFIED = 'FORMULA_CACHE_UNVERIFIED';

export const groupWarnings = (warnings: ExcelWarning[]): { general: ExcelWarning[]; cells: WarningGroup[] } => {
  const general: ExcelWarning[] = [];
  const groups = new Map<string, WarningGroup>();
  for (const warning of warnings) {
    if (warning.rowIndex === undefined || warning.colIndex === undefined) {
      general.push(warning);
      continue;
    }
    const group = groups.get(warning.code) ?? { code: warning.code, message: warning.message, count: 0, cells: [] };
    group.count++;
    if (group.cells.length < 8) group.cells.push(cellAddress(warning.rowIndex, warning.colIndex));
    groups.set(warning.code, group);
  }
  return { general, cells: Array.from(groups.values()) };
};

// Sheet choice, preview state and warnings for one Excel entry. Images and
// other objects are never imported; this panel is where the user learns that.
export const ExcelSheetPanel = ({ file, onSelectSheet, onRetryPreview, t }: ExcelSheetPanelProps) => {
  const excel = file.excel;
  const grouped = useMemo(() => groupWarnings(excel?.warnings ?? []), [excel?.warnings]);
  if (!excel) return null;

  const selectId = `excel-sheet-${file.id}`;
  const sheetChosen = excel.sheetIndex !== null;
  const importState = excel.importState;

  return (
    <section
      aria-label={t('tables.create.excel.panelLabel')}
      className="space-y-3 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <FileSpreadsheet className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
        <span className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[280px]" title={file.fileName}>
          {file.fileName}
        </span>
        {excel.format && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
            {excel.format}
          </span>
        )}
        {excel.loading && (
          <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            {t('tables.create.excel.loading')}
          </span>
        )}
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="min-w-[240px] flex-1">
          <label htmlFor={selectId} className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">
            {t('tables.create.excel.sheet')}
          </label>
          <select
            id={selectId}
            value={sheetChosen ? String(excel.sheetIndex) : ''}
            disabled={excel.loading || excel.sheets.length === 0}
            onChange={(e) => { if (e.target.value !== '') onSelectSheet(file.id, Number(e.target.value)); }}
            className="w-full h-[30px] px-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] disabled:opacity-60"
          >
            <option value="" disabled>{t('tables.create.excel.selectSheet')}</option>
            {excel.sheets.map(sheet => (
              <option key={sheet.index} value={String(sheet.index)}>
                {sheet.name} ({t('tables.create.excel.sheetSize', { rows: sheet.rowCount, cols: sheet.columnCount })})
                {sheet.hidden ? ` — ${t('tables.create.excel.hidden')}` : ''}
              </option>
            ))}
          </select>
        </div>
        {excel.sheets.length > 1 && (
          <span className="text-xs text-[var(--text-tertiary)] pb-1.5">{t('tables.create.excel.otherSheets')}</span>
        )}
      </div>

      {excel.error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 text-sm">{excel.error}</div>
          <button
            type="button"
            onClick={() => onRetryPreview(file.id)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-red-500/40 hover:bg-red-500/20"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            {t('tables.create.excel.retry')}
          </button>
        </div>
      )}

      {sheetChosen && !excel.loading && (
        <div className="text-xs text-[var(--text-secondary)]">
          {t('tables.create.excel.sheetStats', {
            rows: Math.max(0, file.data.length - 1),
            empty: excel.emptyRowCount,
            skipped: excel.skippedCellCount,
          })}
        </div>
      )}

      {(grouped.general.length > 0 || grouped.cells.length > 0) && (
        <div className="space-y-1.5 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <div className="text-[10px] uppercase tracking-wide text-yellow-300/80">{t('tables.create.excel.warnings')}</div>
          <ul className="space-y-1 text-xs text-yellow-200">
            {grouped.general.map((warning, idx) => (
              <li key={`${warning.code}-${idx}`} className="flex gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span>{warning.message}</span>
              </li>
            ))}
            {grouped.cells.map(group => (
              <li
                key={group.code}
                className={`flex gap-2 ${group.code === UNVERIFIED ? 'font-medium text-orange-200' : ''}`}
                data-warning-code={group.code}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span>
                  {group.message} — {t('tables.create.excel.cellCount', { count: group.count })}
                  {group.cells.length > 0 && (
                    <span className="font-mono text-yellow-200/70"> ({group.cells.join(', ')}{group.count > group.cells.length ? ', …' : ''})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {importState?.error && (
        <div role="alert" className="space-y-1 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">
          <div>{t('tables.create.excel.importFailed', { error: importState.error })}</div>
          <div className="text-xs text-red-200/80">
            {importState.tableId
              ? t('tables.create.excel.retryKeepsTable', { tableId: importState.tableId })
              : t('tables.create.excel.retryHint')}
          </div>
        </div>
      )}
    </section>
  );
};
