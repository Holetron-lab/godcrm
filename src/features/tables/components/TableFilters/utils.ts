import { useMemo } from 'react';
import type { ColumnModel, ColumnOption } from '../../types/table.types';
import { isLensSelectColumn, useMultiRelationOptions } from '../../hooks/useRelationOptions';

/** i18n key for a row-count label, pluralized per locale (ru: 1 строка / 3 строки / 5 строк). */
export const rowCountKey = (language: string, count: number) => {
  const category = new Intl.PluralRules(language).select(count);
  if (category === 'one') return 'table.rowCountOne' as const;
  if (category === 'few') return 'table.rowCountFew' as const;
  return 'table.rowCountMany' as const;
};

/** Get searchable columns (text, number, email, url, phone + select/relation for broader search) */
export const getSearchableColumns = (columns: ColumnModel[]) =>
  (columns || []).filter(col =>
    ['text', 'number', 'email', 'url', 'phone', 'select', 'relation', 'textarea'].includes(col.type || (col as any).column_type || '')
  );

/** Get select/multi-select columns for filtering */
export const getFilterableColumns = (columns: ColumnModel[]) =>
  (columns || []).filter(col =>
    ['select', 'multi-select', 'multi_select'].includes(col.type) &&
    (col.config?.options?.length || col.config?.relation?.enabled)
  );

/** Get date and select columns that can be added as filters */
export const getAvailableFilterColumns = (columns: ColumnModel[], activeFilterColumns: string[]) =>
  (columns || []).filter(col =>
    ['select', 'multi-select', 'multi_select', 'date', 'datetime'].includes(col.type) &&
    !(activeFilterColumns || []).includes(col.id)
  );

/** Get active filter columns to display */
export const getActiveFilters = (columns: ColumnModel[], activeFilterColumns: string[]) =>
  (columns || []).filter(col =>
    (activeFilterColumns || []).includes(col.id) &&
    ['select', 'multi-select', 'multi_select', 'date', 'datetime'].includes(col.type)
  );

/**
 * Relation options for filter dropdowns — ADR-205 D4: shared lookup, one request per relation.
 * AC6: the related table loads only for the columns in `openColumnIds` (dropdowns the user has
 * reached), so opening a grid downloads nothing; the list is complete once a dropdown is opened.
 */
export const useRelationOptions = (columns: ColumnModel[], openColumnIds: readonly string[]) => {
  const relations = useMemo(() => {
    const cols = Array.isArray(columns) ? columns : [];
    return cols
      .filter((col) => openColumnIds.includes(col.id) && isLensSelectColumn(col))
      .map((col) => ({ columnId: col.id, relation: col.config?.relation }));
  }, [columns, openColumnIds]);

  const relationOptionsMap = useMultiRelationOptions(relations);

  /** Helper to get options for a column (relation or static) */
  const getColumnOptions = (column: ColumnModel): ColumnOption[] => {
    const relationOpts = relationOptionsMap.get(column.id);
    return relationOpts && relationOpts.length > 0 ? relationOpts : column.config?.options || [];
  };

  return { relationOptionsMap, getColumnOptions };
};
