/**
 * Widget System Types
 * @see ADR-002: Widget System Architecture
 */

import type { TicketBindingConfig } from './documents.types';

export type WidgetType = 'preset' | 'custom';

/**
 * Registry of preset keys contributed by autonomous modules (MODULE-CONTRACT
 * v1, seam #2). Core exposes it empty and never populates it; each module
 * augments it from inside its own directory (e.g. `sc-sim.preset.d.ts`) so its
 * preset key is known to the type system without core naming the module. Delete
 * the module → its augmentation leaves → `keyof ModulePresetRegistry` is `never`
 * and the union below loses its member with no dangling literal.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ModulePresetRegistry {}

export type PresetWidgetName =
  | 'table_view'
  | 'project_stats'
  | 'quick_links'
  | 'chart_widget'
  | 'kanban_board'
  | 'calendar_widget'
  | 'recent_activity'
  | 'metric_card'
  | 'number_widget'
  | 'gallery_widget'
  | 'task_list'
  | 'timeline_widget'
  | 'data_sources'
  | 'ai_agents'
  | 'agent_row'
  | 'documents'
  | 'documents_v4'
  | 'documents_legacy'
  | 'wellness'
  | 'fitness' // deprecated alias for wellness
  | 'labs'
  | 'virtual_office'
  | 'terminal'
  | 'token_usage'
  | 'autopilot_dashboard'
  | 'pes_dashboard'
  | 'sc_sim'
  | 'tickets_list'
  | 'welcome_dashboard'
  // Autonomous-module presets plug in here via declaration merging on
  // ModulePresetRegistry (MODULE-CONTRACT v1, seam #2) — never named in core.
  | keyof ModulePresetRegistry;

export interface WidgetPosition {
  x: number;
  y: number;
  w: number; // width (grid units, 1-12)
  h: number; // height (grid units)
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}

export interface WidgetFilter {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
  value: string | number | boolean | null | string[] | number[];
}

export interface WidgetActions {
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  export?: boolean;
}

export interface WidgetExternalAPI {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface WidgetConfig {
  procurement?: { supplier_table_id: number };
  // Display options
  show_filters?: boolean; // Show/hide filter bar in dashboard widget
  
  // Data binding
  workspace_id?: string | number;
  emojiColumn?: string;
  table_id?: number | null;
  filters?: WidgetFilter[];
  visible_columns?: string[];
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  limit?: number;

  // Actions
  actions?: WidgetActions;

  // External API
  external_api?: WidgetExternalAPI;

  // Numeric summary configuration.
  aggregation?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  column?: string;
  filter?: { column?: string; value?: unknown; values?: unknown[] };
  prefix?: string;
  suffix?: string;
  compareWith?: string;

  // Chart specific
  chart_type?: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  x_column?: string;
  y_column?: string;
  group_by?: string;

  // Kanban specific
  category_options?: Array<{ value: string; label: string; color?: string; order?: number }>;
  group_by_column?: string;
  card_title_column?: string;
  card_subtitle_column?: string;
  
  // Column mappings persisted by the settings editor and read by preset views.
  card_columns?: string[];
  statusColumn?: string;
  titleColumn?: string;
  descriptionColumn?: string;
  status_column?: string;
  completed_column?: string;
  scheduled_date_column?: string;
  due_date_column?: string;
  color_column?: string;
  ticket_binding?: TicketBindingConfig;

  // Kanban extended config (NEW)
  kanban?: KanbanConfig;
  
  // Task List extended config
  tasklist?: TaskListConfig;
  
  // Calendar extended config (NEW)
  calendar?: CalendarConfig;
  
  // Timeline extended config (NEW)
  timeline?: TimelineConfig;

  // Custom fields
  [key: string]: unknown;
}

/**
 * Kanban Widget Configuration
 * For creating kanban boards from table data
 */
export interface KanbanConfig {
  emojiColumn?: string;
  tableId: string;
  statusColumn: string;        // Column for lanes (status)
  titleColumn: string;         // Column for card title
  descriptionColumn?: string;  // Column for card description
  colorColumn?: string;        // Column for card color
  assigneeColumn?: string;     // Column for assignee
  scheduledDateColumn?: string; // Column for scheduled/start date
  dueDateColumn?: string;      // Column for due date
  lanes: KanbanLane[];         // Lane configuration
}

export interface KanbanLane {
  id: string;
  title: string;
  color: string;
  statusValue: string;         // Value from statusColumn for this lane
  limit?: number;              // WIP limit
}

/**
 * Task List Widget Configuration
 * For creating checklist-style task lists
 */
export interface TaskListConfig {
  tableId: string;
  completedColumn: string;     // Column that stores completion status (boolean or select)
  titleColumn: string;         // Column for task title
  descriptionColumn?: string;  // Column for task description
  colorColumn?: string;        // Column for task color
  scheduledDateColumn?: string; // Column for scheduled/start date
  dueDateColumn?: string;      // Column for due date
  cardColumns?: string[];      // Additional columns to show on card
  visibleColumns?: string[];   // Which columns to display when expanded
  showProgress?: boolean;      // Show progress bar
  defaultFilter?: 'all' | 'active' | 'completed'; // Default filter mode
}

/**
 * Calendar Widget Configuration
 * For displaying events on a calendar
 */
export interface CalendarConfig {
  tableId: string;
  dateColumn: string;          // Start date column
  endDateColumn?: string;      // End date column (for multi-day events)
  titleColumn: string;         // Event title column
  descriptionColumn?: string;  // Event description (shown on hover)
  colorColumn?: string;        // Event color
  allDayColumn?: string;       // All-day flag column
}

/**
 * Timeline Widget Configuration
 * For Gantt-style timeline views
 */
export interface TimelineConfig {
  tableId: string;
  startDateColumn: string;     // Start date column
  endDateColumn: string;       // End date column
  titleColumn: string;         // Item title
  descriptionColumn?: string;  // Item description (shown on card with ellipsis)
  groupByColumn?: string;      // Row grouping column (swimlanes/flows)
  colorColumn?: string;        // Item color
  progressColumn?: string;     // Progress percentage (0-100)
  dependsOnColumn?: string;    // Dependencies (comma-separated IDs)
  calendarProjectId?: string;
  calendarTableId?: string;
  calendarDateColumn?: string;
  calendarTypeColumn?: string;
  calendarTagsColumn?: string;
  calendarNoteColumn?: string;
  calendarBgColorColumn?: string;
  calendarFontColorColumn?: string;
}

export type ModuleAccessLevel = 'admin' | 'member' | 'viewer';

export interface Widget {
  id: number;
  dashboard_id: number;
  // Derived join fields from getWidgetById (dashboards.project_id / projects.space_id).
  // Present when a widget is fetched by id; null for dashboard-less widgets.
  project_id?: number | null;
  space_id?: number | null;
  source_widget_id: number | null;
  widget_type: WidgetType;
  preset_name: PresetWidgetName | null;
  code: string | null;
  code_version: number;
  title: string;
  description: string | null;
  icon: string;
  config: WidgetConfig;
  position: WidgetPosition;
  is_visible: boolean;
  is_module: boolean; // ADR-065: derived from LEFT JOIN modules
  is_public?: boolean;
  order_index: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  // ADR-065: Module metadata from LEFT JOIN modules table
  module_id: number | null;
  sidebar_order: number | null;
  sidebar_icon: string | null;
  access_level: ModuleAccessLevel | null;
  is_pinned: boolean | null;
}

export interface WidgetPreset {
  id: PresetWidgetName;
  name: string;
  description: string;
  icon: string;
  category: 'data' | 'analytics' | 'navigation' | 'visualization' | 'workflow' | 'planning' | 'monitoring' | 'productivity';
  default_config: WidgetConfig;
  component: string;
}

// API Request/Response Types

export interface CreateWidgetRequest {
  dashboard_id: number;
  widget_type: WidgetType;
  preset_name?: PresetWidgetName;
  code?: string;
  title: string;
  description?: string;
  icon?: string;
  config: WidgetConfig;
  position: WidgetPosition;
  is_module?: boolean; // ADR-045: true for sidebar modules
}

/**
 * ADR-0003 widget-embed Phase 1: create a widget with an explicit polymorphic
 * owner (document row, atom row, or dashboard). Sent to POST /api/v3/widgets.
 */
export type WidgetOwnerKind = 'dashboard' | 'document' | 'atom';

export interface CreateWidgetByOwnerRequest {
  owner_kind: WidgetOwnerKind;
  owner_id: number;
  widget_type: WidgetType;
  preset_name?: PresetWidgetName;
  code?: string;
  title: string;
  description?: string;
  icon?: string;
  config: WidgetConfig;
  position: WidgetPosition;
  is_module?: boolean;
}

export interface UpdateWidgetRequest {
  title?: string;
  description?: string;
  icon?: string;
  config?: WidgetConfig;
  position?: WidgetPosition;
  is_visible?: boolean;
  order_index?: number;
  is_public?: boolean;
}

export interface UpdateWidgetCodeRequest {
  code: string;
}

export interface WidgetDataResponse<T = unknown> {
  success: boolean;
  data: T[];
}

export interface WidgetResponse {
  success: boolean;
  data: Widget;
}

export interface WidgetsListResponse {
  success: boolean;
  data: Widget[];
}

export interface WidgetPresetsResponse {
  success: boolean;
  data: WidgetPreset[]; // Backend returns array, not object
}

// Generic type for widget data rows
export type WidgetDataRow = Record<string, unknown> & {
  id?: string | number;
  data?: Record<string, unknown>;
};

// Component Props Types

export interface WidgetContainerProps {
  widget: Widget;
  data?: WidgetDataRow[];
  isEditable?: boolean;
  onEdit?: (widget: Widget) => void;
  onDelete?: (widgetId: number) => void;
  onResize?: (widgetId: number, position: WidgetPosition) => void;
}

export interface WidgetRendererProps {
  widget: Widget;
  data?: WidgetDataRow[];
}

export interface PresetWidgetProps {
  widget: Widget;
  data: WidgetDataRow[];
}

// Store Types

export interface WidgetsStoreState {
  widgets: Widget[];
  selectedWidgetId: number | null;
  isLoading: boolean;
  error: string | null;
}

export interface WidgetsStoreActions {
  setWidgets: (widgets: Widget[]) => void;
  addWidget: (widget: Widget) => void;
  updateWidget: (widgetId: number, updates: Partial<Widget>) => void;
  removeWidget: (widgetId: number) => void;
  selectWidget: (widgetId: number | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export type WidgetsStore = WidgetsStoreState & WidgetsStoreActions;
