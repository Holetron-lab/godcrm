/**
 * Public API client for unauthenticated public space/document endpoints.
 * These requests do NOT include auth headers — cookies (for password-protected spaces) are sent automatically.
 *
 * ADR-105: AC3, AC4, AC12
 */

import { isDesktopApp } from '@/shared/types/electron.types';

const getBaseUrl = (): string => {
  if (isDesktopApp() && window.electronAPI) {
    // Desktop app uses absolute URL
    return 'https://crm.hltrn.cc/api/v3';
  }
  return '/api/v3';
};

// ---------- Types ----------

export interface PublicSpace {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  is_public: boolean;
  require_password: boolean;
  /**
   * ADR-0060-A A2: resolved landing project id (null when no public project
   * eligible or migration 062 not yet applied — frontend falls back to first
   * public dashboard from the tree, then to empty state).
   */
  main_project_id?: number | null;
  /**
   * ADR-0060-A A2: dashboard id resolved from `main_project_id` (or Tier-2
   * fallback). Null when no public dashboard exists for the landing project.
   */
  main_dashboard_id?: number | null;
}

export interface PublicDocumentSummary {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  updated_at: string | null;
}

export interface PublicDocumentItem {
  id: number;
  order: number;
  level: 'h1' | 'h2' | 'h3' | 'text' | 'divider' | 'image' | 'page_break';
  title: string | null;
  content: string | null;
  /** Bilingual content fields — may be present instead of generic `content` */
  content_en?: string | null;
  content_ru?: string | null;
  image_url: string | null;
  image_max_height: number | null;
}

export interface PublicDocument {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  updated_at: string | null;
  items: PublicDocumentItem[];
}

// ---------- Public Tree (ADR-0060 P2) ----------

export interface PublicTreeEntity {
  id: number;
  name: string;
  icon: string | null;
}

export interface PublicTreeProject extends PublicTreeEntity {
  is_public: true;
  tables: PublicTreeEntity[];
  dashboards: PublicTreeEntity[];
  widgets: PublicTreeEntity[];
}

export interface PublicTree {
  space: {
    id: number;
    name: string;
    icon: string | null;
    public_slug: string;
    /** Owner-managed sidebar prefs; absent on older API responses. */
    public_sidebar?: { default_open: boolean; hidden: boolean };
  };
  projects: PublicTreeProject[];
}

// ---------- Public Table (ADR-0060 P3) ----------

export interface PublicTableColumn {
  id: number;
  // `name` is the canonical row-data key (matches table_rows.data[name]).
  // Before ADR-0060 P5d this field carried the display_name and caused
  // every cell to render as empty when the display_name diverged from the
  // column_name; the backend now sends both, see public.js#projectPublicColumn.
  name: string;
  display_name: string;
  type: string;
  position: number;
  settings: {
    is_public?: boolean;
    cellFormat?: string;
    options?: string[];
    relation?: { enabled: boolean; labelColumn: string | null };
  };
}

export interface PublicTableMeta {
  id: number;
  name: string;
  icon: string | null;
}

export interface PublicTableRow {
  id: number;
  base_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------- Public Project / Dashboard / Widget (ADR-0060 Fat P5) ----------

export interface PublicProject {
  id: number;
  name: string;
  icon: string | null;
  description: string | null;
  theme_primary: string | null;
}

export interface PublicDashboardMeta {
  id: number;
  name: string;
  icon: string | null;
}

export interface PublicWidgetPosition {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface PublicDashboardWidgetSummary {
  id: number;
  name: string;
  icon: string | null;
  /** Preset name (e.g. 'kanban_board', 'table_view', 'task_list'). */
  type: string;
  position: PublicWidgetPosition;
}

export interface PublicWidget {
  id: number;
  /** Preset name. */
  type: string;
  name: string;
  /** Referenced table id, or `null` when the preset is data-less. */
  table_id: number | null;
  /** Already-scrubbed view config (no PII / FK leaks). */
  view_config: Record<string, unknown>;
  filter: unknown;
  sort: unknown;
  icon: string | null;
  position: PublicWidgetPosition;
}

// ---------- Documents Widget (ADR-0060 P6/B + P6/F) ----------

/**
 * Registry row for a documents widget, projected through the public scrubber.
 * The `data` blob carries only public-safe keys (see backend
 * `scrubRegistryRowData` for the canonical allow-list).
 */
export interface PublicWidgetDocumentRow {
  id: number;
  base_id: string | null;
  data: {
    name?: string;
    description?: string | null;
    slug?: string;
    icon?: string | null;
    category?: string | null;
    status?: string | null;
    order_index?: number;
    cover_url?: string | null;
    pinned?: boolean;
    parent_id?: number | null;
    tags?: string[];
    lang?: string;
    /** Per-doc atoms table id. Resolved server-side for cross-space safety. */
    table_id?: number;
  };
  created_at: string;
  updated_at: string;
}

/**
 * Atom row for a documents widget. The `data` blob carries everything except
 * authoring metadata (see backend `scrubAtomRowData` deny-list). Common
 * fields used by the viewer: `type`/`level`, `content`, `content_en`,
 * `content_ru`, `image_url`, `image_max_height`, `order`.
 */
export interface PublicWidgetAtomRow {
  id: number;
  base_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface ApiError {
  requiresPassword?: boolean;
  message?: string;
}

// ---------- Error class ----------

export class PublicApiError extends Error {
  status: number;
  requiresPassword: boolean;

  constructor(status: number, message: string, requiresPassword = false) {
    super(message);
    this.name = 'PublicApiError';
    this.status = status;
    this.requiresPassword = requiresPassword;
  }
}

// ---------- Internal fetch ----------

async function publicFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    credentials: 'include', // send cookies (password session)
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    let requiresPassword = false;
    let message = `Request failed (${response.status})`;
    try {
      const errorBody: ApiError = await response.json();
      if (errorBody.requiresPassword) requiresPassword = true;
      if (errorBody.message) message = errorBody.message;
    } catch {
      // ignore parse errors
    }
    throw new PublicApiError(response.status, message, requiresPassword);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

// ---------- API methods ----------

export const publicApi = {
  /** Fetch public space metadata */
  getSpace: (slug: string) =>
    publicFetch<ApiResponse<{ space: PublicSpace; projects: unknown[] }>>(
      `/public/s/${encodeURIComponent(slug)}`,
    ),

  /** Fetch list of public documents for a space */
  getDocuments: (slug: string) =>
    publicFetch<ApiResponse<{ documents: PublicDocumentSummary[]; registry_table_id?: number }>>(
      `/public/s/${encodeURIComponent(slug)}/docs`,
    ),

  /** Fetch a single public document with its content items */
  getDocument: (slug: string, docSlug: string) =>
    publicFetch<ApiResponse<{ document: PublicDocument; table_id?: number; items: PublicDocumentItem[] }>>(
      `/public/s/${encodeURIComponent(slug)}/docs/${encodeURIComponent(docSlug)}`,
    ),

  /**
   * Fetch the public tree (projects + tables/dashboards/widgets that are flipped public).
   * ADR-0060 P2 — used by PublicLayout to render the public-space sidebar.
   */
  getTree: (slug: string) =>
    publicFetch<ApiResponse<PublicTree>>(
      `/public/s/${encodeURIComponent(slug)}/tree`,
    ),

  /**
   * Fetch table metadata + whitelisted columns for a public table.
   * ADR-0060 P3.
   */
  getTable: (slug: string, tableId: number) =>
    publicFetch<ApiResponse<{ table: PublicTableMeta; columns: PublicTableColumn[] }>>(
      `/public/s/${encodeURIComponent(slug)}/tables/${tableId}`,
    ),

  /**
   * Fetch paginated rows for a public table. ADR-0060 P3.
   * `limit` clamps server-side to [1, 500]; `offset` to [0, ∞).
   */
  getTableRows: (
    slug: string,
    tableId: number,
    opts: { limit?: number; offset?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return publicFetch<ApiResponse<{ rows: PublicTableRow[]; total: number }>>(
      `/public/s/${encodeURIComponent(slug)}/tables/${tableId}/rows${qs ? `?${qs}` : ''}`,
    );
  },

  /** Verify password for a password-protected space */
  verifyPassword: (slug: string, password: string) =>
    publicFetch<ApiResponse<{ verified: boolean }>>(
      `/public/s/${encodeURIComponent(slug)}/verify-password`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      },
    ),

  /**
   * Fetch project metadata + its default dashboard id (Fat P5 AC10).
   * Returns 404 when the project itself or its space is non-public.
   */
  getProject: (slug: string, projectId: number) =>
    publicFetch<ApiResponse<{ project: PublicProject; dashboard_id: number | null }>>(
      `/public/s/${encodeURIComponent(slug)}/projects/${projectId}`,
    ),

  /** Fetch dashboard metadata + its scrubbed widget summary list. */
  getDashboard: (slug: string, dashboardId: number) =>
    publicFetch<ApiResponse<{
      dashboard: PublicDashboardMeta;
      widgets: PublicDashboardWidgetSummary[];
      widget_ids: number[];
    }>>(
      `/public/s/${encodeURIComponent(slug)}/dashboards/${dashboardId}`,
    ),

  /** Fetch a single scrubbed widget config (404 when not whitelisted). */
  getWidget: (slug: string, widgetId: number) =>
    publicFetch<ApiResponse<{ widget: PublicWidget }>>(
      `/public/s/${encodeURIComponent(slug)}/widgets/${widgetId}`,
    ),

  /** Paginated row data for a widget's referenced table. */
  getWidgetData: (
    slug: string,
    widgetId: number,
    opts: { limit?: number; offset?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return publicFetch<ApiResponse<{
      rows: PublicTableRow[];
      total: number;
      table_id: number | null;
    }>>(
      `/public/s/${encodeURIComponent(slug)}/widgets/${widgetId}/data${qs ? `?${qs}` : ''}`,
    );
  },

  // ---------- Documents preset (ADR-0060 P6/B + P6/F) ----------

  /**
   * List registry rows for a public documents widget.
   * Each row's `data` is the public-scrubbed registry shape (see
   * `scrubRegistryRowData` in backend/lib/publicScrubber.js — keeps
   * name/description/slug/icon/category/status/order_index/cover_url/pinned/
   * parent_id/tags/lang/table_id).
   */
  getWidgetDocuments: (slug: string, widgetId: number) =>
    publicFetch<ApiResponse<{
      rows: PublicWidgetDocumentRow[];
      total: number;
      registry_table_id: number;
    }>>(
      `/public/s/${encodeURIComponent(slug)}/widgets/${widgetId}/documents`,
    ),

  /** Single registry row by `data.slug`. */
  getWidgetDocument: (slug: string, widgetId: number, docSlug: string) =>
    publicFetch<ApiResponse<{ row: PublicWidgetDocumentRow }>>(
      `/public/s/${encodeURIComponent(slug)}/widgets/${widgetId}/documents/${encodeURIComponent(docSlug)}`,
    ),

  /**
   * Per-document atoms list. `data.table_id` on the registry row points at
   * the per-doc atoms table; backend resolves it and applies a cross-space
   * gate. Returns `{ rows: [], table_id: null }` for docs without atoms so
   * the viewer can render an empty state cleanly.
   */
  getWidgetDocumentAtoms: (slug: string, widgetId: number, docSlug: string) =>
    publicFetch<ApiResponse<{
      rows: PublicWidgetAtomRow[];
      total: number;
      table_id: number | null;
    }>>(
      `/public/s/${encodeURIComponent(slug)}/widgets/${widgetId}/documents/${encodeURIComponent(docSlug)}/atoms`,
    ),
};
