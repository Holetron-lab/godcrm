import { ColumnType } from '@/shared/types';
import type { ColorColumnConfig } from '../utils/color-utils';

// Re-export color types for convenience
export type { ColorColumnConfig, ColorValue, ColorValueObject, CMYK, ColorListItem, ColorMode, RowColorMode } from '../utils/color-utils';

export type ViewType = 'table' | 'board' | 'calendar' | 'gallery' | 'list';

// ============================================================
// ADR-026: Column Variables & Calculation Streams
// ============================================================

/**
 * Scope type for variables
 * - 'space': Available across entire space
 * - 'table': Scoped to specific table
 * - 'dashboard': Scoped to specific dashboard
 */
export type VariableScopeType = 'space' | 'table' | 'dashboard';

/**
 * Variable definition for calculated values
 * Stored in the Variables Universal Table in System Data
 */
export interface ColumnVariable {
  id: string;
  name: string;               // $total_revenue (with $ prefix)
  formula: string;            // SUM({{revenue}}) or $other_var * 2
  description?: string;
  scopeType: VariableScopeType;
  scopeRef?: number | null;   // Table or Dashboard ID if scope != 'space'

  // Automatically computed:
  dependencies: string[];     // ['$other_var', 'revenue']
  streamId: number;           // Calculation stream number

  // Cached values:
  cachedValue?: string | null;
  cachedAt?: string | null;

  createdAt?: string;
  updatedAt?: string;
}

/**
 * Calculation stream - group of variables with no mutual dependencies
 * Variables within same stream can be calculated in parallel
 */
export interface CalculationStream {
  id: number;
  name?: string;
  variableIds: string[];
}

/**
 * Variables API response format
 */
export interface SpaceVariablesResponse {
  tableId: number | null;
  variables: {
    id: number;
    name: string;
    value: string | null;
    scope: VariableScopeType;
    scopeRef: number | null;
    formula: string;
    description?: string;
    streamId: number;
  }[];
}

/**
 * Variables recalculation response
 */
export interface VariablesRecalculateResponse {
  calculated: number;
  cached: number;
  errors: Array<{ rowId: number; error: string }>;
}

// ============================================================
// End ADR-026 Types
// ============================================================

export interface TableView {
  id: string;
  name: string;
  type: ViewType;
  filters: Filter[];
  sorts: Sort[];
  groupBy?: string;
  visibleColumns: string[];
}

export interface Filter {
  column: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'greater_than' | 'less_than';
  value: unknown;
  condition: 'and' | 'or';
}

export interface Sort {
  column: string;
  direction: 'asc' | 'desc';
}

export type TableHierarchyMode = 'flat' | 'nested' | 'linked';

export interface TableHierarchyConfig {
  mode: TableHierarchyMode;
  parentField?: string;
  childField?: string;
  relationTableId?: string;
  depthLimit?: number;
}

// Multi-source table types
export type TableType = 'own' | 'external' | 'hybrid';

export interface TableConfig {
  defaultView: string;
  views: TableView[];
  permissions: Record<string, 'read' | 'write' | 'admin'>;
  hierarchy?: TableHierarchyConfig;
  projectId?: number | null;
  scope?: 'system' | 'project' | 'custom';
  privacy?: 'personal' | 'shared' | 'owner_admin';
  copyable?: boolean;
  // Row height settings
  min_row_height?: number;
  max_row_height?: number;
  fixed_row_height?: number | null;
}

export interface TableModel {
  id: string;
  userId?: string;
  name: string;
  displayName: string;
  description?: string;
  type: 'system' | 'custom';
  icon?: string;
  color?: string;
  isVisible: boolean;
  config?: TableConfig;
  projectId?: number | null;

  // Multi-source fields
  table_type?: TableType;
  data_source_id?: string | null;
  source_table_name?: string | null;
  source_id_column?: string | null;

  // System table fields
  is_system?: boolean;
  sync_target?: string | null;

  // Sync settings
  sync_enabled?: boolean;
  sync_interval_minutes?: number;
  last_sync_at?: string | null;

  // Stats
  row_count?: number;
  is_locked?: boolean;

  // Grouping
  parent_table_id?: number | null;

  createdAt: string;
  updatedAt: string;
}

export interface ColumnModel {
  id: string;
  tableId: string;
  name: string;
  displayName: string;
  type: ColumnType;
  config: ColumnConfig;
  formula?: string;
  mapping?: DatabaseMapping;
  isRequired: boolean;
  isReadonly: boolean;
  defaultValue?: unknown;
  orderIndex: number;
  width: number;
  isVisible: boolean;
  icon?: string;                    // Column emoji icon

  // Multi-source fields
  is_from_source?: boolean;      // TRUE = from external DB
  is_locked?: boolean;            // TRUE = cannot change type/delete
  is_primary_key?: boolean;       // TRUE = this is the external ID column

  createdAt?: string;
  updatedAt?: string;
}

export type ColumnIndicatorType = 'emoji' | 'badge' | 'dot';

export interface ColumnOption {
  label: string;
  value: string;
  color?: string;
  children?: ColumnOption[];  // Nested options for cascading select
}

export interface ColumnAutomationConfig {
  webhook?: {
    enabled?: boolean;
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
    secretHeader?: string;
    payloadTemplate?: string;
  };
}

export interface ColumnSecurityConfig {
  encrypted?: boolean;
}

// Text wrap mode for cells
export type TextWrapMode = 'nowrap' | 'wrap' | 'wrap-ellipsis';

export interface ColumnAppearance {
  align?: 'left' | 'center' | 'right';
  color?: string;
  background?: string;
  icon?: string;
  showHeader?: boolean;           // Show/hide column header text
  columnColor?: string;           // Background color for column cells
  textColor?: string;             // Text color for column cells
  fontFamily?: string;            // Font family for column cells
  fontSize?: string;              // Font size for column cells
  fontWeight?: string;            // Font weight (bold, normal, etc.)
  fontStyle?: string;             // Font style (italic, normal, etc.)
  textDecoration?: string;        // Text decoration (underline, line-through, etc.)
  indicator?: {
    type: ColumnIndicatorType;
    value?: string;
    color?: string;
  };
}

// Relation display type
export type RelationType = 'lookup' | 'link' | 'nested';

// Storage format for multiple values
export type RelationStorageFormat = 'json' | 'comma' | 'semicolon' | 'newline' | 'single';

// Display mode for relation values
export type RelationDisplayMode = 'badges' | 'cards' | 'list' | 'count' | 'first' | 'raw';

// Relation config for columns that reference another table
export interface ColumnRelationConfig {
  enabled?: boolean;
  type?: RelationType;     // Type of relation display (default: 'lookup')
  tableId?: string;        // Source table ID
  valueColumn?: string;    // Column to use as value (usually ID)
  labelColumn?: string;    // Column to display as label
  colorColumn?: string;    // Optional column for color
  descriptionColumn?: string; // Optional column for description (used in cards mode)
  displayColumn?: string;  // Legacy alias for labelColumn

  // Multiple values support
  multiple?: boolean;                  // Allow multiple values
  storageFormat?: RelationStorageFormat; // How to store multiple values (default: 'json')
  displayMode?: RelationDisplayMode;   // How to display values (default: 'badges')

  // Reverse/backlink mode - find records that reference this row
  lookupMode?: 'normal' | 'reverse';  // 'reverse' finds records where valueColumn contains current row's ID
  reverseLink?: boolean;              // Indicates this is a reverse link column

  // Link-specific config
  linkUrl?: string;        // URL template with {value} placeholder, e.g., "/tables/{tableId}/row/{value}"
  openInNewTab?: boolean;  // Open link in new tab

  // Nested table-specific config
  nested?: {
    buttonLabel?: string;           // Button text, e.g., "Show items"
    buttonIcon?: string;            // Icon for button
    filterColumn: string;           // Column in nested table to filter by
    displayColumns?: string[];      // Columns to show in nested table
    modalTitle?: string;            // Modal title template with {label} placeholder
    allowAdd?: boolean;             // Allow adding new records
    allowEdit?: boolean;            // Allow editing records
  };
}

// Button config for button columns
export interface ButtonColumnConfig {
  label?: string;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  action?: {
    type: 'automation' | 'url' | 'copy' | 'custom';
    automationId?: string;
    url?: string;
    copyField?: string;
    customHandler?: string;
  };
}

// Checkbox config for boolean columns
export interface CheckboxColumnConfig {
  trueValue?: string | number | boolean;
  falseValue?: string | number | boolean;
  style?: 'checkbox' | 'toggle' | 'emoji';
  trueEmoji?: string;             // Custom emoji for true state
  falseEmoji?: string;            // Custom emoji for false state
}

/**
 * ADR-026: Linked Variable reference for summary aggregations
 */
export interface LinkedVariableRef {
  variableId: number;
  variableName: string;
}

/**
 * ADR-026: Map of aggregation type to linked variable
 * When a summary is exported to a Variable, the link is stored here
 */
export interface LinkedVariablesMap {
  sum?: LinkedVariableRef | null;
  avg?: LinkedVariableRef | null;
  min?: LinkedVariableRef | null;
  max?: LinkedVariableRef | null;
  count?: LinkedVariableRef | null;
  countUnique?: LinkedVariableRef | null;
  countEmpty?: LinkedVariableRef | null;
  countFilled?: LinkedVariableRef | null;
  checked?: LinkedVariableRef | null;
  unchecked?: LinkedVariableRef | null;
  percentChecked?: LinkedVariableRef | null;
  earliest?: LinkedVariableRef | null;
  latest?: LinkedVariableRef | null;
  dateRange?: LinkedVariableRef | null;
  percentFilled?: LinkedVariableRef | null;
}

/**
 * Column summary configuration
 * Controls which aggregations are shown in TableSummaryBar
 * and their optional links to Variables
 */
export interface ColumnSummaryConfig {
  // Visibility flags
  sum?: boolean;           // Show sum (default: true for numbers)
  avg?: boolean;           // Show average (default: true for numbers)
  count?: boolean;         // Show count
  min?: boolean;           // Show minimum
  max?: boolean;           // Show maximum
  empty?: boolean;         // Show empty count (default: true)
  countUnique?: boolean;   // Show unique count
  countEmpty?: boolean;    // Show empty count
  countFilled?: boolean;   // Show filled count

  // Checkbox-specific
  checked?: boolean;       // Show checked count
  unchecked?: boolean;     // Show unchecked count
  percentChecked?: boolean;// Show checked percentage

  // Date-specific
  earliest?: boolean;      // Show earliest date
  latest?: boolean;        // Show latest date
  dateRange?: boolean;     // Show date range

  // Text/Select specific
  percentFilled?: boolean; // Show fill percentage

  // ADR-026: Links to Variables (opt-in export)
  linkedVariables?: LinkedVariablesMap;
}

// Text column config - formula, prefix, suffix with variable support {{column_key}}
export interface TextColumnConfig {
  formula?: string;           // Formula with variables like "{{name}} - {{code}}"
  prefix?: string;            // Prefix with variable support like "ID: " or "{{currency}}"
  suffix?: string;            // Suffix with variable support like " pcs" or " {{unit}}"
}

// Number column config - style, format, prefix/suffix
export interface NumberColumnConfig {
  style?: 'input' | 'stepper';      // Editor style
  stepperLayout?: 'horizontal' | 'vertical' | 'left' | 'right';  // Stepper buttons layout
  step?: number;                     // Step for stepper
  min?: number;                      // Minimum value
  max?: number;                      // Maximum value
  displayStyle?: 'default' | 'badge' | 'progress' | 'progress-vertical' | 'progress-ring' | 'currency' | 'percent' | 'compact' | 'rating' | 'slider';
  prefix?: string;                   // Prefix like "$" or "EUR"
  suffix?: string;                   // Suffix like "%" or " pcs"
  decimals?: number;                 // Number of decimal places
  thousandsSeparator?: boolean;      // Use thousands separator (1,000,000)
  progressMax?: number;              // Max value for progress bar
  progressColor?: string;            // Color for progress bar
  badgeColor?: string;               // Color for badge style
  ratingMax?: number;                // Max stars for rating (default 5)
  showStepButtons?: boolean;         // Show +/- step buttons on hover
  showProgress?: boolean;            // Show inline progress bar
  maxStars?: number;                 // Alias for ratingMax
  stepButtonColorType?: 'fixed' | 'column';
  stepButtonColor?: string;
  stepButtonColorColumn?: string;
  minType?: 'fixed' | 'column';
  minColumn?: string;
  maxType?: 'fixed' | 'column';
  maxColumn?: string;
  prefixType?: 'fixed' | 'column';
  prefixColumn?: string;
  suffixType?: 'fixed' | 'column';
  suffixColumn?: string;
}

export interface UrlColumnConfig {
  style?: 'default' | 'button' | 'minimal' | 'badge';  // Display style
  buttonColor?: string;              // Color for button/badge style
  multipleLinks?: boolean;           // Support multiple URLs separated by commas
  valueTemplate?: string;            // Template for URL value (e.g., "{{id}}")
  prefix?: string;                   // Prefix for URL (e.g., "https://example.com/")
  suffix?: string;                   // Suffix for URL (e.g., "?view=full")
  linkText?: string;                 // Custom link text (e.g., "Open #{{id}}")
  displayText?: string;              // Display text override
}

export interface FileColumnConfig {
  prefix?: string;                   // Prefix added before URL/filename
  suffix?: string;                   // Suffix added after URL/filename
  saveFormat?: 'url' | 'filename' | 'path';  // How to store file reference
  formula?: string;                  // Formula template for computing file path
  displayStyle?: 'icon-name' | 'icon-only' | 'name-only';  // Display style
}

export interface VectorColumnConfig {
  formula?: string;                  // Template for generating vector text from other columns
  prefix?: string;                   // Prefix added before vector text
  suffix?: string;                   // Suffix added after vector text
  agent_id?: number;                 // Agent ID for embeddings
}

export interface DateColumnConfig {
  mode?: 'date' | 'datetime' | 'month' | 'year' | 'week' | 'quarter';  // ADR-070: date mode
  /** @deprecated Use storageFormat instead */
  dateFormat?: 'iso' | 'eu' | 'us' | 'unix';  // Legacy storage format
  displayFormat?: string;           // Display format (varies by mode)
  storageFormat?: 'iso' | 'eu' | 'us' | 'unix' | 'unix_ms';  // Storage encoding
  storageTimezone?: 'utc' | 'server' | 'browser';  // TZ for ISO storage
  displayTimezoneType?: 'local' | 'server' | 'fixed';  // Display timezone mode
  timezoneOffset?: string;          // Fixed UTC offset (e.g. '+3')
  showSeconds?: boolean;            // Show seconds for datetime
}

// Back link configuration for reverse relations
export interface BackLinkConfig {
  enabled: boolean;
  sourceTableId: string;
  sourceColumnId: string;  // Column in source table that references this table
  displayColumn: string;   // Which column to display in this table
  displayMode: 'count' | 'badges' | 'list';
}

// Single back link configuration (target table sync)
export interface BackLinkSingleConfig {
  enabled: boolean;
  targetTableId: string;
  targetColumnId: string;  // Column in target table to write to
  displayColumn: string;   // Which column to display
  displayMode: 'count' | 'badges' | 'list';
}

// Cell format configuration
export interface CellFormatConfig {
  mode?: 'text' | 'markdown' | 'html' | 'formula';
  formula?: string;
  textWrap?: TextWrapMode;  // Text wrap mode
}

// JSON column configuration (ADR-0017)
export interface JsonColumnConfig {
  template?: string;                              // Optional default JSON skeleton (raw string, validated)
  defaultMode?: 'code' | 'tree' | 'form';         // Default editor mode in cell modal (Phase 3)
  prettyInCell?: boolean;                         // Pretty-print summary in cell preview
  previewLines?: number;                          // 1-10, lines shown in cell preview
}

// Table (embedded table) column configuration
export interface TableColumnConfig {
  displayMode?: 'modal' | 'inline' | 'embedded';  // How to display the table
  buttonLabel?: string;                            // Custom button text with variable support {{column}}
  buttonStyle?: 'default' | 'outline' | 'ghost' | 'link';  // Button style
  icon?: 'table' | 'list' | 'grid' | 'folder' | 'box' | 'eye' | 'link' | 'none';  // Button icon
  expandAction?: 'modal' | 'inline' | 'expand';   // Action when expanding in embedded mode
  maxRows?: number;                                // Max rows to show in embedded mode
  maxColumns?: number;                             // Max columns to show in embedded mode
  filterColumn?: string;                           // Column in embedded table to filter by
  filterSourceColumn?: string;                     // Column in current table to get filter value
}

// ADR-0011: Verification column — multi-method N-of-M verification gate
export type VerificationMethod = 'totp' | 'captcha' | 'sms' | 'email';

export interface VerificationColumnConfig {
  available_methods: VerificationMethod[];
  required_methods: number;                  // 1..available_methods.length
  locks_on_statuses: string[];
  unlocks_on_statuses: string[];
  cooldown_seconds: number;                  // default 300
  ttl_seconds: number | null;                // null = no expiry
  guards: string[];                          // column names to guard
  policy: 'all' | 'any_n';
  rate_limit?: {
    window_seconds: number;
    max_attempts: number;
  };
}

// ADR-0016: per-column visibility for file-type columns.
// Default fallback for missing/legacy columns is `private`.
export type ColumnFileVisibility = 'private' | 'internal' | 'public';

export interface ColumnConfig {
  format?: string;
  options?: ColumnOption[];
  relation?: ColumnRelationConfig;  // For select columns: pull options from another table
  button?: ButtonColumnConfig;       // For button columns
  checkbox?: CheckboxColumnConfig;   // For checkbox columns
  text?: TextColumnConfig;           // For text columns: formula, prefix, suffix
  number?: NumberColumnConfig;       // For number columns: style, format, prefix, suffix
  url?: UrlColumnConfig;             // For URL columns: style, prefix, suffix, link text
  file?: FileColumnConfig;           // For file columns: prefix, suffix, save format
  // ADR-0016 Phase 2: visibility scope for file-type column attachments.
  visibility?: ColumnFileVisibility;
  // ADR-0016 Phase 3: storage folder strategy for file-type column uploads.
  folder_path?: 'auto' | string;
  vector?: VectorColumnConfig;       // For vector columns: formula, prefix, suffix
  date?: DateColumnConfig;           // For date columns: format, timezone
  table?: TableColumnConfig;         // For table columns: embedded table settings
  json?: JsonColumnConfig;           // ADR-0017: For json columns: template, default mode, preview
  color?: ColorColumnConfig;          // ADR-028: For color columns: mode, presets, row coloring

  // ADR-0011 Phase F: verification-column config is CANONICAL FLAT on ColumnConfig.
  // Backend validateVerificationConfig() reads these top-level fields for
  // type='verification' columns and persists them flat. The legacy nested
  // `verification?: VerificationColumnConfig` below is kept for read-only
  // back-compat when hydrating older in-memory state; new code MUST write flat.
  available_methods?: VerificationMethod[];
  required_methods?: number;
  locks_on_statuses?: string[];
  unlocks_on_statuses?: string[];
  cooldown_seconds?: number;
  ttl_seconds?: number | null;
  guards?: string[];
  policy?: 'all' | 'any_n';
  rate_limit?: {
    window_seconds: number;
    max_attempts: number;
  };

  /** @deprecated ADR-0011 Phase F flattened this — read-only for legacy hydration */
  verification?: VerificationColumnConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validation?: any;
  appearance?: ColumnAppearance;
  automation?: ColumnAutomationConfig;
  security?: ColumnSecurityConfig;
  copyable?: boolean;
  summary?: ColumnSummaryConfig;     // Summary row configuration
  backLinks?: BackLinkConfig[];      // Back link configurations for reverse relations
  backLink?: BackLinkSingleConfig;   // Single back link to target table
  cellFormat?: CellFormatConfig;     // Cell format configuration including text wrap
  comment?: string;                  // Developer/admin comment for the column
  accessControl?: {                  // Access control settings
    enabled?: boolean;
    usersTableId?: string;
    roleColumn?: string;
    roleMapping?: Record<string, string[]>;
  };
  // Type-specific configs (generic for less common types)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  email?: any;
  phone?: any;
  password?: any;
  person?: any;
  image?: any;
  dialog?: any;
  chat?: any;
  time?: any;
  rollup?: any;
  select?: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface ValidationRule {
  type: 'required' | 'min' | 'max' | 'regex';
  value?: number | string;
  message?: string;
}

export interface DatabaseMapping {
  source?: 'local' | 'table' | 'integration' | 'variable';
  table?: string;
  field?: string;
  variableKey?: string;
  variableLabel?: string;
  integrationId?: string;
  description?: string;
}

export interface RowModel {
  id: string;
  base_id?: string;
  tableId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface PersonalSpaceSummary {
  userId: number;
  projectId: number | null;
  tableCount: number;
  rowCount: number;
}

export interface TablesListMeta {
  personalSpace?: PersonalSpaceSummary | null;
}

export interface TablesListResult {
  tables: TableModel[];
  meta?: TablesListMeta | null;
}

export interface ColumnDefinitionInput {
  name?: string;
  displayName?: string;
  type?: ColumnType;
  config?: ColumnConfig;
  formula?: string;
  mapping?: DatabaseMapping;
  isRequired?: boolean;
  isReadonly?: boolean;
  isVisible?: boolean;
  defaultValue?: unknown;
  width?: number;
}

export interface CreateTablePayload {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  color?: string;
  hierarchy?: TableHierarchyConfig;
  views?: TableView[];
  columns?: ColumnDefinitionInput[];
  type?: 'system' | 'custom';
  projectId?: number | null;
  data_source_id?: string;
  external_table_name?: string;
}
