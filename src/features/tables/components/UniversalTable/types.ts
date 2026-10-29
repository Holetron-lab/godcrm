import type { ColumnModel, ColumnConfig, TableConfig, TableModel, RowModel } from '../../types/table.types';
import type { useRowMutations } from '../../hooks/useRowMutations';
import type { RelationsMap } from '../../utils/resolveLens';

// Type for row mutation from useRowMutations hook
export type RowMutationType = ReturnType<typeof useRowMutations>;

export interface RenderCellOptions {
  column: ColumnModel;
  /** ADR-0035-A: all columns of the table, so an `address` cell can find its linked `geo_point` column by id. */
  columns?: ColumnModel[];
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
  /** ADR-205: server lens map of this table (column_name → key → related row). */
  relations?: RelationsMap;
}

export interface PaginationInfo {
  rowsCount: number;
  rowsLimit: number;
  currentPage: number;
  totalPages: number;
  /** Total rows in the table as reported by the server (0 when unknown). */
  totalRows: number;
  canLoadMore: boolean;
  /** First page of the loaded window (1 unless the view started at ?page=N or jumped to a row). */
  minLoadedPage: number;
}

export interface UniversalTableProps {
  // External data - if provided, use these instead of store
  table?: TableModel | { id: number; name: string; displayName?: string; projectId?: number; type?: string; config?: Partial<TableConfig>; data_source_id?: string | null; [key: string]: unknown };
  columns?: ColumnModel[];
  rows?: RowModel[];
  // Filters
  searchQuery?: string;
  searchColumns?: string[];
  selectFilters?: Record<string, string[]>;
  dateFilters?: Record<string, { from?: string; to?: string }>;
  groupByColumn?: string | null;
  // Column-menu shortcuts into the toolbar filters (search scope / group by); absent → items hidden
  onSearchColumnsChange?: (columnIds: string[]) => void;
  onGroupByColumnChange?: (columnId: string | null) => void;
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
}
