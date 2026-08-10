/**
 * Documents v4 - Table-based document structure
 *
 * Each document is a separate table with hierarchical content.
 * Atoms can be reused across documents via atom_ref.
 *
 * @see TASK-008-DOCUMENTS-V4-TABLES.md
 */

import type { CSSProperties } from 'react';

// === LEVEL TYPES ===

export type DocumentLevel = 'h1' | 'h2' | 'h3' | 'text' | 'atom' | 'ticket' | 'divider' | 'page_break' | 'image' | 'widget';

export type DocumentItemType = 
  | 'reference' 
  | 'endpoint' 
  | 'concept' 
  | 'howto' 
  | 'code' 
  | 'component' 
  | 'hook' 
  | 'store'
  | 'policy'
  | 'procedure'
  | 'checklist';

export type DocumentStatus = string;

/**
 * Status option from `_doc_statuses` registry (one per documents widget).
 * Loaded dynamically via the registry's `status_id` relation column.
 */
export interface StatusOption {
  id: number;
  slug: string;
  label: string;
  icon?: string;
  color?: string;  // tailwind color name: yellow, purple, blue, green, cyan, gray, amber, orange, red
  order?: number;
  description?: string;
}

export type DocumentCategory = 'API' | 'Frontend' | 'Backend' | 'DevOps' | 'Guide' | 'Other';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// === REGISTRY (Document list) ===

export interface DocumentRegistryItem {
  id: number;
  base_id?: string;
  name: string;
  description?: string;
  slug: string;
  table_id: number;
  content_table_id?: number;  // alias for table_id (used in some contexts)
  icon?: string;
  category?: DocumentCategory | string;
  project_id?: number;  // Link to ADR Projects table (1699)
  status?: DocumentStatus;
  status_id?: number;  // FK → _doc_statuses (canonical, since ADR-0003 v2)
  order_index?: number;
  created_at?: string;
  updated_at?: string;
}

// === ATOMS (Reusable content blocks) ===

export interface DocumentAtom {
  id: number;
  base_id?: string;
  key: string;
  title: string;
  content: string;
  type?: DocumentItemType;
  http_method?: HttpMethod;
  http_path?: string;
  code?: string;
  tags?: string[];
  document_ids?: number[];
  // Vector embedding placeholder for future AI search
  // vector?: number[];
  created_at?: string;
  updated_at?: string;
}

// === DOCUMENT ITEM (Row in doc_* table) ===

export interface DocumentItem {
  id: number;
  base_id?: string;
  order: number;
  level: DocumentLevel;
  content?: string;  // For headers: the heading text. For text: markdown content.
  comment?: string;
  type?: DocumentItemType;
  atom_ref?: number | null;
  task_ref?: number | null;  // ADR-038: Link to task in tasks table
  ticket_ref?: number | string | null;  // Reference to ticket in Tickets table (1708)
  widget_ref?: number | null;  // ADR-0003 widget-embed: embedded widgets.id for level==='widget'
  settings_override?: Record<string, unknown> | string | null;  // ADR-0003 widget-embed: preset-local JSON overrides
  is_collapsed?: boolean;
  is_hidden?: boolean;
  
  // Translation fields (added dynamically)
  content_en?: string;
  content_ru?: string;
  [key: `content_${string}`]: string | undefined;
  
  // Custom fields (from widget config)
  http_method?: HttpMethod;
  http_path?: string;
  department?: string;
  priority?: string;
  
  // Page layout fields
  keep_with_next?: boolean;  // Don't separate this item from the next one across pages
  image_url?: string;        // URL for image level
  image_max_height?: number; // Max height in px for image
  
  // Atom fields (for atom modal)
  atom_key?: string;
  atom_title?: string;
  atom_comment?: string;
  
  created_at?: string;
  updated_at?: string;
}

export interface DocumentItemTreeNode extends DocumentItem {
  children: DocumentItemTreeNode[];
}

// === WIDGET CONFIG ===

export interface DocumentsWidgetConfig {
  // Required: Project and folder
  project_id: number;
  folder_path?: string;  // default: "databases/documents/"
  
  // Registry and atoms table IDs (set after init)
  registry_table_id?: number;
  atoms_table_id?: number;
  
  // Element types (select options for 'type' column)
  element_types?: Array<{
    value: string;
    label: string;
    icon?: string;
    color?: string;
  }>;
  
  // Document categories (for registry)
  categories?: Array<{
    value: string;
    label: string;
    icon?: string;
  }>;
  
  // Available tags
  tags?: string[];
  
  // Translation languages
  languages?: Array<{
    code: string;      // "en", "ru", "de"
    name: string;      // "English", "Русский"
    is_default?: boolean;
  }>;
  
  // Custom columns for doc_* tables
  custom_columns?: Array<{
    name: string;
    type: 'text' | 'select' | 'number' | 'date' | 'relation' | 'boolean';
    options?: string[];  // for select
    relation_table?: number;  // for relation
  }>;
  
  // === ADR-038: Task Binding ===
  task_binding?: TaskBindingConfig;

  // === Ticket Binding (auto-discoverable) ===
  ticket_binding?: TicketBindingConfig;

  // === ADR-0003 §C-1: BDD companion panel ===
  /** When true, render the BDD companion panel in the document header (criteria list + must-progress + filter chips). */
  bdd_enabled?: boolean;

  // === AI Agents Configuration ===
  /** Widget ID (set by backend on widget creation) */
  id?: number;
  /** AI agent settings — persisted via widget config */
  ai_agents_config?: AIAgentsConfig;
  /** Shorthand aliases for ai_agents_config fields (legacy, prefer ai_agents_config) */
  agents_table_id?: number;
  embedding_agent_id?: number;
  translation_agent_id?: number;
}

/** Configuration for AI agent bindings in the Documents widget */
export interface AIAgentsConfig {
  agents_table_id?: number;
  embedding_agent_id?: number;
  translation_agent_id?: number;
}

// === TICKET BINDING CONFIG ===

/**
 * Configuration for ticket system binding.
 * Auto-discoverable: if not set, system searches for "Tickets" or "Tasks" table
 * in the same project and auto-maps columns by name.
 */
export interface TicketBindingConfig {
  table_id: number;

  // Column mapping: internal field → actual column name in the table
  columns: {
    title: string;               // e.g. "title", "what", "name"
    description?: string;        // e.g. "description", "why"
    type?: string;               // e.g. "type", "task_type"
    state?: string;              // e.g. "state", "status"
    priority?: string;           // e.g. "priority"
    acceptance_criteria?: string; // e.g. "acceptance_criteria"
    test_steps?: string;         // e.g. "test_steps"
    created_date?: string;       // e.g. "created_date", "created_at"
  };

  // Dictionary table IDs for relation fields
  dictionaries?: {
    types_table_id?: number;
    states_table_id?: number;
    priorities_table_id?: number;
  };
}

/** Row data from ticket table - uses dynamic column names */
export interface TicketRow {
  id: number;
  [key: string]: unknown;
}

/** Dictionary item (type/state/priority) loaded from relation tables */
export interface TicketDictItem {
  id: number;
  name?: string;
  icon?: string;
  color?: string;
  [key: string]: unknown;
}

// === ADR-038: TASK BINDING CONFIG ===

/**
 * Configuration for binding documents to tasks table
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */
export interface TaskBindingConfig {
  enabled: boolean;
  table_id: number;              // ID of the Tasks table
  
  // Column mapping: document field → task column name
  columns: {
    title: string;               // Required: maps to task title
    description?: string;        // Optional: maps to description
    status?: string;             // Optional: maps to status
    due_date?: string;           // Optional: maps to due_date
    assignee?: string;           // Optional: maps to assignee_id
    priority?: string;           // Optional: maps to priority
    progress?: string;           // Optional: maps to progress (0-100)
  };
  
  // Export options when creating tasks from document
  export_options: {
    levels: Array<'h1' | 'h2' | 'h3' | 'checkbox'>;  // Which levels to export
    include_content: boolean;    // Include content as description
    default_status: string;      // Default status for new tasks
    default_priority?: string;   // Optional default priority
  };
  
  // Display options in document
  display_options: {
    show_status: boolean;        // Show status badge
    show_due_date: boolean;      // Show due date
    show_assignee: boolean;      // Show assignee name
    show_progress: boolean;      // Show progress bar
    compact_mode: boolean;       // Compact single-line display
  };
}

// === ADR-038: TASK CHAT CONTEXT ===

/**
 * Context passed to AI Chat when opening chat from a task card
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */
export interface TaskChatContext {
  type: 'task';
  task_id: number;
  table_id: number;
  
  // Task data
  task: {
    title: string;
    description?: string;
    status?: string;
    due_date?: string;
    assignee?: string;
    priority?: string;
  };
  
  // Optional document context
  document?: {
    id: number;
    title: string;
    section_content?: string;    // Content under the heading
  };
  
  // Optional flags
  include_history?: boolean;     // Include task change history
  include_comments?: boolean;    // Include task comments
}

/**
 * Linked task data for display in document
 */
export interface LinkedTaskData {
  id: number;
  title: string;
  status?: string;
  due_date?: string;
  assignee_id?: number;
  assignee_name?: string;
  priority?: string;
  progress?: number;
}

// === API RESPONSES ===

export interface DocumentsInitResponse {
  success: boolean;
  data: {
    registry_table_id: number;
    atoms_table_id: number;
    folder_path: string;
    already_exists?: boolean;
  };
  timestamp: string;
}

export interface DocumentsListResponse {
  success: boolean;
  data: {
    documents: DocumentRegistryItem[];
    registry_table_id?: number;
    atoms_table_id?: number;
    not_initialized?: boolean;
  };
  timestamp: string;
}

export interface DocumentCreateResponse {
  success: boolean;
  data: {
    document_id: number;
    table_id: number;
    slug: string;
    name: string;
  };
  timestamp: string;
}

export interface DocumentContentResponse {
  success: boolean;
  data: {
    document: DocumentRegistryItem;
    table_id: number;
    items: DocumentItem[];
    tree: DocumentItemTreeNode[];
    count: number;
  };
  timestamp: string;
}

export interface DocumentImportV4Response {
  success: boolean;
  data: {
    document_id: number;
    created_ids: number[];
    count: number;
  };
  timestamp: string;
}

export interface AddLanguageResponse {
  success: boolean;
  data: {
    language_code: string;
    updated_tables: number;
    total_tables: number;
  };
  timestamp: string;
}

// === IMPORT SECTION (for import-v4 endpoint) ===

export interface DocumentImportSection {
  order?: number;
  level: DocumentLevel;
  title?: string;
  content?: string;
  comment?: string;
  type?: DocumentItemType;
  atom_ref?: number | null;
  is_collapsed?: boolean;
  
  // Translations
  title_en?: string;
  title_ru?: string;
  content_en?: string;
  content_ru?: string;
}

// === LEVEL HELPERS ===

export const LEVEL_LABELS: Record<DocumentLevel, string> = {
  h1: 'Заголовок 1',
  h2: 'Заголовок 2',
  h3: 'Заголовок 3',
  text: 'Текст',
  atom: 'Атом',
  ticket: 'Тикет',
  divider: 'Разделитель',
  page_break: 'Разрыв страницы',
  image: 'Изображение',
  widget: 'Виджет',
};

export const LEVEL_ICONS: Record<DocumentLevel, string> = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  text: 'TXT',
  atom: '⚛',
  ticket: '🎫',
  divider: 'DIV',
  page_break: 'PGB',
  image: 'IMG',
  widget: '🧩',
};

export const HTTP_METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-green-500/20 text-green-500',
  POST: 'bg-blue-500/20 text-blue-500',
  PUT: 'bg-amber-500/20 text-amber-500',
  PATCH: 'bg-orange-500/20 text-orange-500',
  DELETE: 'bg-red-500/20 text-red-500',
};

/**
 * Static color → tailwind class map.
 * Static so the JIT compiler keeps the classes in the bundle.
 */
const COLOR_CLASSES: Record<string, { chip: string; dot: string }> = {
  yellow: { chip: 'bg-yellow-500/20 text-yellow-600', dot: 'bg-yellow-500/60' },
  amber:  { chip: 'bg-amber-500/20 text-amber-600',   dot: 'bg-amber-500/60' },
  orange: { chip: 'bg-orange-500/20 text-orange-600', dot: 'bg-orange-500/60' },
  red:    { chip: 'bg-red-500/20 text-red-600',       dot: 'bg-red-500/60' },
  purple: { chip: 'bg-purple-500/20 text-purple-600', dot: 'bg-purple-500/60' },
  pink:   { chip: 'bg-pink-500/20 text-pink-600',     dot: 'bg-pink-500/60' },
  blue:   { chip: 'bg-blue-500/20 text-blue-600',     dot: 'bg-blue-500/60' },
  cyan:   { chip: 'bg-cyan-500/20 text-cyan-600',     dot: 'bg-cyan-500/60' },
  teal:   { chip: 'bg-teal-500/20 text-teal-600',     dot: 'bg-teal-500/60' },
  green:  { chip: 'bg-green-500/20 text-green-600',   dot: 'bg-green-500/60' },
  gray:   { chip: 'bg-gray-500/20 text-gray-600',     dot: 'bg-gray-500/60' },
};

/** Legacy slug → color name fallback (used when no StatusOption is available) */
const LEGACY_SLUG_COLORS: Record<string, string> = {
  draft: 'yellow',
  review: 'purple',
  approved: 'blue',
  ready: 'cyan',
  published: 'green',
  archived: 'gray',
  deprecated: 'red',
  active: 'green',
  inactive: 'gray',
};

export const STATUS_COLOR_FALLBACK = 'bg-gray-500/20 text-gray-600';

export type ChipStyle = { className: string; style?: CSSProperties };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function chipFromHex(hex: string): ChipStyle {
  return {
    className: '',
    style: { backgroundColor: `${hex}33`, color: hex },
  };
}

function dotFromHex(hex: string): ChipStyle {
  return { className: '', style: { backgroundColor: hex } };
}

/** Get status chip classes from a StatusOption (preferred) or legacy slug */
export function getStatusChipClass(option: { color?: string } | string | null | undefined): ChipStyle {
  if (!option) return { className: STATUS_COLOR_FALLBACK };
  const color = typeof option === 'string' ? LEGACY_SLUG_COLORS[option] : option.color;
  if (color && HEX_RE.test(color)) return chipFromHex(color);
  return { className: COLOR_CLASSES[color || '']?.chip || STATUS_COLOR_FALLBACK };
}

/** Get the small colored dot class for a StatusOption */
export function getStatusDotClass(option: { color?: string } | string | null | undefined): ChipStyle {
  if (!option) return { className: 'bg-gray-500/60' };
  const color = typeof option === 'string' ? LEGACY_SLUG_COLORS[option] : option.color;
  if (color && HEX_RE.test(color)) return dotFromHex(color);
  return { className: COLOR_CLASSES[color || '']?.dot || 'bg-gray-500/60' };
}

/** @deprecated Use getStatusChipClass(option | slug) — kept for read-only callers that still pass a slug. */
export function getStatusColor(status: string): string {
  return getStatusChipClass(status).className;
}

/** @deprecated Use getStatusChipClass — kept so legacy imports still resolve. */
export const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_SLUG_COLORS).map(([slug, color]) => [slug, COLOR_CLASSES[color]?.chip || STATUS_COLOR_FALLBACK])
);

export const CATEGORY_ICONS: Record<string, string> = {
  API: '🔌',
  Frontend: '🎨',
  Backend: '⚙️',
  DevOps: '🛠️',
  Guide: '📚',
  Other: '📁',
};
