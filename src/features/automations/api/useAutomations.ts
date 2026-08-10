import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { 
  AutomationModel, 
  AutomationLog, 
  AutomationCondition,
  TriggerType, 
  ActionType,
  TriggerConfig,
  ActionConfig
} from '../types/automation.types';

interface AutomationsResponse {
  success: boolean;
  data: AutomationModel[];
  stats?: { totalExecutions: number };
  error?: { message: string };
}

interface AutomationResponse {
  success: boolean;
  data: AutomationModel;
  error?: { message: string };
}

interface LogsResponse {
  success: boolean;
  data: AutomationLog[];
  error?: { message: string };
}

interface ExecuteResponse {
  success: boolean;
  data: {
    status: 'success' | 'error';
    resultData: Record<string, unknown>;
    errorMessage: string | null;
    durationMs: number;
  };
  error?: { message: string };
}

interface CreateAutomationInput {
  name: string;
  description?: string;
  tableId: string;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig | Record<string, unknown>;
  actionType: ActionType;
  actionConfig: ActionConfig | Record<string, unknown>;
  conditions?: unknown[];
  isActive?: boolean;
}

interface UpdateAutomationInput {
  id: string;
  name?: string;
  description?: string;
  triggerType?: TriggerType;
  triggerConfig?: Record<string, unknown>;
  actionType?: ActionType;
  actionConfig?: Record<string, unknown>;
  conditions?: unknown[];
  isActive?: boolean;
}

const API_BASE = '/api/v3/automations';

// Общий fetch с credentials
const fetchWithAuth = (url: string, options: RequestInit = {}) => {
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...options.headers,
    },
  });
};

// Маппинг из snake_case в camelCase
function mapAutomation(a: Record<string, unknown>): AutomationModel {
  return {
    id: String(a.id),
    name: a.name as string,
    description: a.description as string | undefined,
    tableId: String(a.table_id),
    tableName: a.table_name as string | undefined,
    isActive: Boolean(a.is_active),
    triggerType: a.trigger_type as TriggerType,
    triggerConfig: a.trigger_config as TriggerConfig,
    actionType: a.action_type as ActionType,
    actionConfig: a.action_config as ActionConfig,
    conditions: a.conditions as AutomationCondition[] | undefined,
    createdAt: a.created_at as string,
    updatedAt: a.updated_at as string,
  };
}

// Маппинг из camelCase в snake_case для отправки на бекенд
function mapToSnakeCase(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const mapping: Record<string, string> = {
    triggerType: 'trigger_type',
    triggerConfig: 'trigger_config',
    actionType: 'action_type',
    actionConfig: 'action_config',
    isActive: 'is_active',
    tableId: 'table_id',
  };
  
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const snakeKey = mapping[key] || key;
    result[snakeKey] = value;
  }
  
  return result;
}

// Получить все автоматизации
export function useAutomations(scopeId?: string, scopeType: 'table' | 'project' = 'table') {
  return useQuery<AutomationsResponse>({
    queryKey: ['automations', scopeType, scopeId],
    queryFn: async () => {
      let url = API_BASE;
      if (scopeId) {
        if (scopeType === 'table') {
          url = `${API_BASE}/table/${scopeId}`;
        } else {
          url = `${API_BASE}/project/${scopeId}`;
        }
      }
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error('Failed to fetch automations');
      const json = await res.json();
      return {
        ...json,
        data: (json.data || []).map(mapAutomation)
      };
    },
    staleTime: 30000,
  });
}

// Получить одну автоматизацию
export function useAutomation(id: string) {
  return useQuery<AutomationResponse>({
    queryKey: ['automation', id],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API_BASE}/${id}`);
      if (!res.ok) throw new Error('Failed to fetch automation');
      return res.json();
    },
    enabled: Boolean(id),
  });
}

// Создать автоматизацию
export function useCreateAutomation() {
  const queryClient = useQueryClient();
  
  return useMutation<AutomationResponse, Error, CreateAutomationInput>({
    mutationFn: async (input) => {
      // Бекенд POST /v3/automations принимает snake_case (table_id/trigger_type/action_type)
      // и без них отвечает 400 "Missing required fields". Раньше тело уходило в camelCase —
      // автоматизация никогда не сохранялась. Конвертируем так же, как в update.
      const res = await fetchWithAuth(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapToSnakeCase(input as unknown as Record<string, unknown>)),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error?.message || error.error || 'Failed to create automation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
}

// Обновить автоматизацию
export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  
  return useMutation<AutomationResponse, Error, UpdateAutomationInput>({
    mutationFn: async ({ id, ...updates }) => {
      // Конвертируем camelCase в snake_case для бекенда
      const snakeCaseUpdates = mapToSnakeCase(updates);
      
      const res = await fetchWithAuth(`${API_BASE}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snakeCaseUpdates),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error?.message || error.error || 'Failed to update automation');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      queryClient.invalidateQueries({ queryKey: ['automation', variables.id] });
    },
  });
}

// Удалить автоматизацию
export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  
  return useMutation<{ success: boolean; data: { id: string } }, Error, string>({
    mutationFn: async (id) => {
      const res = await fetchWithAuth(`${API_BASE}/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || 'Failed to delete automation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
}

// Выполнить автоматизацию
export function useExecuteAutomation() {
  const queryClient = useQueryClient();
  
  return useMutation<ExecuteResponse, Error, { id: string; rowId?: string; triggerData?: Record<string, unknown> }>({
    mutationFn: async ({ id, rowId, triggerData }) => {
      const res = await fetchWithAuth(`${API_BASE}/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, triggerData }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || 'Failed to execute automation');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['automationLogs', variables.id] });
    },
  });
}

// Получить логи автоматизации
export function useAutomationLogs(automationId: string, limit = 50) {
  return useQuery<LogsResponse>({
    queryKey: ['automationLogs', automationId, limit],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API_BASE}/${automationId}/logs?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    enabled: Boolean(automationId),
    staleTime: 10000,
  });
}
