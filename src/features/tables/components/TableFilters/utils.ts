import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel, ColumnOption } from '../../types/table.types';

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

/** Hook to find and load relation column options */
export const useRelationOptions = (columns: ColumnModel[]) => {
  const relationColumns = useMemo(() => {
    const cols = Array.isArray(columns) ? columns : [];
    return cols.filter(col =>
      ['select', 'multi-select', 'multi_select'].includes(col.type) &&
      col.config?.relation?.enabled &&
      col.config?.relation?.tableId &&
      col.config?.relation?.valueColumn &&
      col.config?.relation?.labelColumn
    );
  }, [columns]);

  const { data: relationOptionsMap } = useQuery({
    queryKey: ['filter-relation-options', relationColumns.map(c => `${c.id}:${c.config?.relation?.tableId}`).join(',')],
    queryFn: async () => {
      const map = new Map<string, ColumnOption[]>();

      for (const col of relationColumns) {
        const relation = col.config?.relation;
        if (!relation?.tableId || !relation?.valueColumn || !relation?.labelColumn) continue;

        try {
          const response = await apiClient.request<{
            data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
          }>(`/tables/${relation.tableId}/rows?limit=5000`);

          // Handle different response formats
          const responseData = response.data as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
          const rowsData = Array.isArray(responseData)
            ? responseData
            : ((responseData as { rows?: Array<Record<string, unknown>>; data?: { rows: Array<Record<string, unknown>> } })?.rows ||
               (responseData as { data?: { rows: Array<Record<string, unknown>> } })?.data?.rows || []);

          type RowItem = { id?: string | number; data?: Record<string, unknown>; originalId?: string | number };
          const options: ColumnOption[] = rowsData.map((row: RowItem) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data : (row as Record<string, unknown>);
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
          logger.error('Failed to load relation options for filter column', col.id, e);
        }
      }

      return map;
    },
    enabled: relationColumns.length > 0,
    staleTime: 60000,
  });

  /** Helper to get options for a column (relation or static) */
  const getColumnOptions = (column: ColumnModel): ColumnOption[] => {
    const relationOpts = relationOptionsMap?.get(column.id);
    return relationOpts || column.config?.options || [];
  };

  return { relationOptionsMap, getColumnOptions };
};
