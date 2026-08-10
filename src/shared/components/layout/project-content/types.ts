export interface ProjectContentProps {
  projectId: number;
  isPrivileged?: boolean; // If true, show admin-only features (new widget, new folder)
  searchQuery?: string; // Optional search filter
  // ADR-0060-A A1 — public mode strips mutation affordances (cog, +folder, +widget)
  // and disables DnD/folders. Combined with `widgetsOverride` it also bypasses
  // the auth'd `useProjectWidgets` fetch.
  mode?: 'private' | 'public';
  // Required when mode==='public' to build /s/:slug/widgets/:id links.
  publicSlug?: string;
  // Public mode: pre-fetched widgets (PublicTree → projects[].widgets).
  widgetsOverride?: ProjectContentWidget[];
}

export interface WidgetItem {
  id: number;
  title: string;
  description?: string;
  preset_name?: string;
  icon?: string;
  config?: {
    tableId?: string;
    table_id?: string;
  };
}

// Public alias for callers (Sidebar/PublicLayout) — same shape as WidgetItem.
export type ProjectContentWidget = WidgetItem;

export interface WidgetFolder {
  id: string;
  name: string;
  icon?: string;
  items: number[]; // widget ids
  isExpanded: boolean;
}

export interface WidgetOrganization {
  folders: WidgetFolder[];
  rootItems: number[]; // widget ids not in folders
  order: (string | number)[]; // folder ids (string) and widget ids (number) in display order
}

// Widget type icons and labels
export const widgetTypeConfig: Record<string, { emoji: string; labelKey: string }> = {
  table_widget: { emoji: '📊', labelKey: 'widgets.types.table' },
  table_view: { emoji: '📊', labelKey: 'widgets.types.table' },
  kanban_widget: { emoji: '📋', labelKey: 'widgets.types.kanban' },
  kanban: { emoji: '📋', labelKey: 'widgets.types.kanban' },
  calendar_widget: { emoji: '📅', labelKey: 'widgets.types.calendar' },
  calendar: { emoji: '📅', labelKey: 'widgets.types.calendar' },
  timeline_widget: { emoji: '📈', labelKey: 'widgets.types.timeline' },
  timeline: { emoji: '📈', labelKey: 'widgets.types.timeline' },
  chart_widget: { emoji: '📉', labelKey: 'widgets.types.chart' },
  chart: { emoji: '📉', labelKey: 'widgets.types.chart' },
  gallery_widget: { emoji: '🖼️', labelKey: 'widgets.types.gallery' },
  gallery: { emoji: '🖼️', labelKey: 'widgets.types.gallery' },
};
