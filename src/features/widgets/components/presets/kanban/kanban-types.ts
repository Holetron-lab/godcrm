import type { PresetWidgetProps } from '../../../types/widget.types';

// Generic type for kanban card data
export type KanbanCardData = Record<string, unknown>;

// Type for field values in callbacks
export type FieldValue = string | number | boolean | null | undefined;

// Column info for editable fields
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

export interface ColumnOption {
  value: string;
  label: string;
  color?: string;
}

// Type for relation data from parent
export type RelationDataMap = Map<string, Map<string, { label: string; color?: string; order?: number }>>;

// Filter state for integrated toolbar
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

export interface KanbanWidgetProps extends PresetWidgetProps {
  columnOptions?: ColumnOption[];
  columnsInfo?: ColumnInfo[];
  relationData?: RelationDataMap;
  activeStatusFilters?: string[];
  compact?: boolean;
  onAddColumn?: () => void;
  onAddStatusRow?: () => void;
  groupRelationTableId?: number | string | null;
  onAddCard?: (columnValue: string) => void;
  onMoveCard?: (cardId: string, newStatus: string) => void;
  onCardDoubleClick?: (card: KanbanCardData, initialTab?: 'details' | 'files' | 'comments') => void;
  onCardUpdate?: (cardId: string, field: string, value: FieldValue) => void;
  onOpenRowChat?: (rowId: string) => void;
  onAttachRowToMessage?: (rowId: string) => void;
  onDeleteCard?: (cardId: string) => void;
  scheduledDateColumn?: string;
  dueDateColumn?: string;
  colorColumn?: string;
  emojiColumn?: string;
  cardColumns?: string[];
  visibleColumns?: string[];
  filterState?: KanbanFilterState;
  showToolbar?: boolean;
  onAddRow?: () => void;
  onRefresh?: () => void;
  onPrint?: () => void;
  onSettings?: () => void;
  tableId?: number | string;
}

export interface ExpandableCardProps {
  item: KanbanCardData;
  cardTitleColumn: string;
  cardSubtitleColumn?: string;
  scheduledDateColumn?: string;
  dueDateColumn?: string;
  colorColumn?: string;
  emojiColumn?: string;
  groupColumn?: string;
  cardColumns?: string[];
  visibleColumns?: string[];
  columnsInfo?: ColumnInfo[];
  relationData?: RelationDataMap;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDoubleClick: () => void;
  onOpenComments: () => void;
  onOpenChat?: () => void;
  onAttachToMessage?: () => void;
  onQuickEdit?: (field: string, value: FieldValue) => void;
  onDelete?: () => void;
  isDragging: boolean;
  dragHandleListeners?: Record<string, any>;
  dragHandleAttributes?: Record<string, any>;
  translations: {
    openFull: string;
    comments: string;
    chat: string;
    attachToMessage: string;
    description: string;
    save: string;
    cancel: string;
    noDescription: string;
    moreFields: string;
    open: string;
  };
}

export interface MiniFileUploaderProps {
  value: string;
  fieldName: string;
  displayName: string;
  onUpdate: (field: string, value: string) => void;
}

export interface KanbanDraggableCardProps {
  item: KanbanCardData;
  columnValue: string;
  isExpanded: boolean;
  activeId: string | null;
  cardTitleColumn: string;
  cardSubtitleColumn?: string;
  startDateCol?: string;
  endDateCol?: string;
  colorCol?: string;
  emojiCol?: string;
  groupByColumn: string;
  cardColumns?: string[];
  visibleColumns?: string[];
  columnsInfo: ColumnInfo[];
  relationData?: RelationDataMap;
  onToggleExpand: () => void;
  onDoubleClick: () => void;
  onOpenComments: () => void;
  onOpenChat?: () => void;
  onAttachToMessage?: () => void;
  onQuickEdit: (field: string, value: FieldValue) => void;
  onDelete?: () => void;
  translations: ExpandableCardProps['translations'];
}

export interface KanbanDroppableColumnProps {
  columnValue: string;
  columnLabel: string;
  columnItems: KanbanCardData[];
  columnColor: string;
  badgeStyles: { backgroundColor: string; color: string };
  columnStyles: { backgroundColor: string; borderColor: string };
  colIndex: number;
  activeColumnId: string | null;
  expandedCards: Set<string>;
  activeId: string | null;
  cardTitleColumn: string;
  cardSubtitleColumn?: string;
  startDateCol?: string;
  endDateCol?: string;
  colorCol?: string;
  emojiCol?: string;
  groupByColumn: string;
  cardColumns?: string[];
  visibleColumns?: string[];
  columnsInfo: ColumnInfo[];
  relationData?: RelationDataMap;
  onToggleCardExpanded: (cardId: string) => void;
  onCardDoubleClick?: (card: KanbanCardData, tab?: 'details' | 'files' | 'comments') => void;
  onOpenRowChat?: (rowId: string) => void;
  onAttachRowToMessage?: (rowId: string) => void;
  onQuickEdit: (cardId: string, field: string, value: FieldValue) => void;
  onDeleteCard?: (cardId: string) => void;
  onAddCard?: (columnValue: string) => void;
  subGroupColumn?: string | null;
  translations: ExpandableCardProps['translations'] & { noRecords: string; dropHere: string; add: string };
}

// Toolbar props — all state + setters passed from KanbanWidget
export interface KanbanToolbarProps {
  // Data
  data: KanbanCardData[];
  columnsInfo: ColumnInfo[];
  relationData?: RelationDataMap;
  widget: KanbanWidgetProps['widget'];
  tableId?: number | string;

  // Filter state from parent
  filterState?: KanbanFilterState;

  // Action callbacks from parent
  onAddRow?: () => void;
  onAddCard?: (columnValue: string) => void;
  onAddColumn?: () => void;
  onAddStatusRow?: () => void;
  groupRelationTableId?: number | string | null;
  onRefresh?: () => void;
  onPrint?: () => void;
  onSettings?: () => void;

  // Division/grouping state (controlled by parent)
  groupByColumn: string;
  defaultGroupBy: string;
  divisionColumns: ColumnInfo[];
  groupByOverride: string | null;
  setGroupByOverride: (v: string | null) => void;
  setColumnOrder: (v: string[] | null) => void;

  // Sort state (controlled by parent)
  sortColumn: string | null;
  setSortColumn: (v: string | null) => void;
  sortDirection: 'asc' | 'desc';
  setSortDirection: (v: 'asc' | 'desc' | ((d: 'asc' | 'desc') => 'asc' | 'desc')) => void;

  // Date sort state (controlled by parent)
  dateSortColumn: string | null;
  setDateSortColumn: (v: string | null) => void;
  dateSortDirection: 'asc' | 'desc';
  setDateSortDirection: (v: 'asc' | 'desc' | ((d: 'asc' | 'desc') => 'asc' | 'desc')) => void;
  dateFilterFrom: string;
  setDateFilterFrom: (v: string) => void;
  dateFilterTo: string;
  setDateFilterTo: (v: string) => void;

  // Sub-group state (controlled by parent)
  subGroupColumn: string | null;
  setSubGroupColumn: (v: string | null) => void;
}
