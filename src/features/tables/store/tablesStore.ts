import { create } from 'zustand';
import { ColumnModel, PersonalSpaceSummary, RowModel, TableModel } from '../types/table.types';

// ADR-0011: verification gate modal state — opened when backend returns 409
// VERIFICATION_REQUIRED or 403 VERIFICATION_IMMUTABLE during a row update.
export interface VerificationGateState {
  tableId: string;
  rowId: string;
  verificationColumnId: number;
  verificationColumnName: string;
  offendingColumn: string | null;
  offendingValue: string | null;
  offendingPrevValue: unknown;
  reason: 'required' | 'immutable';
  message: string;
}

interface TablesState {
  tables: TableModel[];
  columns: Record<string, ColumnModel[]>;
  rows: Record<string, RowModel[]>;
  tableRoles: Record<string, string>; // User role per table (owner/admin/editor/viewer)
  rowsVersion: number; // Increment on every row update to trigger re-renders
  successCells: Set<string>; // Keys of cells that just saved successfully (rowId-columnId)
  pendingClicks: Record<string, number>; // Keys of cells with pending clicks (rowId-columnId -> click count)
  clickBadgePosition: { x: number; y: number } | null; // Position for floating click badge
  activeTableId: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  contextUserId: number | null;
  personalSummary: PersonalSpaceSummary | null;
  rowsLimit: number;
  currentPage: number;
  minLoadedPage: number;
  totalPages: Record<string, number>;
  totalRows: Record<string, number>;
  sortColumn: string | null; // Column ID for server-side sorting
  sortDirection: 'asc' | 'desc' | null; // Sort direction for server-side sorting
  exportModalOpen: boolean;
  importModalOpen: boolean;
  createFromCsvModalOpen: boolean;
  verificationGate: VerificationGateState | null;
}

interface TablesActions {
  setTables: (tables: TableModel[]) => void;
  addTable: (table: TableModel) => void;
  setColumns: (tableId: string, columns: ColumnModel[]) => void;
  setTableRole: (tableId: string, role: string) => void;
  upsertColumn: (tableId: string, column: ColumnModel) => void;
  setRows: (tableId: string, rows: RowModel[]) => void;
  appendRows: (tableId: string, rows: RowModel[]) => void;
  selectTable: (tableId: string | null) => void;
  setContextUserId: (userId: number | null) => void;
  updateCell: (tableId: string, rowId: string, columnId: string, value: unknown) => void;
  updateRow: (tableId: string, rowId: string, data: Record<string, unknown>) => void;
  flashCellSuccess: (rowId: string, columnId: string) => void;
  addPendingClick: (rowId: string, columnId: string, direction: 1 | -1, cursorX: number, cursorY: number) => void;
  clearPendingClicks: (rowId: string, columnId: string) => void;
  setColumnVisibility: (tableId: string, columnId: string, isVisible: boolean) => void;
  setColumnWidth: (tableId: string, columnId: string, width: number) => void;
  setLoading: (loading: boolean) => void;
  setLoadingMore: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setPersonalSummary: (summary: PersonalSpaceSummary | null) => void;
  setRowsLimit: (limit: number) => void;
  setCurrentPage: (page: number) => void;
  setMinLoadedPage: (page: number) => void;
  setPagination: (tableId: string, totalPages: number, totalRows: number) => void;
  setSorting: (sortColumn: string | null, sortDirection: 'asc' | 'desc' | null) => void;
  setExportModalOpen: (open: boolean) => void;
  setImportModalOpen: (open: boolean) => void;
  setCreateFromCsvModalOpen: (open: boolean) => void;
  openVerificationGate: (gate: VerificationGateState) => void;
  closeVerificationGate: () => void;
}

export const useTablesStore = create<TablesState & TablesActions>((set) => ({
  tables: [],
  columns: {},
  rows: {},
  tableRoles: {},
  rowsVersion: 0,
  successCells: new Set<string>(),
  pendingClicks: {},
  clickBadgePosition: null,
  activeTableId: null,
  loading: false,
  loadingMore: false,
  error: null,
  contextUserId: null,
  personalSummary: null,
  rowsLimit: 50,
  currentPage: 1,
  minLoadedPage: 1,
  totalPages: {},
  totalRows: {},
  sortColumn: null,
  sortDirection: null,
  exportModalOpen: false,
  importModalOpen: false,
  createFromCsvModalOpen: false,
  verificationGate: null,
  setTables: (tables) => set({ tables }),
  addTable: (table) =>
    set((state) => ({
      tables: [...state.tables, table]
    })),
  setColumns: (tableId, columns) => {
    // Deduplicate columns by ID (keep first occurrence)
    const seen = new Set<string>();
    const uniqueColumns = columns.filter(col => {
      const id = String(col.id);
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
    return set((state) => ({ columns: { ...state.columns, [tableId]: uniqueColumns } }));
  },
  setTableRole: (tableId, role) =>
    set((state) => ({ tableRoles: { ...state.tableRoles, [tableId]: role } })),
  upsertColumn: (tableId, column) =>
    set((state) => {
      const tableColumns = state.columns[tableId] ?? [];
      // IMPORTANT: Convert IDs to string for comparison (API might return number)
      const columnId = String(column.id);
      const exists = tableColumns.some((item) => String(item.id) === columnId);
      const nextColumns = exists
        ? tableColumns.map((item) => (String(item.id) === columnId ? { ...column, id: columnId } : item))
        : [...tableColumns, { ...column, id: columnId }];
      return { columns: { ...state.columns, [tableId]: nextColumns } };
    }),
  setRows: (tableId, rows) => {
    // Deduplicate rows by ID (keep first occurrence)
    const seen = new Set<string>();
    const uniqueRows = rows.filter(row => {
      const id = String(row.id);
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
    return set((state) => ({ rows: { ...state.rows, [tableId]: uniqueRows } }));
  },
  appendRows: (tableId, rows) => {
    return set((state) => {
      const existingRows = state.rows[tableId] ?? [];
      const existingIds = new Set(existingRows.map(r => String(r.id)));
      // Filter out duplicates (both from existing and within incoming rows)
      const seen = new Set<string>();
      const newRows = rows.filter(r => {
        const id = String(r.id);
        if (existingIds.has(id) || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      });
      return {
        rows: { ...state.rows, [tableId]: [...existingRows, ...newRows] }
      };
    });
  },
  selectTable: (tableId) => set({ activeTableId: tableId }),
  setContextUserId: (userId) => set({ contextUserId: userId }),
  updateCell: (tableId, rowId, columnId, value) =>
    set((state) => {
      const tableRows = state.rows[tableId] ?? [];
      
      // Important: compare as strings since row.id can be number or string (ext_...)
      let found = false;
      const nextRows = tableRows.map((row) => {
        const match = String(row.id) === String(rowId);
        if (match) {
          found = true;
        }
        return match ? { ...row, data: { ...row.data, [columnId]: value } } : row;
      });
      
      return { 
        rows: { ...state.rows, [tableId]: nextRows },
        rowsVersion: state.rowsVersion + 1
      };
    }),
  updateRow: (tableId, rowId, data) =>
    set((state) => {
      const tableRows = state.rows[tableId] ?? [];
      
      const nextRows = tableRows.map((row) => {
        const match = String(row.id) === String(rowId);
        if (match) {
          // Merge new data with existing row data
          return { ...row, data: { ...row.data, ...data } };
        }
        return row;
      });
      
      return { 
        rows: { ...state.rows, [tableId]: nextRows },
        rowsVersion: state.rowsVersion + 1
      };
    }),
  flashCellSuccess: (rowId, columnId) => {
    const key = `${rowId}-${columnId}`;
    set((state) => {
      const next = new Set(state.successCells);
      next.add(key);
      return { successCells: next };
    });
    // Remove flash after 500ms
    setTimeout(() => {
      set((state) => {
        const next = new Set(state.successCells);
        next.delete(key);
        return { successCells: next };
      });
    }, 500);
  },
  addPendingClick: (rowId, columnId, direction, cursorX, cursorY) => {
    const key = `${rowId}-${columnId}`;
    set((state) => {
      const current = state.pendingClicks[key] ?? 0;
      return { 
        pendingClicks: { ...state.pendingClicks, [key]: current + direction },
        clickBadgePosition: { x: cursorX, y: cursorY }
      };
    });
  },
  clearPendingClicks: (rowId, columnId) => {
    const key = `${rowId}-${columnId}`;
    set((state) => {
      const { [key]: _, ...rest } = state.pendingClicks;
      return { pendingClicks: rest, clickBadgePosition: null };
    });
  },
  setColumnVisibility: (tableId, columnId, isVisible) =>
    set((state) => {
      const tableColumns = state.columns[tableId] ?? [];
      const updated = tableColumns.map((column) =>
        column.id === columnId ? { ...column, isVisible } : column
      );
      return { columns: { ...state.columns, [tableId]: updated } };
    }),
  setColumnWidth: (tableId, columnId, width) =>
    set((state) => {
      const tableColumns = state.columns[tableId] ?? [];
      const updated = tableColumns.map((column) =>
        column.id === columnId ? { ...column, width } : column
      );
      return { columns: { ...state.columns, [tableId]: updated } };
    }),
  setLoading: (loading) => set({ loading }),
  setLoadingMore: (loadingMore) => set({ loadingMore }),
  setError: (error) => set({ error }),
  setPersonalSummary: (summary) => set({ personalSummary: summary }),
  setRowsLimit: (limit) => set({ rowsLimit: limit, currentPage: 1, minLoadedPage: 1 }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setMinLoadedPage: (page) => set({ minLoadedPage: page }),
  setPagination: (tableId, totalPages, totalRows) =>
    set((state) => ({
      totalPages: { ...state.totalPages, [tableId]: totalPages },
      totalRows: { ...state.totalRows, [tableId]: totalRows }
    })),
  setSorting: (sortColumn, sortDirection) =>
    set({ sortColumn, sortDirection, currentPage: 1, minLoadedPage: 1 }),
  setExportModalOpen: (open) => set({ exportModalOpen: open }),
  setImportModalOpen: (open) => set({ importModalOpen: open }),
  setCreateFromCsvModalOpen: (open) => set({ createFromCsvModalOpen: open }),
  openVerificationGate: (gate) => set({ verificationGate: gate }),
  closeVerificationGate: () => set({ verificationGate: null })
}));
