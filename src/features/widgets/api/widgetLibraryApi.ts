/**
 * Widget Library API — ADR-073
 * API functions for Widget Picker system
 */

import { apiClient } from '@/shared/utils/apiClient';
import type {
  WidgetLibraryResponse,
  WidgetLibraryItem,
  ToggleFavoriteResponse,
  AddFromLibraryRequest,
  WidgetCategory,
  WidgetLibraryApiResponse,
  SpaceModuleItem,
  SpaceWidgetItem,
  SpaceTableItem,
} from '../types/widget-library.types';
import type { Widget, WidgetPosition } from '../types/widget.types';

const LIBRARY_BASE = '/widget-library';
const DASHBOARDS_BASE = '/dashboards';

/**
 * Fetch library widgets with filters
 */
export interface GetLibraryWidgetsParams {
  spaceId: number;
  includePublic?: boolean;
  category?: WidgetCategory | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function getLibraryWidgets(
  params: GetLibraryWidgetsParams
): Promise<WidgetLibraryResponse> {
  const queryParams = new URLSearchParams();
  queryParams.set('space_id', String(params.spaceId));

  if (params.includePublic !== undefined) {
    queryParams.set('include_public', params.includePublic ? '1' : '0');
  }
  if (params.category) {
    queryParams.set('category', params.category);
  }
  if (params.search) {
    queryParams.set('search', params.search);
  }
  if (params.limit) {
    queryParams.set('limit', String(params.limit));
  }
  if (params.offset) {
    queryParams.set('offset', String(params.offset));
  }

  const response = await apiClient.get<WidgetLibraryApiResponse<WidgetLibraryResponse>>(
    `${LIBRARY_BASE}?${queryParams.toString()}`
  );

  return response.data;
}

/**
 * Get user's favorite widgets
 */
export async function getFavorites(): Promise<WidgetLibraryItem[]> {
  const response = await apiClient.get<WidgetLibraryApiResponse<WidgetLibraryItem[]>>(
    `${LIBRARY_BASE}/favorites`
  );
  return response.data;
}

/**
 * Get recently used widgets
 */
export async function getRecent(limit = 10): Promise<WidgetLibraryItem[]> {
  const response = await apiClient.get<WidgetLibraryApiResponse<WidgetLibraryItem[]>>(
    `${LIBRARY_BASE}/recent?limit=${limit}`
  );
  return response.data;
}

/**
 * Toggle favorite status for a widget
 */
export async function toggleFavorite(widgetId: number): Promise<ToggleFavoriteResponse> {
  const response = await apiClient.post<WidgetLibraryApiResponse<ToggleFavoriteResponse>>(
    `${LIBRARY_BASE}/${widgetId}/favorite`
  );
  return response.data;
}

/**
 * Add widget from library to dashboard
 */
export async function addFromLibrary(
  dashboardId: number,
  sourceWidgetId: number,
  mode: 'reference' | 'copy',
  position?: WidgetPosition
): Promise<Widget> {
  const body: AddFromLibraryRequest = {
    source_widget_id: sourceWidgetId,
    mode,
    position,
  };

  const response = await apiClient.post<WidgetLibraryApiResponse<Widget>>(
    `${DASHBOARDS_BASE}/${dashboardId}/widgets/from-library`,
    body
  );

  return response.data;
}

/**
 * Fetch modules for a space (sidebar modules)
 * These are the widgets registered in the space sidebar
 */
export async function getSpaceModules(spaceId: number): Promise<SpaceModuleItem[]> {
  const response = await apiClient.get<WidgetLibraryApiResponse<SpaceModuleItem[]>>(
    `/spaces/${spaceId}/modules`
  );
  return response.data;
}

/**
 * Fetch all widgets available in a space (from all projects)
 * Includes both registered modules and unregistered widgets
 */
export async function getSpaceWidgets(spaceId: number): Promise<SpaceWidgetItem[]> {
  const response = await apiClient.get<WidgetLibraryApiResponse<SpaceWidgetItem[]>>(
    `/spaces/${spaceId}/widgets-available`
  );
  return response.data;
}

/**
 * Fetch tables visible in nav from a space (show_in_nav=1)
 * Used in Widget Picker to show tables as data sources
 */
export async function getSpaceTables(spaceId: number): Promise<SpaceTableItem[]> {
  const response = await apiClient.get<WidgetLibraryApiResponse<SpaceTableItem[]>>(
    `/spaces/${spaceId}/tables-available`
  );
  return response.data;
}
