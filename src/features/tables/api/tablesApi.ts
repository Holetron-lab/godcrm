import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import {
  ColumnModel,
  CreateTablePayload,
  RowModel,
  TableModel,
  TableConfig,
  DatabaseMapping
} from '../types/table.types';

interface RowsResponse {
  rows: RowModel[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

const unwrap = async <T>(promise: Promise<{ data: T }>) => {
  const response = await promise;
  return response.data;
};

interface BackendTable {
  id: number;
  userId?: number;
  user_id?: number; // snake_case variant
  name: string;
  displayName?: string;
  display_name?: string; // snake_case variant
  description?: string;
  type?: string;
  icon?: string;
  color?: string;
  isVisible?: number;
  is_visible?: number; // snake_case variant
  config?: Record<string, unknown>;
  projectId?: number;
  project_id?: number; // snake_case variant
  data_source_id?: string | null;
  source_table_name?: string | null;
  source_id_column?: string | null;
  sync_enabled?: number;
  parent_table_id?: number | null;
  createdAt?: string;
  created_at?: string; // snake_case variant
  updatedAt?: string;
  updated_at?: string; // snake_case variant
  is_system?: number;
  sync_target?: string;
}

interface BackendColumn {
  id: number;
  table_id: number;
  name: string; // Aliased from column_name in SQL
  column_name?: string; // Original field name
  display_name?: string;
  column_type: string; // Aliased from type in SQL
  type?: string; // Original field name
  config?: Record<string, unknown> | string | null;
  mapping?: Record<string, unknown> | string | null;
  is_required?: number;
  is_readonly?: number;
  order_index?: number;
  width?: number;
  is_visible?: number;
  created_at?: string;
  updated_at?: string;
}

// Transform backend response to frontend model (supports both camelCase and snake_case)
const transformTable = (table: BackendTable): TableModel => ({
  id: String(table.id),
  userId: table.userId || table.user_id ? String(table.userId || table.user_id) : undefined,
  name: table.name,
  displayName: table.displayName || table.display_name || table.name,
  description: table.description,
  type: (table.is_system === 1 || table.type === 'system') ? 'system' : 'custom',
  icon: table.icon,
  color: table.color,
  isVisible: (table.isVisible ?? table.is_visible ?? 1) !== 0,
  projectId: table.projectId ?? table.project_id,
  data_source_id: table.data_source_id,
  source_table_name: table.source_table_name,
  source_id_column: table.source_id_column,
  sync_enabled: table.sync_enabled === 1,
  parent_table_id: table.parent_table_id ?? null,
  // System table fields for badge display
  is_system: table.is_system === 1,
  sync_target: table.sync_target || null,
  createdAt: table.createdAt || table.created_at || '',
  updatedAt: table.updatedAt || table.updated_at || '',
  config: (() => {
    const defaultConfig: TableConfig = { defaultView: 'table', views: [], permissions: {} };
    if (!table.config) return defaultConfig;
    if (typeof table.config === 'string') {
      try {
        return { ...defaultConfig, ...JSON.parse(table.config) };
      } catch {
        return defaultConfig;
      }
    }
    return { ...defaultConfig, ...(table.config as object) };
  })()
});

// Transform column from backend to frontend format
const transformColumn = (col: BackendColumn): ColumnModel => {
  let config = {};
  if (col.config) {
    if (typeof col.config === 'string') {
      try {
        config = JSON.parse(col.config);
      } catch {
        config = {};
      }
    } else {
      config = col.config;
    }
  }
  
  // Parse mapping if needed
  let mapping = col.mapping;
  if (typeof mapping === 'string' && mapping) {
    try {
      mapping = JSON.parse(mapping);
    } catch {
      mapping = undefined;
    }
  }
  
  return {
    id: String(col.id),
    tableId: String(col.table_id),
    name: col.name || col.column_name || '',
    displayName: col.display_name || col.name || col.column_name || '',
    type: (col.column_type || col.type) as ColumnModel['type'],
    config,
    mapping: mapping as DatabaseMapping | undefined,
    isRequired: Boolean(col.is_required),
    isReadonly: Boolean(col.is_readonly),
    orderIndex: col.order_index || 0,
    width: col.width ?? 160,
    isVisible: col.is_visible !== 0,
    createdAt: col.created_at,
    updatedAt: col.updated_at
  };
};

export const tablesApi = {
  listTables: async (params?: { projectId?: number | null; userId?: number | null }) => {
    const search = new URLSearchParams();
    if (params?.projectId) {
      search.set('project_id', String(params.projectId)); // Backend expects snake_case
    }
    if (params?.userId) {
      search.set('userId', String(params.userId));
    }
    const query = search.toString() ? `?${search.toString()}` : '';
    const response = await apiClient.request<{ data: BackendTable[] }>(`/tables${query}`);
    const rawTables = (response as unknown as { data?: BackendTable[] }).data ?? [];
    const tables = rawTables.map(transformTable);
    return { tables, meta: null };
  },
  getColumns: async (tableId: string, rawMode: boolean = false) => {
    const modeParam = rawMode ? '?mode=raw' : '';
    const response = await apiClient.request<{ data: BackendColumn[]; userRole?: string }>(`/tables/${tableId}/columns${modeParam}`);
    const transformed = response.data.map(transformColumn);
    return { columns: transformed, userRole: response.userRole || 'owner' };
  },
  getRows: async (
    tableId: string, 
    page: number = 1, 
    limit: number = 50, 
    rawMode: boolean = false,
    sortColumn?: string | null,
    sortDirection?: 'asc' | 'desc' | null
  ) => {
    const modeParam = rawMode ? '&mode=raw' : '';
    const sortParams = sortColumn && sortDirection ? `&sortColumn=${sortColumn}&sortDirection=${sortDirection}` : '';
    const response = await unwrap<RowsResponse>(apiClient.request<{ data: RowsResponse }>(`/tables/${tableId}/rows?page=${page}&limit=${limit}${modeParam}${sortParams}`));
    
    // Deduplicate rows immediately after receiving from API
    const seen = new Set<string>();
    const uniqueRows = response.rows.filter(row => {
      const id = String(row.id);
      if (seen.has(id)) {
        logger.warn('🚨 [tablesApi.getRows] Duplicate row from API removed:', id);
        return false;
      }
      seen.add(id);
      return true;
    });
    
    return {
      ...response,
      rows: uniqueRows
    };
  },
  getRow: async (tableId: string, rowId: string) => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`/api/v3/tables/${tableId}/rows/${rowId}`, {
      method: 'GET',
      headers,
      credentials: 'include'
    });

    if (!response.ok) {
      const errorResponse = await response.json().catch(() => ({ error: { message: 'Failed to fetch row' } }));
      logger.error('[tablesApi.getRow] Error:', errorResponse);
      const errorMessage = errorResponse.error?.message || errorResponse.message || `Request failed (${response.status})`;
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result.data;
  },
  createTable: (payload: CreateTablePayload) =>
    unwrap<{ table: TableModel; columns: ColumnModel[] }>(
      apiClient.request<{ data: { table: TableModel; columns: ColumnModel[] } }>('/tables', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
    ),
  createCalendarTable: async (projectId: number, tableName: string = 'Calendar') => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch('/api/v3/tables/create-calendar', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ projectId, tableName })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Failed to create calendar table' } }));
      throw new Error(error.error?.message || error.message || `Request failed (${response.status})`);
    }
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to create calendar table');
    }
    return result.data;
  },
  createRow: async (tableId: string, data: Record<string, unknown>) => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    
    const response = await fetch(`/api/v3/tables/${tableId}/rows`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ data })
    });
    
    
    if (!response.ok) {
      const errorResponse = await response.json().catch(() => ({ error: { message: 'Failed to create row' } }));
      logger.error('❌ [tablesApi.createRow] Error:', errorResponse);
      // Extract user-friendly message from backend error
      const errorMessage = errorResponse.error?.message || errorResponse.message || `Request failed (${response.status})`;
      throw new Error(errorMessage);
    }
    
    const result = await response.json();
    return result.data;
  },
  updateRow: async (tableId: string, rowId: string, data: Record<string, unknown>) => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    logger.debug('[tablesApi.updateRow] Sending:', { tableId, rowId, data });
    
    const response = await fetch(`/api/v3/tables/${tableId}/rows/${rowId}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify({ data })
    });
    
    
    if (!response.ok) {
      const errorResponse = await response.json().catch(() => ({ error: { message: 'Failed to update row' } }));
      logger.error('❌ [tablesApi.updateRow] Error:', errorResponse);
      const code = errorResponse.error?.code ?? errorResponse.code;
      const message =
        errorResponse.error?.message ?? errorResponse.message ?? `Request failed (${response.status})`;
      const details = errorResponse.error?.details ?? errorResponse.details ?? null;
      const err = new Error(message) as Error & { code?: string; details?: unknown; status?: number };
      if (code) err.code = code;
      if (details) err.details = details;
      err.status = response.status;
      throw err;
    }

    const result = await response.json();
    return result.data;
  },
  updateColumn: async (tableId: string, columnId: string, payload: Partial<ColumnModel>) => {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Transform camelCase → snake_case for backend
    const backendPayload: Record<string, unknown> = {};
    
    if (payload.displayName !== undefined) backendPayload.display_name = payload.displayName;
    if (payload.type !== undefined) backendPayload.column_type = payload.type;
    if (payload.isVisible !== undefined) backendPayload.is_visible = payload.isVisible;
    if (payload.isRequired !== undefined) backendPayload.is_required = payload.isRequired;
    if (payload.isReadonly !== undefined) backendPayload.is_readonly = payload.isReadonly;
    if (payload.width !== undefined) backendPayload.width = payload.width;
    if (payload.defaultValue !== undefined) backendPayload.default_value = payload.defaultValue;
    if (payload.formula !== undefined) backendPayload.formula = payload.formula;
    if (payload.config !== undefined) backendPayload.config = payload.config;
    if (payload.mapping !== undefined) backendPayload.mapping = payload.mapping;
    if (payload.orderIndex !== undefined) backendPayload.order_index = payload.orderIndex;
    
    
    const response = await fetch(`/api/v3/tables/${tableId}/columns/${columnId}`, {
      method: 'PATCH',
      headers,
      credentials: 'include',
      body: JSON.stringify(backendPayload)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to update column' }));
      throw new Error(error.message || `Request failed (${response.status})`);
    }
    
    const result = await response.json();
    // Transform backend response to ensure ID is string
    const data = result.data;
    return {
      id: String(data.id),
      tableId: String(data.table_id),
      name: data.name || data.column_name || '',
      displayName: data.display_name || data.name || data.column_name || '',
      type: (data.column_type || data.type) as ColumnModel['type'],
      config: typeof data.config === 'string' ? JSON.parse(data.config || '{}') : (data.config || {}),
      isRequired: Boolean(data.is_required),
      isReadonly: Boolean(data.is_readonly),
      orderIndex: data.order_index || 0,
      width: data.width ?? 160,
      isVisible: data.is_visible !== 0,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  },
  createColumn: async (tableId: string, payload: { name: string; displayName: string; type: string; config?: Record<string, unknown> }) => {
    // Use direct fetch for v2 endpoint since apiClient defaults to v3
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`/api/v3/tables/${tableId}/columns`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        name: payload.name,
        display_name: payload.displayName,
        column_type: payload.type,
        config: payload.config || {}
      })
    });
    
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    
    const result = await response.json();
    return result.data;
  },

  async updateTable(tableId: string, data: { name?: string; displayName?: string; icon?: string | null; color?: string | null; description?: string; access_control?: object; show_in_nav?: boolean; comment?: string; min_row_height?: number; max_row_height?: number; fixed_row_height?: number | null; is_public?: boolean }): Promise<TableModel> {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`/api/v3/tables/${tableId}`, {
      method: 'PATCH',
      headers,
      credentials: 'include',
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to update table' }));
      throw new Error(error.message || `Request failed (${response.status})`);
    }
    
    const result = await response.json();
    return transformTable(result.data || result);
  },

  async deleteTable(tableId: string): Promise<void> {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`/api/v3/tables/${tableId}`, {
      method: 'DELETE',
      headers,
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to delete table' }));
      throw new Error(error.message || `Request failed (${response.status})`);
    }
  },

  async deleteRow(tableId: string, rowId: string): Promise<void> {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    
    const response = await fetch(`/api/v3/tables/${tableId}/rows/${rowId}`, {
      method: 'DELETE',
      headers,
      credentials: 'include'
    });
    
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to delete row' }));
      logger.error('❌ [tablesApi.deleteRow] Error:', error);
      throw new Error(error.message || `Request failed (${response.status})`);
    }
    
  },

  async importRows(
    tableId: string, 
    data: {
      rows: Record<string, unknown>[];
      mode: 'add' | 'update';
      idMapping: { csvColumn: string; tableColumn: string } | null;
      addNewIds: boolean;
    }
  ): Promise<{ stats: { added: number; updated: number; skipped: number; errors: Array<{ row: number; error: string }> } }> {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`/api/v3/tables/${tableId}/rows/import`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to import rows' }));
      throw new Error(error.message || `Request failed (${response.status})`);
    }
    
    const result = await response.json();
    return result.data;
  },

  async deleteColumn(tableId: string, columnId: string): Promise<void> {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`/api/v3/tables/${tableId}/columns/${columnId}`, {
      method: 'DELETE',
      headers,
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to delete column' }));
      throw new Error(error.message || `Request failed (${response.status})`);
    }
  },

  /**
   * Generate vector embedding for a specific cell
   * @param tableId - Table ID
   * @param rowId - Row ID
   * @param columnId - Column ID (must be a vector type)
   * @param agentId - Optional agent ID for embedding generation
   * @returns Generated vector metadata
   */
  async generateVectorCell(
    tableId: string, 
    rowId: string | number, 
    columnId: string,
    agentId?: number
  ): Promise<{
    success: boolean;
    result?: {
      text: string;
      text_length: number;
      embedding_dimension: number;
      generated_at: string;
      model?: string;
      agent?: string;
    };
    error?: string;
  }> {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch('/api/v3/ai/vector/generate-cell', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        tableId,
        rowId: String(rowId),
        columnId,
        ...(agentId && { agentId })
      })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to generate vector' }));
      throw new Error(error.message || `Request failed (${response.status})`);
    }
    
    return await response.json();
  },

  /**
   * Batch update multiple rows at once
   * @param tableId - Table ID
   * @param updates - Array of { rowId, data } objects
   * @returns Batch update result
   */
  async batchUpdateRows(
    tableId: string,
    updates: Array<{ rowId: string | number; data: Record<string, unknown> }>
  ): Promise<{
    success: boolean;
    updated: number;
    errors?: Array<{ rowId: string; error: string }>;
  }> {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    logger.debug('[tablesApi.batchUpdateRows] Sending:', { tableId, updatesCount: updates.length });
    
    const response = await fetch(`/api/v3/tables/${tableId}/rows/batch-update`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ updates })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to batch update rows' }));
      logger.error('❌ [tablesApi.batchUpdateRows] Error:', error);
      throw new Error(error.message || error.error?.message || `Request failed (${response.status})`);
    }
    
    const result = await response.json();
    logger.debug('[tablesApi.batchUpdateRows] Result:', result);
    return result.data || result;
  },

  /**
   * Batch delete multiple rows at once
   * @param tableId - Table ID
   * @param rowIds - Array of row IDs to delete
   * @returns Batch delete result
   */
  async batchDeleteRows(
    tableId: string,
    rowIds: Array<string | number>
  ): Promise<{
    success: boolean;
    deleted: number;
  }> {
    const token = apiClient.getAccessToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    logger.debug('[tablesApi.batchDeleteRows] Sending:', { tableId, rowIdsCount: rowIds.length });
    
    const response = await fetch(`/api/v3/tables/${tableId}/rows/batch-delete`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ rowIds: rowIds.map(String) })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to batch delete rows' }));
      logger.error('❌ [tablesApi.batchDeleteRows] Error:', error);
      throw new Error(error.message || error.error?.message || `Request failed (${response.status})`);
    }
    
    const result = await response.json();
    logger.debug('[tablesApi.batchDeleteRows] Result:', result);
    return result.data || result;
  }
};
