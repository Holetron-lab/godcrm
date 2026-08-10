import { useMemo, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import type { ColumnModel, RowModel, LinkedVariableRef, LinkedVariablesMap } from '../types/table.types';
import { apiClient } from '@/shared/utils/apiClient';

/**
 * Aggregation type for column summary
 */
export type AggregationType = 
  | 'sum' | 'avg' | 'min' | 'max' | 'count'
  | 'countUnique' | 'countEmpty' | 'countFilled'
  | 'checked' | 'unchecked' | 'percentChecked'
  | 'earliest' | 'latest' | 'dateRange'
  | 'percentFilled';

/**
 * Calculated summary values for a column
 */
export interface ColumnSummaryValues {
  sum: number;
  avg: number;
  min: number;
  max: number;
  count: number;
  countUnique?: number;
  countEmpty: number;
  countFilled: number;
  checked?: number;
  unchecked?: number;
  percentChecked?: number;
  earliest?: string | Date;
  latest?: string | Date;
  dateRange?: number;
  percentFilled?: number;
}

export interface UseColumnSummaryParams {
  column: Partial<ColumnModel>;
  rows: RowModel[];
  tableId?: number;
  spaceId?: number;
}

export interface UseColumnSummaryResult {
  /** Calculated aggregation values */
  values: ColumnSummaryValues;
  /** List of enabled aggregation types based on config */
  enabled: AggregationType[];
  /** Map of aggregation type to linked variable */
  linkedVariables: Partial<LinkedVariablesMap>;
  /** Export an aggregation to a Variable */
  exportToVariable: (aggregation: AggregationType) => Promise<{
    id: number;
    name: string;
    formula: string;
  } | null>;
  /** Check if an aggregation is linked to a variable */
  isLinked: (aggregation: AggregationType) => boolean;
}

/**
 * useColumnSummary - ADR-026 Sprint 2.5
 * 
 * Hook for calculating column summary aggregations and managing
 * their links to Variables.
 * 
 * @example
 * ```tsx
 * const { values, enabled, exportToVariable, linkedVariables } = useColumnSummary({
 *   column: myColumn,
 *   rows: tableRows,
 *   tableId: 42,
 *   spaceId: 1,
 * });
 * 
 * // Display sum if enabled
 * if (enabled.includes('sum')) {
 *   logger.debug('Sum:', values.sum);
 * }
 * 
 * // Export to variable
 * const variable = await exportToVariable('sum');
 * ```
 */
export function useColumnSummary({
  column,
  rows,
  tableId,
  spaceId,
}: UseColumnSummaryParams): UseColumnSummaryResult {
  
  // Get column config
  const summaryConfig = column.config?.summary || {};
  const linkedVariables = summaryConfig.linkedVariables || {};

  // Calculate aggregation values
  const values = useMemo<ColumnSummaryValues>(() => {
    const columnName = column.name || column.id;
    
    // Extract values from rows
    const rawValues = rows.map(row => row.data?.[columnName as string]);
    const numericValues = rawValues
      .filter((v): v is number => v !== null && v !== undefined && v !== '' && !isNaN(Number(v)))
      .map(Number);
    
    const count = rows.length;
    const countFilled = rawValues.filter(v => v !== null && v !== undefined && v !== '').length;
    const countEmpty = count - countFilled;

    // If no numeric values, return defaults
    if (numericValues.length === 0) {
      return {
        sum: 0,
        avg: 0,
        min: 0,
        max: 0,
        count,
        countEmpty,
        countFilled,
      };
    }

    const sum = numericValues.reduce((a, b) => a + b, 0);
    const avg = numericValues.length > 0 ? sum / numericValues.length : 0;
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);

    return {
      sum,
      avg,
      min,
      max,
      count,
      countEmpty,
      countFilled,
    };
  }, [column.name, column.id, rows]);

  // Get enabled aggregations from config
  const enabled = useMemo<AggregationType[]>(() => {
    const enabledTypes: AggregationType[] = [];
    
    const allTypes: AggregationType[] = [
      'sum', 'avg', 'min', 'max', 'count',
      'countUnique', 'countEmpty', 'countFilled',
      'checked', 'unchecked', 'percentChecked',
      'earliest', 'latest', 'dateRange', 'percentFilled',
    ];

    for (const type of allTypes) {
      if (summaryConfig[type] === true) {
        enabledTypes.push(type);
      }
    }

    return enabledTypes;
  }, [summaryConfig]);

  // Check if aggregation is linked
  const isLinked = useCallback((aggregation: AggregationType): boolean => {
    return !!linkedVariables[aggregation];
  }, [linkedVariables]);

  // Export aggregation to variable
  const exportToVariable = useCallback(async (aggregation: AggregationType): Promise<{
    id: number;
    name: string;
    formula: string;
  } | null> => {
    if (!tableId || !column.id) {
      logger.warn('Cannot export: tableId or columnId missing');
      return null;
    }

    try {
      const response = await apiClient.post(
        `/api/v3/tables/${tableId}/columns/${column.id}/summary-variable`,
        { aggregation }
      );

      if (response.success && response.data?.variable) {
        return response.data.variable;
      }

      return null;
    } catch (error) {
      logger.error('Failed to export to variable:', error);
      throw error;
    }
  }, [tableId, column.id]);

  return {
    values,
    enabled,
    linkedVariables,
    exportToVariable,
    isLinked,
  };
}

export default useColumnSummary;
