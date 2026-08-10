import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWidgetsByDashboard,
  getWidgetById,
  createWidget,
  updateWidget,
  updateWidgetCode,
  deleteWidget,
  getWidgetData,
  getWidgetPresets,
} from '../api/widgetsApi';
import { spacesKeys } from '@/features/spaces/hooks/useSpacesQuery';
import {
  guardMutation,
  useIsPublicReadOnly,
  usePublicView,
} from '@/features/public/PublicViewContext';
import {
  publicApi,
  type PublicDashboardWidgetSummary,
} from '@/features/public/publicApi';
import type {
  CreateWidgetRequest,
  UpdateWidgetRequest,
  UpdateWidgetCodeRequest,
  Widget,
  PresetWidgetName,
} from '../types/widget.types';

/**
 * ADR-0060-A A3: reshape a public dashboard widget summary into the internal
 * `Widget` shape so `DashboardGrid` can render the same layout authed-side
 * does. Fields absent from the public payload (config, dashboard membership
 * metadata, authoring) are filled with safe defaults — the inner widget
 * fetcher swaps to the public widget endpoint for the rest.
 */
function publicSummaryToWidget(
  summary: PublicDashboardWidgetSummary,
  dashboardId: number,
): Widget {
  return {
    id: summary.id,
    dashboard_id: dashboardId,
    source_widget_id: null,
    widget_type: 'preset',
    preset_name: summary.type as PresetWidgetName,
    code: null,
    code_version: 0,
    title: summary.name,
    description: null,
    icon: summary.icon ?? '',
    config: {},
    position: {
      x: summary.position.x,
      y: summary.position.y,
      w: summary.position.w,
      h: summary.position.h,
      minW: summary.position.minW,
      minH: summary.position.minH,
    },
    is_visible: true,
    is_module: false,
    is_public: true,
    order_index: 0,
    created_by: null,
    created_at: '',
    updated_at: '',
    module_id: null,
    sidebar_order: null,
    sidebar_icon: null,
    access_level: null,
    is_pinned: null,
  };
}

// Query keys
// ADR-0012 Phase 8 (T-135214): widget detail/data caches are atom-scoped when
// the embedding atom contributes a `settings_override` — without atom in the
// key, two atoms reusing the same template would share (and stomp) the cache.
export const widgetKeys = {
  all: ['widgets'] as const,
  lists: () => [...widgetKeys.all, 'list'] as const,
  list: (dashboardId: number) =>
    [...widgetKeys.lists(), dashboardId] as const,
  details: () => [...widgetKeys.all, 'detail'] as const,
  detail: (widgetId: number, atomId?: number | null) =>
    atomId != null
      ? ([...widgetKeys.details(), widgetId, 'atom', atomId] as const)
      : ([...widgetKeys.details(), widgetId] as const),
  data: (widgetId: number, atomId?: number | null) =>
    atomId != null
      ? ([...widgetKeys.detail(widgetId, atomId), 'data'] as const)
      : ([...widgetKeys.detail(widgetId), 'data'] as const),
  presets: () => [...widgetKeys.all, 'presets'] as const,
};

/**
 * Get widgets for dashboard.
 *
 * ADR-0060-A A3: when rendered inside a `PublicViewProvider` with a
 * `publicSlug`, the fetch is routed through `publicApi.getDashboard` so
 * `DashboardGrid` renders the same layout for unauthed visitors. Summaries
 * are reshaped into the internal `Widget` shape via `publicSummaryToWidget`.
 */
export function useWidgets(dashboardId: number) {
  const { publicSlug } = usePublicView();
  return useQuery({
    queryKey: publicSlug
      ? ([...widgetKeys.list(dashboardId), 'public', publicSlug] as const)
      : widgetKeys.list(dashboardId),
    queryFn: () => {
      if (publicSlug) {
        return publicApi
          .getDashboard(publicSlug, dashboardId)
          .then((r) => r.data.widgets.map((s) => publicSummaryToWidget(s, dashboardId)));
      }
      return getWidgetsByDashboard(dashboardId);
    },
    enabled: !!dashboardId,
  });
}

/**
 * Get single widget.
 * ADR-0012 Phase 8 (T-135214): pass `atomId` from a document widget atom so
 * the response carries the deep-merged effective config.
 */
export function useWidget(widgetId: number, atomId?: number | null) {
  return useQuery({
    queryKey: widgetKeys.detail(widgetId, atomId),
    queryFn: () => getWidgetById(widgetId, atomId),
    enabled: !!widgetId,
  });
}

/**
 * Get widget data.
 * ADR-0012 Phase 8 (T-135214): pass `atomId` to fetch rows resolved against
 * the atom's `settings_override` (table_id, filters, etc.).
 */
export function useWidgetData<T = unknown>(
  widgetId: number,
  enabled = true,
  atomId?: number | null
) {
  return useQuery({
    queryKey: widgetKeys.data(widgetId, atomId),
    queryFn: () => getWidgetData<T>(widgetId, atomId),
    enabled: !!widgetId && enabled,
  });
}

/**
 * Get widget presets
 */
export function useWidgetPresets() {
  return useQuery({
    queryKey: widgetKeys.presets(),
    queryFn: getWidgetPresets,
    staleTime: Infinity, // Presets don't change
  });
}

/**
 * Create widget mutation
 */
export function useCreateWidget() {
  const readOnly = useIsPublicReadOnly();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: CreateWidgetRequest) => createWidget(data),
    onSuccess: (newWidget) => {
      // Invalidate dashboard widgets list
      queryClient.invalidateQueries({
        queryKey: widgetKeys.list(newWidget.dashboard_id),
      });
      // Also invalidate project-dashboard query to ensure dashboard page refreshes
      queryClient.invalidateQueries({
        queryKey: ['project-dashboard'],
      });
      // Invalidate spaces to refresh sidebar
      queryClient.invalidateQueries({
        queryKey: spacesKeys.lists(),
      });
    },
  });

  return guardMutation(mutation, readOnly, 'useCreateWidget');
}

/**
 * Update widget mutation
 */
export function useUpdateWidget() {
  const readOnly = useIsPublicReadOnly();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      widgetId,
      updates,
    }: {
      widgetId: number;
      updates: UpdateWidgetRequest;
    }) => updateWidget(widgetId, updates),
    onSuccess: (updatedWidget) => {
      // Invalidate specific widget
      queryClient.invalidateQueries({
        queryKey: widgetKeys.detail(updatedWidget.id),
      });
      // Invalidate dashboard list
      queryClient.invalidateQueries({
        queryKey: widgetKeys.list(updatedWidget.dashboard_id),
      });
    },
  });

  return guardMutation(mutation, readOnly, 'useUpdateWidget');
}

/**
 * Update widget code mutation
 */
export function useUpdateWidgetCode() {
  const readOnly = useIsPublicReadOnly();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      widgetId,
      data,
    }: {
      widgetId: number;
      data: UpdateWidgetCodeRequest;
    }) => updateWidgetCode(widgetId, data),
    onSuccess: (updatedWidget) => {
      // Invalidate specific widget
      queryClient.invalidateQueries({
        queryKey: widgetKeys.detail(updatedWidget.id),
      });
      // Invalidate widget data (code changed, data might change)
      queryClient.invalidateQueries({
        queryKey: widgetKeys.data(updatedWidget.id),
      });
    },
  });

  return guardMutation(mutation, readOnly, 'useUpdateWidgetCode');
}

/**
 * Delete widget mutation
 */
export function useDeleteWidget() {
  const readOnly = useIsPublicReadOnly();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (widgetId: number) => deleteWidget(widgetId),
    onSuccess: (_, widgetId) => {
      // Remove from cache
      queryClient.removeQueries({
        queryKey: widgetKeys.detail(widgetId),
      });
      // Invalidate all lists (we don't know which dashboard it was on)
      queryClient.invalidateQueries({
        queryKey: widgetKeys.lists(),
      });
      // Invalidate project-dashboard
      queryClient.invalidateQueries({
        queryKey: ['project-dashboard'],
      });
      // Invalidate project-widgets (for sidebar)
      queryClient.invalidateQueries({
        queryKey: ['project-widgets'],
      });
      // Invalidate spaces to refresh sidebar
      queryClient.invalidateQueries({
        queryKey: spacesKeys.lists(),
      });
    },
    onError: (error: Error & { response?: { data?: { error?: { code?: string } } } }) => {
      // Check for module protection error
      if (error.response?.data?.error?.code === 'WIDGET_IS_MODULE') {
        // Handled by component - show specific message
        throw new Error('WIDGET_IS_MODULE');
      }
    },
  });

  return guardMutation(mutation, readOnly, 'useDeleteWidget');
}
