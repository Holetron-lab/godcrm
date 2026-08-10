import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hash, Calendar, CheckSquare, List, Type, AlertCircle } from 'lucide-react';
import type { RowModel, ColumnModel, ColumnOption } from '../../types/table.types';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';

/**
 * Load relation options for select/multi-select columns that reference other tables.
 * Used by both column summaries and group headers.
 */
export function useRelationOptions(columns: ColumnModel[], rowCount: number) {
  const relationColumns = useMemo(() => {
    return columns.filter(col =>
      ['select', 'multi-select', 'multi_select'].includes(col.type) &&
      col.config?.relation?.enabled &&
      col.config?.relation?.tableId &&
      col.config?.relation?.valueColumn &&
      col.config?.relation?.labelColumn
    );
  }, [columns]);

  const { data: relationOptionsMap } = useQuery({
    queryKey: ['footer-relation-options', relationColumns.map(c => `${c.id}:${c.config?.relation?.tableId}`).join(',')],
    queryFn: async () => {
      const map = new Map<string, ColumnOption[]>();

      for (const col of relationColumns) {
        const relation = col.config?.relation;
        if (!relation?.tableId || !relation?.valueColumn || !relation?.labelColumn) continue;

        try {
          const response = await apiClient.request<{
            data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
          }>(`/tables/${relation.tableId}/rows?limit=5000`);

          interface ApiRowData {
            id?: string | number;
            originalId?: string | number;
            data?: Record<string, unknown>;
            [key: string]: unknown;
          }
          const responseData = response.data as { rows?: ApiRowData[] } | ApiRowData[];
          const rowsData: ApiRowData[] = Array.isArray(responseData)
            ? responseData
            : (responseData?.rows || []);

          const options: ColumnOption[] = rowsData.map((row: ApiRowData) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data : row;
            const rowId = row.id;
            const originalId = row.originalId;

            let val: string;
            if (relation.valueColumn === 'id') {
              val = String(originalId ?? rowData['id'] ?? rowId ?? '');
            } else {
              val = String(rowData[relation.valueColumn] ?? '');
            }

            return {
              value: val,
              label: String(rowData[relation.labelColumn] ?? ''),
              color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
            };
          });

          map.set(col.id, options);
        } catch (e) {
          logger.error('Failed to load relation options for column', col.id, e);
        }
      }

      return map;
    },
    enabled: relationColumns.length > 0 && rowCount > 0,
    staleTime: 60000,
  });

  return relationOptionsMap;
}

/**
 * Compute column summaries for the footer row.
 * Shows aggregated stats (sum, avg, counts, date ranges, etc.) per column.
 */
export function useColumnSummaries(
  rows: RowModel[],
  columns: ColumnModel[],
  relationOptionsMap: Map<string, ColumnOption[]> | undefined
) {
  return useMemo(() => {
    if (!rows.length) return new Map<string, React.ReactNode>();

    const summaries = new Map<string, React.ReactNode>();

    columns.forEach(column => {
      const values = rows.map(row => row.data[column.name] ?? row.data[column.id]);
      const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '');
      const emptyCount = values.length - nonEmpty.length;
      const colType = column.type as string;

      let content: React.ReactNode = null;

      // Number columns
      if (colType === 'number' || colType === 'integer' || colType === 'float' || colType === 'decimal') {
        const nums = nonEmpty.map(v => parseFloat(String(v))).filter(n => !isNaN(n));
        if (nums.length > 0) {
          const sum = nums.reduce((a, b) => a + b, 0);
          const avg = sum / nums.length;

          const summaryConfig = column.config?.summary;
          const showSum = summaryConfig?.sum !== false;
          const showAvg = summaryConfig?.avg !== false;
          const showCount = summaryConfig?.count === true;
          const showMin = summaryConfig?.min === true;
          const showMax = summaryConfig?.max === true;

          const min = Math.min(...nums);
          const max = Math.max(...nums);

          content = (
            <div className="flex flex-col gap-0.5">
              {showSum && (
                <div className="flex items-center gap-1">
                  <Hash className="h-3 w-3 text-primary-400" />
                  <span className="text-primary-300">&Sigma;</span>
                  <span className="font-medium text-[var(--text-primary)]">{sum.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {showAvg && (
                <div className="flex items-center gap-1">
                  <span className="text-[var(--text-tertiary)]">avg:</span>
                  <span className="text-[var(--text-secondary)]">{avg.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {showMin && (
                <div className="flex items-center gap-1">
                  <span className="text-[var(--text-tertiary)]">min:</span>
                  <span className="text-green-400">{min.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {showMax && (
                <div className="flex items-center gap-1">
                  <span className="text-[var(--text-tertiary)]">max:</span>
                  <span className="text-red-400">{max.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {showCount && (
                <div className="flex items-center gap-1">
                  <span className="text-[var(--text-tertiary)]">n:</span>
                  <span className="text-[var(--text-secondary)]">{nums.length}</span>
                </div>
              )}
            </div>
          );
        }
      }
      // Select columns
      else if (colType === 'select') {
        const counts: Record<string, number> = {};
        nonEmpty.forEach(v => { counts[String(v)] = (counts[String(v)] || 0) + 1; });

        const relationOpts = relationOptionsMap?.get(column.id);
        const options = relationOpts || column.config?.options || [];

        const entries = Object.entries(counts).slice(0, 4);
        if (entries.length > 0) {
          content = (
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
      }
      // Date columns
      else if (colType === 'date' || colType === 'datetime') {
        const dates = nonEmpty.map(v => new Date(String(v))).filter(d => !isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
        if (dates.length > 0) {
          const fmt = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' });
          content = (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-green-400" />
              <span className="text-green-400">{fmt(dates[0])}</span>
              <span className="text-[var(--text-tertiary)]">&rarr;</span>
              <span className="text-green-400">{fmt(dates[dates.length - 1])}</span>
            </div>
          );
        }
      }
      // Checkbox columns
      else if (colType === 'checkbox' || colType === 'boolean') {
        const checked = nonEmpty.filter(v => v === true || v === 1 || v === '1' || v === 'true').length;
        content = (
          <div className="flex items-center gap-2">
            <CheckSquare className="h-3 w-3 text-cyan-400" />
            <span className="text-cyan-400">&check; {checked}</span>
            <span className="text-[var(--text-tertiary)]">|</span>
            <span className="text-[var(--text-tertiary)]">&cross; {nonEmpty.length - checked}</span>
          </div>
        );
      }
      // Text columns
      else if (colType === 'text' || colType === 'email' || colType === 'url' || colType === 'phone') {
        const unique = new Set(nonEmpty.map(v => String(v))).size;
        content = (
          <div className="flex items-center gap-1">
            <Type className="h-3 w-3 text-[var(--text-tertiary)]" />
            <span className="text-[var(--text-secondary)]">{unique} уник.</span>
          </div>
        );
      }
      // Default
      else if (nonEmpty.length > 0) {
        content = <span className="text-[var(--text-tertiary)]">{nonEmpty.length} знач.</span>;
      }

      // Wrap with empty count if needed
      summaries.set(column.id, (
        <div className="flex flex-col gap-0.5">
          {content || <span className="text-[var(--text-tertiary)]">&mdash;</span>}
          {emptyCount > 0 && (
            <div className="flex items-center gap-1 text-amber-500/70 text-[10px]">
              <AlertCircle className="h-2.5 w-2.5" />
              <span>{emptyCount} пустых</span>
            </div>
          )}
        </div>
      ));
    });

    return summaries;
  }, [rows, columns, relationOptionsMap]);
}
