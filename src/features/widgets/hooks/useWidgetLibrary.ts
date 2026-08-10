/**
 * useWidgetLibrary Hook — ADR-073
 * TanStack Query hook for Widget Library operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import {
  getLibraryWidgets,
  getFavorites,
  getRecent,
  toggleFavorite,
  addFromLibrary,
  getSpaceModules,
  getSpaceWidgets,
  getSpaceTables,
} from '../api/widgetLibraryApi';
import { widgetKeys } from './useWidgets';
import type {
  WidgetLibraryItem,
  WidgetLibraryResponse,
  WidgetCategory,
  WidgetLibraryCounts,
  SpaceModuleItem,
  SpaceWidgetItem,
  SpaceTableItem,
} from '../types/widget-library.types';
import type { Widget, WidgetPosition } from '../types/widget.types';

// Query keys for widget library
export const widgetLibraryKeys = {
  all: ['widget-library'] as const,
  list: (spaceId: number, options?: LibraryQueryOptions) =>
    [...widgetLibraryKeys.all, 'list', spaceId, options] as const,
  favorites: () => [...widgetLibraryKeys.all, 'favorites'] as const,
  recent: (limit?: number) => [...widgetLibraryKeys.all, 'recent', limit] as const,
};

interface LibraryQueryOptions {
  category?: WidgetCategory | null;
  search?: string | null;
  includePublic?: boolean;
}

export interface UseWidgetLibraryOptions {
  spaceId: number;
  category?: WidgetCategory | null;
  search?: string | null;
  includePublic?: boolean;
  enabled?: boolean;
}

export interface UseWidgetLibraryReturn {
  items: WidgetLibraryItem[];
  total: number;
  categories: WidgetLibraryCounts;
  isLoading: boolean;
  error: Error | null;
  toggleFavorite: (widgetId: number) => Promise<void>;
  addToLibrary: (
    dashboardId: number,
    widgetId: number,
    mode: 'reference' | 'copy',
    position?: WidgetPosition
  ) => Promise<Widget>;
  refetch: () => void;
}

/**
 * Hook for fetching and managing widget library
 */
export function useWidgetLibrary(options: UseWidgetLibraryOptions): UseWidgetLibraryReturn {
  const queryClient = useQueryClient();
  const { spaceId, category, search, includePublic = true, enabled = true } = options;

  // Main library query
  const libraryQuery = useQuery({
    queryKey: widgetLibraryKeys.list(spaceId, { category, search, includePublic }),
    queryFn: () =>
      getLibraryWidgets({
        spaceId,
        category,
        search,
        includePublic,
      }),
    enabled: enabled && spaceId > 0,
    staleTime: 30000, // 30 seconds
  });

  // Toggle favorite mutation
  const toggleFavoriteMutation = useMutation({
    mutationFn: (widgetId: number) => toggleFavorite(widgetId),
    onMutate: async (widgetId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: widgetLibraryKeys.all });

      // Snapshot current data
      const previousData = queryClient.getQueryData<WidgetLibraryResponse>(
        widgetLibraryKeys.list(spaceId, { category, search, includePublic })
      );

      // Optimistically update the item
      if (previousData) {
        queryClient.setQueryData<WidgetLibraryResponse>(
          widgetLibraryKeys.list(spaceId, { category, search, includePublic }),
          {
            ...previousData,
            items: previousData.items.map((item) =>
              item.widget_id === widgetId
                ? { ...item, is_favorite: !item.is_favorite }
                : item
            ),
          }
        );
      }

      return { previousData };
    },
    onError: (err, widgetId, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          widgetLibraryKeys.list(spaceId, { category, search, includePublic }),
          context.previousData
        );
      }
      logger.error('Failed to toggle favorite:', err);
    },
    onSettled: () => {
      // Invalidate all library queries to ensure consistency
      queryClient.invalidateQueries({ queryKey: widgetLibraryKeys.all });
    },
  });

  // Add from library mutation
  const addFromLibraryMutation = useMutation({
    mutationFn: ({
      dashboardId,
      sourceWidgetId,
      mode,
      position,
    }: {
      dashboardId: number;
      sourceWidgetId: number;
      mode: 'reference' | 'copy';
      position?: WidgetPosition;
    }) => addFromLibrary(dashboardId, sourceWidgetId, mode, position),
    onSuccess: (newWidget) => {
      // Invalidate dashboard widgets list
      queryClient.invalidateQueries({
        queryKey: widgetKeys.list(newWidget.dashboard_id),
      });
      // Invalidate project-dashboard for refresh
      queryClient.invalidateQueries({
        queryKey: ['project-dashboard'],
      });
      // Update library to reflect use_count change
      queryClient.invalidateQueries({
        queryKey: widgetLibraryKeys.all,
      });
      logger.debug('Widget added from library:', newWidget.id);
    },
    onError: (err) => {
      logger.error('Failed to add widget from library:', err);
    },
  });

  // Default empty response
  const emptyCategories: WidgetLibraryCounts = {
    favorites: 0,
    recent: 0,
    this_space: 0,
    all_spaces: 0,
  };

  return {
    items: libraryQuery.data?.items ?? [],
    total: libraryQuery.data?.total ?? 0,
    categories: libraryQuery.data?.categories ?? emptyCategories,
    isLoading: libraryQuery.isLoading,
    error: libraryQuery.error,
    toggleFavorite: async (widgetId: number) => {
      await toggleFavoriteMutation.mutateAsync(widgetId);
    },
    addToLibrary: async (
      dashboardId: number,
      widgetId: number,
      mode: 'reference' | 'copy',
      position?: WidgetPosition
    ) => {
      return addFromLibraryMutation.mutateAsync({
        dashboardId,
        sourceWidgetId: widgetId,
        mode,
        position,
      });
    },
    refetch: () => libraryQuery.refetch(),
  };
}

/**
 * Hook for fetching favorite widgets
 */
export function useFavoriteWidgets(enabled = true) {
  return useQuery({
    queryKey: widgetLibraryKeys.favorites(),
    queryFn: () => getFavorites(),
    enabled,
    staleTime: 30000,
  });
}

/**
 * Hook for fetching recent widgets
 */
export function useRecentWidgets(limit = 10, enabled = true) {
  return useQuery({
    queryKey: widgetLibraryKeys.recent(limit),
    queryFn: () => getRecent(limit),
    enabled,
    staleTime: 30000,
  });
}

// Query keys for space modules
export const spaceModulesKeys = {
  all: ['space-modules'] as const,
  list: (spaceId: number) => [...spaceModulesKeys.all, spaceId] as const,
};

/**
 * Hook for fetching modules from a space (sidebar modules)
 * Used in Widget Picker to show available modules to add to dashboard
 */
export function useSpaceModules(spaceId: number, enabled = true) {
  return useQuery<SpaceModuleItem[], Error>({
    queryKey: spaceModulesKeys.list(spaceId),
    queryFn: () => getSpaceModules(spaceId),
    enabled: enabled && spaceId > 0,
    staleTime: 30000,
  });
}

// Query keys for space widgets (all widgets from projects in space)
export const spaceWidgetsKeys = {
  all: ['space-widgets'] as const,
  list: (spaceId: number) => [...spaceWidgetsKeys.all, spaceId] as const,
};

/**
 * Hook for fetching all widgets from a space (from all projects)
 * Used in Widget Picker - shows both modules and unregistered widgets
 */
export function useSpaceWidgets(spaceId: number, enabled = true) {
  return useQuery<SpaceWidgetItem[], Error>({
    queryKey: spaceWidgetsKeys.list(spaceId),
    queryFn: () => getSpaceWidgets(spaceId),
    enabled: enabled && spaceId > 0,
    staleTime: 30000,
  });
}

// Query keys for space tables (tables with show_in_nav from projects in space)
export const spaceTablesKeys = {
  all: ['space-tables'] as const,
  list: (spaceId: number) => [...spaceTablesKeys.all, spaceId] as const,
};

/**
 * Hook for fetching tables visible in nav from a space
 * Used in Widget Picker - tables as data sources for widgets
 */
export function useSpaceTables(spaceId: number, enabled = true) {
  return useQuery<SpaceTableItem[], Error>({
    queryKey: spaceTablesKeys.list(spaceId),
    queryFn: () => getSpaceTables(spaceId),
    enabled: enabled && spaceId > 0,
    staleTime: 30000,
  });
}
