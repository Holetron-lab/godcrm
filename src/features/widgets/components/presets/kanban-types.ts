// Kanban shared types — base module for all kanban sub-modules

/** Generic type for kanban card data */
export type KanbanCardData = Record<string, unknown>;

/** Type for field values in callbacks */
export type FieldValue = string | number | boolean | null | undefined;

/** Column info for editable fields */
export interface ColumnInfo {
  name: string;
  displayName?: string;
  type: string;
  config?: {
    options?: Array<{ value: string; label: string; color?: string }>;
    relation?: {
      enabled?: boolean;
      tableId?: string | number;
      valueColumn?: string;
      labelColumn?: string;
    };
    relatedTableId?: string | number;
  };
}

/** Status/select column option */
export interface ColumnOption {
  value: string;
  label: string;
  color?: string;
}

/** Pre-loaded relation data from all related tables */
export type RelationDataMap = Map<string, Map<string, { label: string; color?: string; order?: number }>>;

/** Filter state for integrated toolbar */
export interface KanbanFilterState {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchColumns: string[];
  onSearchColumnsChange: (cols: string[]) => void;
  selectFilters: Record<string, string[]>;
  onSelectFiltersChange: (filters: Record<string, string[]>) => void;
  dateFilters: Record<string, { from?: string; to?: string }>;
  onDateFiltersChange: (filters: Record<string, { from?: string; to?: string }>) => void;
  activeFilterColumns: string[];
  onActiveFilterColumnsChange: (cols: string[]) => void;
  tableColumns: Array<{ id: string; name: string; displayName?: string; type: string; config?: Record<string, unknown> }>;
}
