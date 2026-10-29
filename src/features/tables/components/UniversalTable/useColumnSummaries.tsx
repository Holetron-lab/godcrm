import { useMemo } from 'react';
import { Hash, Calendar, CheckSquare, List, Type, AlertCircle } from 'lucide-react';
import type { ColumnModel, ColumnOption, ColumnRelationConfig } from '../../types/table.types';
import type { ServerColumnSummary, TableSummaryState } from '../../hooks/useTableSummary';
import { isLensSelectColumn, lensMapToOptions, useMultiRelationOptions } from '../../hooks/useRelationOptions';
import type { LensEntry, RelationsMap } from '../../utils/resolveLens';
import { useLanguage, type LanguageContextValue } from '@/shared/i18n/LanguageContext';

/** Where the grid may take relation labels from without downloading the related table (ADR-205 AC6). */
export interface RelationLensSource {
  /** `relations` of GET /rows?include=relations — keyed by column name (or id), covers the loaded rows' keys. */
  relations?: RelationsMap;
  /** The grouped column keeps the related table's own option order, so it still loads the full list. */
  groupByColumn?: string | null;
  /** Footer totals (whole table): a top value of a select column that lives only on another page needs the full list. */
  summary?: TableSummaryState;
}

/** Keys the footer renders for a select column (see renderColumnTotals). */
const FOOTER_TOP_VALUES = 4;

const coveredByServerMap = (
  column: ColumnModel,
  map: Record<string, LensEntry> | undefined,
  rowCount: number,
  groupByColumn: string | null | undefined,
  summary: TableSummaryState | undefined,
): map is Record<string, LensEntry> => {
  if (!map || column.id === groupByColumn) return false;
  // Only the select footer labels its top values; and a key can be missing from the map because it
  // sits on a page that is not loaded — or because the related table has no such row, in which case
  // the download would not resolve it either. Only the first case is worth a request.
  if (column.type !== 'select' || summary?.status !== 'ready' || !summary.data) return true;
  const values = summary.data.columns[column.id];
  if (!values || summary.data.total <= rowCount) return true;
  return topValueCounts(values.valueCounts, FOOTER_TOP_VALUES).every(([key]) => key in map);
};

/**
 * Relation options for select/multi-select columns that reference other tables
 * (footer summaries, group headers, selection bar). ADR-205 D4: one shared
 * lookup per relation instead of a private download per surface; AC6: no
 * download at all while the server map already resolves everything shown.
 */
export function useRelationOptions(columns: ColumnModel[], rowCount: number, lens: RelationLensSource = {}): Map<string, ColumnOption[]> {
  const { relations, groupByColumn, summary } = lens;
  const { fromServer, toLoad } = useMemo(() => {
    const fromServer = new Map<string, ColumnOption[]>();
    const toLoad: Array<{ columnId: string; relation: ColumnRelationConfig | undefined }> = [];
    if (rowCount > 0) {
      for (const col of columns.filter(isLensSelectColumn)) {
        const map = relations?.[col.name] ?? relations?.[col.id];
        if (coveredByServerMap(col, map, rowCount, groupByColumn, summary)) fromServer.set(col.id, lensMapToOptions(map));
        else toLoad.push({ columnId: col.id, relation: col.config?.relation });
      }
    }
    return { fromServer, toLoad };
  }, [columns, rowCount, relations, groupByColumn, summary]);

  const loaded = useMultiRelationOptions(toLoad);
  return new Map([...fromServer, ...loaded]);
}

const formatNumber = (value: number, locale: string) => value.toLocaleString(locale, { maximumFractionDigits: 2 });
const formatDate = (iso: string, locale: string) => new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: '2-digit' });

/** Top option counts, most frequent first (the server map has no defined order). */
export const topValueCounts = (valueCounts: Record<string, number>, limit: number) =>
  Object.entries(valueCounts).sort((a, b) => b[1] - a[1]).slice(0, limit);

function renderColumnTotals(
  column: ColumnModel,
  values: ServerColumnSummary,
  { t, language }: Pick<LanguageContextValue, 't' | 'language'>,
  relationOptions?: ColumnOption[]
): React.ReactNode {
  const colType = column.type as string;

  // Number columns
  if (colType === 'number' || colType === 'integer' || colType === 'float' || colType === 'decimal') {
    if (values.numericCount === 0) return null;
    const summaryConfig = column.config?.summary;
    const showSum = summaryConfig?.sum !== false;
    const showAvg = summaryConfig?.avg !== false;
    const showCount = summaryConfig?.count === true;
    const showMin = summaryConfig?.min === true;
    const showMax = summaryConfig?.max === true;

    return (
      <div className="flex flex-col gap-0.5">
        {showSum && (
          <div className="flex items-center gap-1">
            <Hash className="h-3 w-3 text-primary-400" />
            <span className="text-primary-300">&Sigma;</span>
            <span className="font-medium text-[var(--text-primary)]">{formatNumber(values.sum, language)}</span>
          </div>
        )}
        {showAvg && values.avg !== null && (
          <div className="flex items-center gap-1">
            <span className="text-[var(--text-tertiary)]">avg:</span>
            <span className="text-[var(--text-secondary)]">{formatNumber(values.avg, language)}</span>
          </div>
        )}
        {showMin && values.min !== null && (
          <div className="flex items-center gap-1">
            <span className="text-[var(--text-tertiary)]">min:</span>
            <span className="text-green-400">{formatNumber(values.min, language)}</span>
          </div>
        )}
        {showMax && values.max !== null && (
          <div className="flex items-center gap-1">
            <span className="text-[var(--text-tertiary)]">max:</span>
            <span className="text-red-400">{formatNumber(values.max, language)}</span>
          </div>
        )}
        {showCount && (
          <div className="flex items-center gap-1">
            <span className="text-[var(--text-tertiary)]">n:</span>
            <span className="text-[var(--text-secondary)]">{values.numericCount}</span>
          </div>
        )}
      </div>
    );
  }

  // Select columns
  if (colType === 'select') {
    const entries = topValueCounts(values.valueCounts, 4);
    if (entries.length === 0) return null;
    const options = relationOptions || column.config?.options || [];
    return (
      <div className="flex flex-col gap-0.5">
        {entries.map(([value, count]) => {
          const opt = options.find((o: ColumnOption) => String(o.value) === value);
          const color = opt?.color || '#6b7280';
          const label = opt?.label || value;
          return (
            <span key={value} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: `${color}30`, color }}>
              <List className="h-2.5 w-2.5" />
              {label}: {count}
            </span>
          );
        })}
      </div>
    );
  }

  // Date columns
  if (colType === 'date' || colType === 'datetime') {
    if (values.dateCount === 0 || !values.earliest || !values.latest) return null;
    return (
      <div className="flex items-center gap-1">
        <Calendar className="h-3 w-3 text-green-400" />
        <span className="text-green-400">{formatDate(values.earliest, language)}</span>
        <span className="text-[var(--text-tertiary)]">&rarr;</span>
        <span className="text-green-400">{formatDate(values.latest, language)}</span>
      </div>
    );
  }

  // Checkbox columns
  if (colType === 'checkbox' || colType === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <CheckSquare className="h-3 w-3 text-cyan-400" />
        <span className="text-cyan-400">✓ {values.checked}</span>
        <span className="text-[var(--text-tertiary)]">|</span>
        <span className="text-[var(--text-tertiary)]">✗ {values.unchecked}</span>
      </div>
    );
  }

  // Text columns
  if (colType === 'text' || colType === 'email' || colType === 'url' || colType === 'phone') {
    return (
      <div className="flex items-center gap-1">
        <Type className="h-3 w-3 text-[var(--text-tertiary)]" />
        <span className="text-[var(--text-secondary)]">{t('table.summaryUnique', { count: values.countUnique })}</span>
      </div>
    );
  }

  // Default
  if (values.countFilled > 0) {
    return <span className="text-[var(--text-tertiary)]">{t('table.summaryFilled', { count: values.countFilled })}</span>;
  }
  return null;
}

/**
 * Footer summaries per column from the server response: the whole filtered set,
 * independent of how many pages the browser has loaded. While the server computes
 * (or refuses) nothing page-local is shown in its place.
 */
export function useColumnSummaries(
  summary: TableSummaryState,
  columns: ColumnModel[],
  relationOptionsMap: Map<string, ColumnOption[]> | undefined
) {
  const { t, language } = useLanguage();
  return useMemo(() => {
    const summaries = new Map<string, React.ReactNode>();
    if (summary.status === 'idle') return summaries;

    columns.forEach(column => {
      const values = summary.data?.columns[column.id];
      let content: React.ReactNode = null;
      let emptyCount = 0;

      if (summary.status === 'unavailable') {
        content = <span className="text-[var(--text-tertiary)]" title={summary.reason}>{t('table.summaryUnavailable')}</span>;
      } else if (summary.status === 'loading' || !values) {
        content = <span className="text-[var(--text-tertiary)]" aria-busy="true">…</span>;
      } else {
        emptyCount = values.countEmpty;
        content = renderColumnTotals(column, values, { t, language }, relationOptionsMap?.get(column.id));
      }

      summaries.set(column.id, (
        <div className="flex flex-col gap-0.5" title={summary.scope === 'loaded' ? t('table.summaryLoadedRows') : undefined}>
          {content || <span className="text-[var(--text-tertiary)]">&mdash;</span>}
          {emptyCount > 0 && (
            <div className="flex items-center gap-1 text-amber-500/70 text-[10px]">
              <AlertCircle className="h-2.5 w-2.5" />
              <span>{t('table.summaryEmpty', { count: emptyCount })}</span>
            </div>
          )}
        </div>
      ));
    });

    return summaries;
  }, [summary, columns, relationOptionsMap, t, language]);
}
