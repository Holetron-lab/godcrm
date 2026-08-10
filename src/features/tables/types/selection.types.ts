/**
 * Row Selection Types
 * Типы для функциональности выделения строк и массовой замены
 */

// Selection state
export interface RowSelectionState {
  selectedRowIds: Set<string | number>;
  selectionMode: 'none' | 'some' | 'all';
  selectionSort: SelectionSortMode;
}

export type SelectionSortMode = 'default' | 'selected-first' | 'selected-last';

// Bulk replace config
export interface BulkReplaceConfig {
  targetScope: 'selected' | 'filtered' | 'all';
  columnId: string;
  operationType: BulkReplaceOperationType;
  
  // For replace operation
  findValue?: string;
  replaceValue?: string;
  caseSensitive?: boolean;
  useRegex?: boolean;
  
  // For addText (prefix + suffix)
  prependValue?: string;
  appendValue?: string;
  
  // For formula
  formula?: string;
}

export type BulkReplaceOperationType = 'replace' | 'addText' | 'clear' | 'formula';

// Replace preview item
export interface ReplacePreviewItem {
  rowId: string | number;
  rowIndex: number;
  currentValue: unknown;
  newValue: unknown;
  columnName: string;
}

// Bulk replace result
export interface BulkReplaceResult {
  success: boolean;
  totalProcessed: number;
  totalChanged: number;
  errors?: Array<{ rowId: string; error: string }>;
}

// Batch update request for API
export interface BatchUpdateRequest {
  updates: Array<{
    rowId: string | number;
    data: Record<string, unknown>;
  }>;
}

// Batch update response from API
export interface BatchUpdateResponse {
  success: boolean;
  updated: number;
  errors?: Array<{ rowId: string; error: string }>;
}
