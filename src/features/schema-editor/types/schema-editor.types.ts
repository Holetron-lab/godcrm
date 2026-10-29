import type { Node, Edge } from '@xyflow/react';
import type { ColumnConfig } from '@/features/tables/types/table.types';

// ============ LAYOUT TYPES ============

// Layout strategy types
export type LayoutType = 
  | 'grid-5'           // Horizontal grid: 5 columns
  | 'grid-7v'          // Vertical grid: 7 rows
  | 'smart-hierarchy'  // Smart: widgets above, tables, forms below
  | 'by-relations'     // Group by relations (connected left, isolated right)
  | 'by-project'       // Group by project

// ============ EDGE STYLES ============

// Edge SHAPE (path/curve type - direction of bend)
export type EdgeShapeType = 
  | 'rounded'        // Smooth step with rounded corners (default)
  | 'bezier'         // Smooth bezier curves
  | 'straight'       // Direct straight lines
  | 'angular'        // Sharp 90° angles (PCB style)

// Line STYLE (visual appearance)
export type LineStyleType = 
  | 'solid'          // Сплошная линия (со стрелкой)
  | 'dashed'         // Пунктир (со стрелкой)
  | 'thin'           // Тонкая линия (со стрелкой)
  | 'animated'       // Анимированная (без стрелки)
  | 'gradient'       // Градиент (со стрелкой)
  | 'pulse'          // Пульсация (без стрелки)

// Legacy alias for backwards compatibility
export type EdgeStyleType = EdgeShapeType

// Endpoint marker types
export type EndpointMarkerType = 
  | 'dot'            // Circle/dot (default)
  | 'square'         // Square marker
  | 'diamond'        // Diamond/rhombus
  | 'none'           // No marker
  | 'arrow'          // Arrow pointing outward
  | 'arrowReverse'   // Arrow pointing inward

// Arrow/path style types  
export type PathStyleType =
  | 'smoothstep'     // Smooth step with rounded corners (default for flow)
  | 'bezier'         // Bezier curve
  | 'straight'       // Direct straight line
  | 'step'           // Sharp 90° angles

// Edge style configuration
export interface EdgeStyleConfig {
  // Path
  pathStyle: PathStyleType;
  
  // Endpoints
  sourceMarker: EndpointMarkerType;
  targetMarker: EndpointMarkerType;
  
  // Animation
  animated: boolean;
  animationSpeed: 'slow' | 'normal' | 'fast';
  
  // Visuals
  showGlow: boolean;
  strokeWidth: number;
}

// ============ TABLE NODE ============

export interface TableNodeData {
  tableId: number;
  name: string;
  displayName: string;
  key: string;           // slug/key таблицы
  icon: string;          // Emoji
  color?: string;        // Table color for header
  description?: string;
  projectId: number;
  spaceId?: number;      // Space ID for access control
  projectName?: string;  // Display name of the project
  projectIcon?: string;  // Emoji icon of the project
  isExternal: boolean;   // true = из другого Space
  isSystem?: boolean;    // true = системная таблица
  syncTarget?: string;   // Цель синхронизации (например "universal_tables")
  sourceSpaceId?: number;
  sourceSpaceName?: string;
  columns: ColumnData[];
  rowsPreview?: Record<string, any>[];  // First 10 rows for preview
  rowsLoading?: boolean;  // Loading state for rows
  rowCount?: number;      // Total rows; undefined when unknown (external data-source tables)
  isPinned?: boolean;     // Position locked: not draggable, skipped by auto-layout
  widgets?: TableWidgetSummary[]; // Modules built on this table, drawn as strips glued above the card
  [key: string]: unknown; // Index signature for React Flow compatibility
}

// A module attached to its main table (rendered inside the TableNode, not as a canvas node).
export interface TableWidgetSummary {
  widgetId: number;
  name: string;
  icon: string;
  widgetConfig?: unknown; // Raw widget config used to distinguish specialized preset renderers
  presetName?: string;
}

export interface ColumnData {
  id: string;
  name: string;
  displayName: string;
  type: string;          // 'text', 'number', 'relation', etc.
  icon?: string;         // Column emoji icon
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isRequired: boolean;
  orderIndex?: number;   // Position in the universal table grid
  isVisible?: boolean;   // Hidden in the grid (still drawn here, dimmed)
  isReadonly?: boolean;
  isLocked?: boolean;    // Locked / from-source columns cannot be deleted
  isFromSource?: boolean;
  config?: ColumnConfig & {
    relatedTableId?: number;
    relatedColumn?: string;
    relatedTableName?: string;
  };
}

// React Flow custom node
export type TableNode = Node<TableNodeData, 'tableNode'>;

// ============ WIDGET NODE ============

export interface WidgetNodeData {
  widgetId: number;
  name: string;
  displayName: string;
  icon: string;           // Emoji icon
  widgetType: string;     // 'preset' | 'custom'
  widgetConfig?: unknown; // Raw widget config used to distinguish specialized preset renderers
  presetName?: string;    // widgets.preset_name (table_view, kanban_board, documents, …)
  mainTableId?: number;   // Primary table this widget is based on
  projectId: number;
  projectName?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export type WidgetNode = Node<WidgetNodeData, 'widgetNode'>;

export type SchemaNode = TableNode | WidgetNode;

// ============ CONNECTION (EDGE) ============

export interface ConnectionData {
  sourceColumn: string | null;
  targetColumn: string | null;
  relationType: 'one-to-one' | 'one-to-many' | 'many-to-many' | 'backlink' | 'form' | 'widget';
  isReversed: boolean;   // true = стрелка инвертирована
  [key: string]: unknown; // Index signature for React Flow compatibility
}

export type SchemaConnection = Edge<ConnectionData>;

// ============ PENDING CONNECTION ============

export interface PendingConnection {
  id: string;
  sourceTableId: number;
  sourceTableName: string;
  sourceColumn: string;
  targetTableId: number;
  targetTableName: string;
  targetColumn: string;
  createdAt: Date;
}

// ============ EDITOR STATE ============

export interface SchemaEditorState {
  spaceId: number | null;
  nodes: SchemaNode[];
  edges: SchemaConnection[];
  
  // Pending connections (not yet applied to DB)
  pendingConnections: PendingConnection[];
  
  // Selection
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  selectedColumnKey: string | null; // For connection mode: "tableId:columnName"
  
  // Viewport
  zoom: number;
  
  // Mode
  isConnecting: boolean;
  connectionStart: {
    nodeId: string;
    columnName: string;
    handleType: 'source' | 'target';
  } | null;
  
  // UI
  showAIChat: boolean;
  showTablesList: boolean;
  edgeShape: EdgeShapeType; // Current edge shape (path type)
  lineStyle: LineStyleType; // Current line style (solid, dashed, etc)
  edgeStyle: EdgeStyleType; // Legacy alias for edgeShape
  edgeStyleConfig: EdgeStyleConfig; // Detailed configuration for edge style
  
  // Navigation tree visibility states
  // 4 states: 'visible' | 'hidden' | 'partial' | 'inherit'
  // - visible: show full table card
  // - hidden: don't show table card
  // - partial: show only if has connections to visible tables (header + connected rows + footer)
  // - inherit: inherit from parent (project/folder)
  tableVisibility: Record<number, TableVisibilityState>;
  projectVisibility: Record<number, TableVisibilityState>;
  folderVisibility: Record<string, TableVisibilityState>;  // Uses full node.id for virtual folders
  
  // Navigation tree expanded state
  expandedProjects: Set<number>;
  expandedFolders: Set<string>;  // Uses full node.id for virtual folders like "virtual:internal:123"
  
  // Project colors for boundaries
  projectColors: Record<number, string>;
  
  // Project boundaries display
  showProjectBoundaries: boolean;
  showProjectConnectionLines: boolean;
  // Modules on the canvas (strips above their tables + standalone module cards)
  showWidgets: boolean;
  
  // Table selection for bulk operations
  selectedTables: Set<number>;
}

export type TableVisibilityState = 'visible' | 'hidden' | 'partial' | 'inherit';

// Navigation tree node for left panel
export interface NavTreeNode {
  id: string;           // Format: "type:id" e.g., "table:123", "widget:123"
  type: 'project' | 'folder' | 'table' | 'external-section' | 'widget';
  numericId: number;
  name: string;
  displayName?: string;
  icon: string;
  children: NavTreeNode[];
  parentId: string | null;
  tableCount?: number;  // For projects/folders
  hasEdge?: boolean;    // Table has existing relations (green)
  hasPending?: boolean; // Table has pending connections (blue)
  isExternal?: boolean; // Table from another space
  sourceSpaceName?: string; // Name of the source space for external tables
  color?: string;       // Custom color for table row highlight
  widgetType?: string;  // For widget nodes ('preset' | 'custom')
  widgetConfig?: unknown; // Raw widget config used to distinguish specialized preset renderers
  presetName?: string;  // For widget nodes: widgets.preset_name (table_view, kanban_board, documents, …)
  mainTableId?: number; // For widgets - connected table ID
}

// ============ API TYPES ============

export interface SchemaTableResponse {
  id: number;
  name: string;
  display_name: string;
  icon?: string;
  description?: string;
  project_id: number;
  color?: string;
  is_system?: boolean | number;
  sync_target?: string;
  project_name?: string;
  project_icon?: string;
  row_count?: number | string | null; // pg COUNT() arrives as a string; null for data-source tables
  columns: Array<{
    id: number;
    name: string;
    display_name: string;
    type: string;
    is_required: boolean;
    order_index?: number | null;
    is_visible?: boolean | number | null;
    is_readonly?: boolean | number | null;
    is_locked?: boolean | number | null;
    is_from_source?: boolean | number | null;
    config?: Record<string, unknown>;
  }>;
}

// One saved node position; `locked` pins the table so drag and auto-layout leave it in place.
export interface LayoutNodeEntry {
  tableId: number;
  x: number;
  y: number;
  locked?: boolean;
}

export interface SchemaResponse {
  tables: SchemaTableResponse[];
  layout?: LayoutNodeEntry[];
}

export interface SaveLayoutRequest {
  nodes: LayoutNodeEntry[];
}

export interface CreateTableRequest {
  name: string;
  displayName: string;
  projectId: number;
  icon?: string;
  description?: string;
  columns?: Array<{ name: string; type: string; config?: Record<string, unknown> }>;
  position?: { x: number; y: number };
}

export interface CreateRelationRequest {
  sourceTableId: number;
  sourceColumn: string;
  targetTableId: number;
  targetColumn: string;
}

export interface AccessibleTablesResponse {
  spaceId: number;
  spaceName: string;
  tables: Array<{ id: number; name: string; displayName: string }>;
}
