import type { ColumnModel, ColumnOption } from '../../types/table.types';
import type { PaginationInfo } from '../UniversalTable/UniversalTable';

export interface DateRange {
  from?: string;
  to?: string;
}

export interface TableFiltersProps {
  columns: ColumnModel[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchColumns: string[];
  onSearchColumnsChange: (columnIds: string[])=> void;
  selectFilters: Record<string, string[]>;
  onSelectFiltersChange: (filters: Record<string, string[]>) => void;
  dateFilters: Record<string, DateRange>;
  onDateFiltersChange: (filters: Record<string, DateRange>) => void;
  activeFilterColumns: string[];
  onActiveFilterColumnsChange: (columnIds: string[]) => void;
  groupByColumn?: string | null;
  onGroupByColumnChange?: (columnId: string | null) => void;
  paginationInfo?: PaginationInfo | null;
  rowsLimit?: number;
  onRowsLimitChange?: (limit: number) => void;
  onPageChange?: (page: number) => void;
  onAddRow?: () => void;
  addRowText?: string; // Custom text for add row button
  onRefresh?: () => void;
  isExternal?: boolean;
  compact?: boolean; // Hide automations button, reduce padding
  projectId?: number; // For widget creation link
  rawMode?: boolean; // Whether in raw table mode
  tableIdProp?: number; // Table ID for widget creation with preselected table
  // Bulk replace
  onBulkReplace?: () => void;
  bulkReplaceDisabled?: boolean;
  showBulkReplace?: boolean;
  // Print
  onPrint?: () => void;
  showPrint?: boolean;
  // Table settings (gear icon)
  onTableSettings?: () => void;
  showTableSettings?: boolean;
}

export type { ColumnModel, ColumnOption, PaginationInfo };
