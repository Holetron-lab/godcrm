import { useMemo } from 'react';
import type { RowModel, ColumnModel, ColumnOption } from '../../types/table.types';

export interface GroupedRow {
  key: string;
  label: string;
  color?: string;
  rows: RowModel[];
}

/**
 * Group rows by a column value. Returns null when no grouping is active.
 * Preserves option order from the group column's config (relation options
 * take precedence when provided).
 */
export function useGroupedRows(
  rows: RowModel[],
  columns: ColumnModel[],
  groupByColumn: string | null | undefined,
  relationOptionsMap: Map<string, ColumnOption[]> | undefined
) {
  const groupColumn = useMemo(() => {
    if (!groupByColumn) return null;
    return columns.find(c => c.id === groupByColumn) || null;
  }, [groupByColumn, columns]);

  const groupColumnOptions = useMemo(() => {
    if (!groupColumn) return [];
    const relationOpts = relationOptionsMap?.get(groupColumn.id);
    return relationOpts || groupColumn.config?.options || [];
  }, [groupColumn, relationOptionsMap]);

  const groupedRows = useMemo<GroupedRow[] | null>(() => {
    if (!groupByColumn || !groupColumn) {
      return null;
    }

    const groups = new Map<string, RowModel[]>();
    const ungrouped: RowModel[] = [];

    for (const row of rows) {
      const value = row.data[groupColumn.name] ?? row.data[groupColumn.id];
      if (value === null || value === undefined || value === '') {
        ungrouped.push(row);
      } else {
        const key = String(value);
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(row);
      }
    }

    const sortedGroups: GroupedRow[] = [];

    // Add groups in options order first
    for (const opt of groupColumnOptions) {
      if (groups.has(opt.value)) {
        sortedGroups.push({
          key: opt.value,
          label: opt.label || opt.value,
          color: opt.color,
          rows: groups.get(opt.value)!,
        });
        groups.delete(opt.value);
      }
    }

    // Add remaining groups (values not in options)
    for (const [key, groupRows] of groups) {
      sortedGroups.push({
        key,
        label: key,
        color: undefined,
        rows: groupRows,
      });
    }

    // Add ungrouped at the end
    if (ungrouped.length > 0) {
      sortedGroups.push({
        key: '__ungrouped__',
        label: 'Без группы',
        color: undefined,
        rows: ungrouped,
      });
    }

    return sortedGroups;
  }, [rows, groupByColumn, groupColumn, groupColumnOptions]);

  const displayColumns = useMemo(() => {
    if (!groupByColumn) return columns;
    return columns.filter(c => c.id !== groupByColumn);
  }, [columns, groupByColumn]);

  return { groupedRows, groupColumn, displayColumns };
}
