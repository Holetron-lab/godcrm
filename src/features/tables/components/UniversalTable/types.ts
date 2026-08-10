import type { ColumnModel, ColumnConfig, TableModel, RowModel } from '../../types/table.types';
import type { useRowMutations } from '../../hooks/useRowMutations';

// Type for row mutation from useRowMutations hook
export type RowMutationType = ReturnType<typeof useRowMutations>;

export interface RenderCellOptions {
  column: ColumnModel;
  value: unknown;
  rowId?: string;
  rowData?: Record<string, unknown>;
  rawMode?: boolean;
  isInlineExpanded?: boolean;
  onOpenNestedTable?: (tableId: string, filterColumn: string, filterValue: string, config?: ColumnConfig) => void;
  onToggleInlineExpand?: (tableId: string, filterColumn: string, filterValue: string) => void;
  onNavigateToRow?: (tableId: string, rowId: string, valueColumn?: string) => void;
  onAutomationTrigger?: (automationId: string, rowId: string, rowData: Record<string, unknown>) => Promise<void>;
  tableId?: number | string;
}

export interface PaginationInfo {
  rowsCount: number;
  rowsLimit: number;
  currentPage: number;
  totalPages: number;
  canLoadMore: boolean;
}

export interface UniversalTableProps {
  // External data - if provided, use these instead of store
  table?: TableModel | { id: number; name: string; displayName?: string; projectId?: number; type?: string; data_source_id?: string | null; [key: string]: unknown };
  columns?: ColumnModel[];
  rows?: RowModel[];
  // Filters
  searchQuery?: string;
  searchColumns?: string[];
  selectFilters?: Record<string, string[]>;
  dateFilters?: Record<string, { from?: string; to?: string }>;
  groupByColumn?: string | null;
  addRowModalOpen?: boolean;
  onCloseAddRowModal?: () => void;
  onPaginationChange?: (info: PaginationInfo) => void;
  onLoadMore?: () => void;
  rawMode?: boolean; // Show raw data without formatting
  readOnly?: boolean;
  compact?: boolean;
  disableNestedModals?: boolean; // Prevent nested NestedTableModals
  spaceId?: number; // Space ID for creating system tables
  // Callback for instant local updates (used by nested tables)
  onLocalCellUpdate?: (rowId: string, columnId: string, value: unknown) => void;
  // Bulk replace modal control from parent
  bulkReplaceOpen?: boolean;
  onBulkReplaceOpenChange?: (open: boolean) => void;
  // Print modal control from parent
  printOpen?: boolean;
  onPrintOpenChange?: (open: boolean) => void;
  // Print path info
  spaceName?: string;
  projectName?: string;
  // Summary bar (ADR-026)
  showSummaryBar?: boolean;
}
