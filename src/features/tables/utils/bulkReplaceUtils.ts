import type { 
  BulkReplaceConfig, 
  ReplacePreviewItem, 
  SelectionSortMode 
} from '../types/selection.types';
import type { ColumnModel, RowModel } from '../types/table.types';
import { logger } from '@/shared/utils/logger';

/**
 * Escape special regex characters in string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Evaluate formula with row data context
 * Supports: {{column_key}}, {{row_id}}, {{value}} (current cell value)
 * Math expressions: +, -, *, /, ()
 * String concatenation via template
 */
export function evaluateFormulaForBulkReplace(
  formula: string,
  currentValue: unknown,
  rowData: Record<string, unknown>
): unknown {
  if (!formula) return currentValue;
  
  // Replace {{variable}} placeholders with actual values
  let processed = formula.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key === 'value') {
      return String(currentValue ?? '');
    }
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '0';
    }
    const columnValue = rowData[key];
    if (columnValue === null || columnValue === undefined) {
      return '0';
    }
    return String(columnValue);
  });

  // Try to evaluate as math expression
  try {
    // Check if it looks like a math expression (contains operators and only numbers/operators/spaces/parens)
    if (/[\+\-\*\/]/.test(processed) && /^[\d\s\+\-\*\/\.\(\)]+$/.test(processed.trim())) {
      // Safe eval for simple math expressions only
      const result = Function(`'use strict'; return (${processed})`)();
      // Round to 2 decimal places if it's a float
      if (typeof result === 'number' && !Number.isInteger(result)) {
        return Math.round(result * 100) / 100;
      }
      return result;
    }
  } catch (e) {
    // If evaluation fails, return as-is
  }
  
  return processed;
}

/**
 * Replace {{variable}} placeholders with values (no math evaluation)
 */
export function replaceVariables(
  template: string,
  currentValue: unknown,
  rowData: Record<string, unknown>
): string {
  if (!template) return '';
  
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key === 'value') {
      return String(currentValue ?? '');
    }
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '';
    }
    const columnValue = rowData[key];
    if (columnValue === null || columnValue === undefined) {
      return '';
    }
    return String(columnValue);
  });
}

/**
 * Calculate new value based on bulk replace config
 */
export function calculateNewValue(
  currentValue: unknown,
  config: BulkReplaceConfig,
  rowData?: Record<string, unknown>
): unknown {
  const strValue = String(currentValue ?? '');
  
  switch (config.operationType) {
    case 'replace': {
      if (!config.findValue) return currentValue;
      
      // Подставляем переменные в replaceValue
      const replacement = config.replaceValue 
        ? replaceVariables(config.replaceValue, currentValue, rowData || {})
        : '';
      
      if (config.useRegex) {
        try {
          const flags = config.caseSensitive ? 'g' : 'gi';
          const regex = new RegExp(config.findValue, flags);
          return strValue.replace(regex, replacement);
        } catch (e) {
          // Invalid regex, return original
          logger.error('Invalid regex:', e);
          return currentValue;
        }
      }
      
      if (config.caseSensitive) {
        return strValue.split(config.findValue).join(replacement);
      }
      
      // Case-insensitive replace
      const pattern = escapeRegex(config.findValue);
      const regex = new RegExp(pattern, 'gi');
      return strValue.replace(regex, replacement);
    }
      
    case 'addText': {
      // Подставляем переменные в prefix/suffix
      const prefix = config.prependValue 
        ? replaceVariables(config.prependValue, currentValue, rowData || {})
        : '';
      const suffix = config.appendValue 
        ? replaceVariables(config.appendValue, currentValue, rowData || {})
        : '';
      return prefix + strValue + suffix;
    }
      
    case 'clear':
      return '';
      
    case 'formula':
      if (!config.formula) return currentValue;
      return evaluateFormulaForBulkReplace(config.formula, currentValue, rowData || {});
      
    default:
      return currentValue;
  }
}

/**
 * Get target row IDs based on scope
 */
export function getTargetRowIds(
  scope: BulkReplaceConfig['targetScope'],
  ids: {
    selected: Set<string | number>;
    filtered: (string | number)[];
    all: (string | number)[];
  }
): Set<string | number> {
  switch (scope) {
    case 'selected':
      return ids.selected;
    case 'filtered':
      return new Set(ids.filtered);
    case 'all':
      return new Set(ids.all);
    default:
      return new Set();
  }
}

/**
 * Generate preview of changes before bulk replace
 */
export function generateReplacePreview(
  config: BulkReplaceConfig,
  rows: RowModel[],
  columns: ColumnModel[],
  targetRowIds: Set<string | number>,
  limit: number = 10
): { preview: ReplacePreviewItem[]; totalChanges: number } {
  const column = columns.find(c => c.id === config.columnId);
  if (!column) return { preview: [], totalChanges: 0 };
  
  const preview: ReplacePreviewItem[] = [];
  let totalChanges = 0;
  let rowIndex = 0;
  
  for (const row of rows) {
    // Skip rows not in target set
    if (!targetRowIds.has(row.id)) {
      rowIndex++;
      continue;
    }
    
    // Get value by column ID or name
    const currentValue = row.data[column.id] ?? row.data[column.name];
    const newValue = calculateNewValue(currentValue, config, row.data);
    
    // Only count as change if value actually differs
    if (String(newValue) !== String(currentValue)) {
      totalChanges++;
      
      // Only add to preview if under limit
      if (preview.length < limit) {
        preview.push({
          rowId: row.id,
          rowIndex: rowIndex + 1, // 1-based for display
          currentValue,
          newValue,
          columnName: column.displayName || column.name
        });
      }
    }
    
    rowIndex++;
  }
  
  return { preview, totalChanges };
}

/**
 * Sort rows with selection priority
 */
export function sortRowsWithSelection<T extends { id: string | number }>(
  rows: T[],
  selectionSort: SelectionSortMode,
  selectedRowIds: Set<string | number>
): T[] {
  if (selectionSort === 'default') {
    return rows;
  }
  
  const selected: T[] = [];
  const unselected: T[] = [];
  
  for (const row of rows) {
    if (selectedRowIds.has(row.id)) {
      selected.push(row);
    } else {
      unselected.push(row);
    }
  }
  
  if (selectionSort === 'selected-first') {
    return [...selected, ...unselected];
  }
  
  if (selectionSort === 'selected-last') {
    return [...unselected, ...selected];
  }
  
  return rows;
}

/**
 * Prepare batch update payload from bulk replace config
 */
export function prepareBatchUpdatePayload(
  config: BulkReplaceConfig,
  rows: RowModel[],
  columns: ColumnModel[],
  targetRowIds: Set<string | number>
): Array<{ rowId: string | number; data: Record<string, unknown> }> {
  const column = columns.find(c => c.id === config.columnId);
  if (!column) return [];
  
  const updates: Array<{ rowId: string | number; data: Record<string, unknown> }> = [];
  
  for (const row of rows) {
    if (!targetRowIds.has(row.id)) continue;
    
    const currentValue = row.data[column.id] ?? row.data[column.name];
    const newValue = calculateNewValue(currentValue, config, row.data);
    
    // Only include if value changed
    if (String(newValue) !== String(currentValue)) {
      updates.push({
        rowId: row.id,
        data: { [column.id]: newValue }
      });
    }
  }
  
  return updates;
}
