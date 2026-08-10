/**
 * Widget Library Types — ADR-073
 * Types for Widget Picker system
 */

import type { WidgetPosition, Widget } from './widget.types';

/**
 * Widget item in the library
 * Returned by GET /api/v3/widget-library
 */
export interface WidgetLibraryItem {
  widget_id: number;
  title: string;
  preset_name: string | null;
  icon: string | null;
  space_id: number;
  space_name: string;
  is_own_space: boolean;
  is_public: boolean;
  table_name: string | null;
  row_count: number | null;
  use_count: number;
  last_used_at: string | null;
  is_favorite: boolean;
  tags: string[];
}

/**
 * Category counts in the library response
 */
export interface WidgetLibraryCounts {
  favorites: number;
  recent: number;
  this_space: number;
  all_spaces: number;
}

/**
 * Response from GET /api/v3/widget-library
 */
export interface WidgetLibraryResponse {
  items: WidgetLibraryItem[];
  total: number;
  categories: WidgetLibraryCounts;
}

/**
 * Widget category for filtering
 */
export type WidgetCategory = 'favorites' | 'recent' | 'this_space' | 'all_spaces';

/**
 * Mode for adding widget from library
 * - reference: Link to source widget (shared updates)
 * - copy: Independent copy of widget
 */
export type WidgetAddMode = 'reference' | 'copy';

/**
 * Request body for POST /api/v3/dashboards/:id/widgets/from-library
 */
export interface AddFromLibraryRequest {
  source_widget_id: number;
  mode: WidgetAddMode;
  position?: WidgetPosition;
}

/**
 * Response from toggle favorite
 */
export interface ToggleFavoriteResponse {
  is_favorite: boolean;
  widget_id: number;
}

/**
 * Favorite widget item (from /widget-library/favorites)
 */
export interface FavoriteWidget extends WidgetLibraryItem {
  favorited_at: string;
}

/**
 * Recent widget item (from /widget-library/recent)
 */
export interface RecentWidget extends WidgetLibraryItem {
  last_used_at: string;
}

/**
 * API response wrapper
 */
export interface WidgetLibraryApiResponse<T> {
  success: boolean;
  data: T;
  timestamp?: string;
}

/**
 * Module item from space sidebar
 * Returned by GET /api/v3/spaces/:spaceId/modules
 */
export interface SpaceModuleItem {
  module_id: number;
  widget_id: number;
  space_id: number;
  sidebar_order: number;
  sidebar_icon: string | null;
  access_level: 'admin' | 'member' | 'viewer';
  is_pinned: boolean;
  is_default: boolean;
  widget: {
    id: number;
    dashboard_id: number;
    widget_type: string;
    preset_name: string | null;
    title: string;
    description: string | null;
    icon: string | null;
    config: Record<string, unknown>;
    position: Record<string, unknown>;
    is_visible: boolean;
    order_index?: number;
  };
}

/**
 * Widget available in a space (from all projects)
 * Returned by GET /api/v3/spaces/:spaceId/widgets-available
 */
export interface SpaceWidgetItem {
  widget_id: number;
  dashboard_id: number;
  widget_type: string;
  preset_name: string | null;
  title: string;
  description: string | null;
  icon: string | null;
  config: Record<string, unknown>;
  position: Record<string, unknown>;
  is_visible: boolean;
  project_id: number;
  project_name: string;
  project_icon: string | null;
  is_module: boolean;
  module_id: number | null;
  is_pinned: boolean;
}

/**
 * Table available in a space (show_in_nav=1)
 * Returned by GET /api/v3/spaces/:spaceId/tables-available
 */
export interface SpaceTableItem {
  table_id: number;
  name: string;
  icon: string | null;
  description: string | null;
  is_system: boolean;
  row_count: number;
  project_id: number;
  project_name: string;
  project_icon: string | null;
}
