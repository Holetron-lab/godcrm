import { apiClient } from '@/shared/utils/apiClient';
import type {
  Widget,
  CreateWidgetRequest,
  CreateWidgetByOwnerRequest,
  UpdateWidgetRequest,
  UpdateWidgetCodeRequest,
  WidgetResponse,
  WidgetsListResponse,
  WidgetDataResponse,
  WidgetPresetsResponse,
} from '../types/widget.types';

const WIDGETS_BASE = '/widgets';
const DASHBOARDS_BASE = '/dashboards';

/**
 * Get all widgets for a dashboard
 */
export async function getWidgetsByDashboard(
  dashboardId: number
): Promise<Widget[]> {
  const response = await apiClient.request<WidgetsListResponse>(
    `${DASHBOARDS_BASE}/${dashboardId}/widgets`
  );
  return response.data;
}

/**
 * Get single widget by ID.
 * ADR-0012 Phase 8 (T-135214): pass `atomId` to receive the effective config
 * (template deep-merged with the embedding atom's `settings_override`).
 */
export async function getWidgetById(
  widgetId: number,
  atomId?: number | null
): Promise<Widget> {
  const qs = atomId != null && Number.isFinite(atomId) ? `?atom_id=${atomId}` : '';
  const response = await apiClient.request<WidgetResponse>(
    `${WIDGETS_BASE}/${widgetId}${qs}`
  );
  return response.data;
}

/**
 * Create widget
 */
export async function createWidget(
  data: CreateWidgetRequest
): Promise<Widget> {
  const { dashboard_id, ...rest } = data;
  const response = await apiClient.request<WidgetResponse>(
    `${DASHBOARDS_BASE}/${dashboard_id}/widgets`,
    {
      method: 'POST',
      body: JSON.stringify(rest),
    }
  );
  return response.data;
}

/**
 * ADR-0003 widget-embed Phase 1: create widget with explicit owner
 * (document row, atom row, or dashboard). Hits POST /api/v3/widgets.
 */
export async function createWidgetByOwner(
  data: CreateWidgetByOwnerRequest
): Promise<Widget> {
  const response = await apiClient.request<WidgetResponse>(
    `${WIDGETS_BASE}`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
  return response.data;
}

/**
 * Update widget
 */
export async function updateWidget(
  widgetId: number,
  updates: UpdateWidgetRequest
): Promise<Widget> {
  const response = await apiClient.request<WidgetResponse>(
    `${WIDGETS_BASE}/${widgetId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  );
  return response.data;
}

/**
 * Update widget code (custom widgets only)
 */
export async function updateWidgetCode(
  widgetId: number,
  data: UpdateWidgetCodeRequest
): Promise<Widget> {
  const response = await apiClient.request<WidgetResponse>(
    `${WIDGETS_BASE}/${widgetId}/code`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    }
  );
  return response.data;
}

/**
 * Delete widget
 */
export async function deleteWidget(widgetId: number): Promise<void> {
  await apiClient.request<void>(`${WIDGETS_BASE}/${widgetId}`, {
    method: 'DELETE',
  });
}

/**
 * Get widget data.
 * ADR-0012 Phase 8 (T-135214): pass `atomId` to resolve effective config
 * (template + atom override) before pulling rows.
 */
export async function getWidgetData<T = unknown>(
  widgetId: number,
  atomId?: number | null
): Promise<T[]> {
  const qs = atomId != null && Number.isFinite(atomId) ? `?atom_id=${atomId}` : '';
  const response = await apiClient.request<WidgetDataResponse<T>>(
    `${WIDGETS_BASE}/${widgetId}/data${qs}`
  );
  return response.data;
}

/**
 * Get all available widget presets
 * Returns static presets since backend endpoint doesn't exist
 */
export async function getWidgetPresets() {
  // Static presets - backend endpoint /widgets/presets doesn't exist
  return [
    {
      id: 'table_view',
      name: 'Таблица',
      description: 'Отображение данных в виде таблицы',
      icon: '📋',
      type: 'table_view',
    },
    {
      id: 'kanban_board',
      name: 'Канбан',
      description: 'Доска с колонками и карточками',
      icon: '📊',
      type: 'kanban_board',
    },
    {
      id: 'calendar_widget',
      name: 'Календарь',
      description: 'Отображение событий в календаре',
      icon: '📅',
      type: 'calendar_widget',
    },
    {
      id: 'timeline_widget',
      name: 'Таймлайн',
      description: 'Хронология событий',
      icon: '⏱️',
      type: 'timeline_widget',
    },
    {
      id: 'chart_widget',
      name: 'График',
      description: 'Визуализация данных',
      icon: '📈',
      type: 'chart_widget',
    },
    {
      id: 'task_list',
      name: 'Чеклист',
      description: 'Список задач',
      icon: '✅',
      type: 'task_list',
    },
    {
      id: 'recent_activity',
      name: 'Активность',
      description: 'Лента активности',
      icon: '📰',
      type: 'recent_activity',
    },
    {
      id: 'ai_agents',
      name: 'AI Агенты',
      description: 'Управление AI агентами',
      icon: '🤖',
      type: 'ai_agents',
    },
  ];
}
