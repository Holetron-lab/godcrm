import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { usePublicView } from '@/features/public/PublicViewContext';
import { publicApi, type PublicWidget, type PublicTableColumn } from '@/features/public/publicApi';
import type { Widget, PresetWidgetName } from '../types/widget.types';
import type { ColumnModel } from '@/features/tables/types/table.types';

// ADR-0060 §"ТОТ ЖЕ" — reshape PublicWidget into internal Widget so downstream
// preset components consume the same prop shape on both sides of the gate.
function publicWidgetToWidget(pw: PublicWidget): Widget {
  return {
    id: pw.id,
    dashboard_id: 0,
    source_widget_id: null,
    widget_type: 'preset',
    preset_name: pw.type as PresetWidgetName,
    code: null,
    code_version: 0,
    title: pw.name,
    description: null,
    icon: pw.icon ?? '',
    config: {
      ...(pw.view_config || {}),
      ...(pw.table_id != null ? { table_id: pw.table_id } : {}),
    },
    position: {
      x: pw.position.x,
      y: pw.position.y,
      w: pw.position.w,
      h: pw.position.h,
      minW: pw.position.minW,
      minH: pw.position.minH,
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
  } as unknown as Widget;
}

// PublicTableColumn → ColumnModel shape used by tableColumns consumers.
function publicColumnsToColumnModels(cols: PublicTableColumn[]): ColumnModel[] {
  return cols.map((c, idx) => ({
    id: String(c.id),
    name: c.name,
    displayName: c.display_name || c.name,
    type: c.type,
    config: (c.settings ?? {}) as Record<string, unknown>,
    isVisible: true,
    orderIndex: typeof c.position === 'number' ? c.position : idx,
  })) as unknown as ColumnModel[];
}

// Row data from API
export interface TicketRowData {
  id?: string | number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

// Backwards compatibility alias
export type KanbanRowData = TicketRowData;

// Column option for grouping columns (kanban lanes, timeline groups, etc.)
export interface ColumnOption {
  value: string;
  label: string;
  color?: string;
  order?: number;
}

// Backwards compatibility alias
export type KanbanColumnOption = ColumnOption;

// Column info for widgets
export interface ColumnInfo {
  name: string;
  displayName: string;
  type: string;
  config: unknown;
  isVisible: boolean;
  orderIndex: number;
  width?: number;
}

// Backwards compatibility alias
export type KanbanColumnInfo = ColumnInfo;

// Relation data map type
export type RelationDataMap = Map<string, Map<string, { label: string; color?: string; order?: number }>>;

// Return type for the hook
export interface UseTicketDataResult {
  // Loading states
  isLoading: boolean;
  isLoadingWidget: boolean;
  isLoadingData: boolean;
  isLoadingColumns: boolean;
  
  // Core data
  widget: Widget | undefined;
  widgetData: TicketRowData[];
  tableColumns: ColumnModel[];
  columnsInfo: ColumnInfo[];
  
  // Grouping column data (for kanban, timeline, etc.)
  groupColumn: ColumnModel | null;
  groupColumnOptions: ColumnOption[];
  relationData: RelationDataMap | undefined;
  relationTableId: number | null;
  
  // Backwards compatibility aliases
  kanbanGroupColumn: ColumnModel | null;
  kanbanColumnOptions: ColumnOption[];
  
  // For AddColumnOptionModal
  relationTableRows: Array<{ id: string; data: Record<string, unknown> }> | undefined;
  
  // Table ID for convenience
  tableId: number | null;

  // Table config (row height settings etc.)
  tableConfig: { min_row_height?: number; max_row_height?: number; fixed_row_height?: number | null } | null;

  // Refetch functions
  refetchData: () => Promise<unknown>;
}

// Backwards compatibility alias
export type UseKanbanDataResult = UseTicketDataResult;

interface UseTicketDataOptions {
  widgetId: number;
  widget?: Widget; // Optional: pass widget if already loaded
  tableId?: number; // Optional: pass table ID directly (for non-widget usage)
  enabled?: boolean;
}

/**
 * Unified hook for loading ticket/table data.
 * Works for Kanban, Timeline, Documents, Calendar, AI Chat and other widgets.
 * 
 * @example
 * // In DashboardWidgetCard
 * const { groupColumnOptions, relationData, columnsInfo } = useTicketData({ widgetId });
 * 
 * // In WidgetViewPage
 * const { widget, widgetData, groupColumnOptions } = useTicketData({ widgetId });
 * 
 * // In AIChatPanel (with table ID directly)
 * const { widgetData, columnsInfo, relationData } = useTicketData({ widgetId: 0, tableId: 1708 });
 */
export function useTicketData({ widgetId, widget: externalWidget, tableId: externalTableId, enabled = true }: UseTicketDataOptions): UseTicketDataResult {
  // ADR-0060 §"ТОТ ЖЕ" — when rendered inside a PublicViewProvider, every
  // widget/table fetch is re-routed through `publicApi` so anonymous visitors
  // can render the same React tree the authed grid does.
  const { publicSlug } = usePublicView();

  // Fetch widget info (if not provided externally and widgetId is valid)
  const { data: fetchedWidget, isLoading: isLoadingWidget } = useQuery({
    queryKey: publicSlug
      ? (['widget', widgetId, 'public', publicSlug] as const)
      : (['widget', widgetId] as const),
    queryFn: async () => {
      if (publicSlug) {
        const r = await publicApi.getWidget(publicSlug, widgetId);
        return publicWidgetToWidget(r.data.widget);
      }
      const response = await apiClient.request<{ data: Widget }>(`/widgets/${widgetId}`);
      return response.data;
    },
    enabled: enabled && widgetId > 0 && !externalWidget
  });

  // Use external widget if provided, otherwise use fetched widget
  const widget = externalWidget || fetchedWidget;

  // Determine table ID: from external prop, widget config, or null
  const tableId = externalTableId || (widget?.config?.table_id ? Number(widget.config.table_id) : null);

  // Fetch table data (rows)
  const { data: widgetData = [], isLoading: isLoadingData, refetch: refetchData } = useQuery({
    queryKey: publicSlug
      ? (['ticket-data', widgetId || 'direct', tableId, 'public', publicSlug] as const)
      : (['ticket-data', widgetId || 'direct', tableId] as const),
    queryFn: async () => {
      if (!tableId) return [];
      if (publicSlug) {
        const r = await publicApi.getTableRows(publicSlug, tableId, { limit: 500 });
        return (r.data.rows || []) as unknown as TicketRowData[];
      }
      const response = await apiClient.request<{ data: { rows: TicketRowData[] } }>(
        `/tables/${tableId}/rows?limit=500&mode=raw`
      );
      return response.data.rows || [];
    },
    enabled: enabled && !!tableId
  });

  // Fetch table columns (+ table-config piggy-backed in public mode since
  // `publicApi.getTable` returns both in one call).
  const { data: publicTable } = useQuery({
    queryKey: ['public-table', publicSlug, tableId] as const,
    queryFn: async () => {
      if (!publicSlug || !tableId) return null;
      const r = await publicApi.getTable(publicSlug, tableId);
      return r.data;
    },
    enabled: enabled && !!publicSlug && !!tableId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: tableColumnsRaw = [], isLoading: isLoadingColumns } = useQuery({
    queryKey: publicSlug
      ? (['table-columns', tableId, 'public', publicSlug] as const)
      : (['table-columns', tableId] as const),
    queryFn: async () => {
      if (!tableId) return [];
      if (publicSlug) {
        return publicTable ? publicColumnsToColumnModels(publicTable.columns) : [];
      }
      const result = await tablesApi.getColumns(String(tableId));
      if (Array.isArray(result)) return result;
      const columns = (result as { columns?: unknown[] })?.columns;
      return Array.isArray(columns) ? columns : [];
    },
    enabled: enabled && !!tableId && (!publicSlug || !!publicTable),
  });

  const tableColumns = Array.isArray(tableColumnsRaw) ? tableColumnsRaw : [];

  // Fetch table info (for config: row height, etc.)
  const { data: tableInfo } = useQuery({
    queryKey: publicSlug
      ? (['table-info', tableId, 'public', publicSlug] as const)
      : (['table-info', tableId] as const),
    queryFn: async () => {
      if (!tableId) return null;
      if (publicSlug) {
        // PublicTableMeta doesn't expose row-height config; default to empty.
        return {};
      }
      const response = await apiClient.request<{ data: { config?: string | Record<string, unknown> } }>(`/tables/${tableId}`);
      const raw = response.data?.config;
      if (!raw) return {};
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return {}; }
      }
      return raw;
    },
    enabled: enabled && !!tableId,
    staleTime: 5 * 60 * 1000, // Cache table config for 5 minutes
  });
  const tableConfig = tableInfo ? {
    min_row_height: tableInfo.min_row_height as number | undefined,
    max_row_height: tableInfo.max_row_height as number | undefined,
    fixed_row_height: tableInfo.fixed_row_height as number | null | undefined,
  } : null;

  // Find all columns with relation config and collect unique table IDs
  const relationTableConfigs = useMemo(() => {
    const configs = new Map<number, { valueColumn?: string; labelColumn?: string }>();
    tableColumns.forEach((col: ColumnModel) => {
      const config = typeof col.config === 'string' ? JSON.parse(col.config) : col.config;
      
      // Log relation detection for debugging
      if (col.type === 'relation') {
        logger.debug('[useTicketData] Found relation column:', col.name, 'config:', config);
      }
      
      // Check for relation config in multiple formats
      if (config?.relation?.enabled && config?.relation?.tableId) {
        const relTableId = Number(config.relation.tableId);
        configs.set(relTableId, {
          valueColumn: config.relation.valueColumn || 'id',
          labelColumn: config.relation.labelColumn || 'name'
        });
      } else if (config?.relatedTableId) {
        const relTableId = Number(config.relatedTableId);
        configs.set(relTableId, {
          valueColumn: config.relation?.valueColumn || 'id',
          labelColumn: config.relation?.labelColumn || config.displayColumn || 'name'
        });
      } else if (col.type === 'relation' && config?.tableId) {
        // Alternative format: config.tableId directly
        const relTableId = Number(config.tableId);
        configs.set(relTableId, {
          valueColumn: config.valueColumn || 'id',
          labelColumn: config.labelColumn || config.displayColumn || 'name'
        });
      }
    });
    logger.debug('[useTicketData] Found relation tables:', Array.from(configs.keys()));
    return configs;
  }, [tableColumns]);
  
  const relationTableIds = useMemo(() => Array.from(relationTableConfigs.keys()), [relationTableConfigs]);
  
  // Load data from all relation tables
  const { data: allRelationData } = useQuery({
    queryKey: publicSlug
      ? (['ticket-relation-data', tableId || widgetId, 'public', publicSlug, ...relationTableIds] as const)
      : (['ticket-relation-data', tableId || widgetId, ...relationTableIds] as const),
    queryFn: async () => {
      const result = new Map<string, Map<string, { label: string; color?: string; order?: number }>>();

      await Promise.all(relationTableIds.map(async (relTableId) => {
        try {
          let rows: Array<{ id: string; data: Record<string, unknown> }> = [];
          if (publicSlug) {
            const r = await publicApi.getTableRows(publicSlug, relTableId, { limit: 500 });
            rows = (r.data.rows || []) as unknown as Array<{ id: string; data: Record<string, unknown> }>;
          } else {
            const response = await apiClient.request<{ data: { rows: Array<{ id: string; data: Record<string, unknown> }> } }>(
              `/tables/${relTableId}/rows?limit=5000&mode=raw`
            );
            rows = response.data?.rows || [];
          }
          const tableMap = new Map<string, { label: string; color?: string; order?: number }>();

          const tableConfig = relationTableConfigs.get(relTableId);
          const valueColumn = tableConfig?.valueColumn || 'id';
          const labelColumn = tableConfig?.labelColumn || 'name';

          rows.forEach((row: { id: string; data: Record<string, unknown> }) => {
            const label = String(row.data[labelColumn] || row.data.name || row.data.title || row.id);
            const color = row.data.color ? String(row.data.color) : undefined;
            const order = typeof row.data.order === 'number' ? row.data.order : undefined;

            tableMap.set(String(row.id), { label, color, order });

            if (valueColumn !== 'id' && row.data[valueColumn] !== undefined) {
              tableMap.set(String(row.data[valueColumn]), { label, color, order });
            }
          });
          
          // Use string key for consistency
          result.set(String(relTableId), tableMap);
        } catch (error) {
          logger.error(`Failed to load relation table ${relTableId}:`, error);
        }
      }));
      
      logger.debug('[useTicketData] Loaded relation data for', result.size, 'tables');
      return result;
    },
    enabled: enabled && relationTableIds.length > 0,
    staleTime: 60000 // Cache for 1 minute
  });
  
  // Get grouping column (for kanban lanes, timeline groups, etc.)
  const groupColumn = useMemo(() => {
    if (!widget) return null;
    // Support multiple widget types
    const groupField = widget.config?.group_by_column ||
                       widget.config?.statusColumn ||
                       widget.config?.groupColumn ||
                       'status';
    if (!groupField) return null;
    const found = tableColumns.find((col: ColumnModel) => col.name === groupField);
    if (found) return found;

    // Fallback: if default 'status' doesn't exist, try 'state' (common alternative)
    if (groupField === 'status') {
      const stateCol = tableColumns.find((col: ColumnModel) => col.name === 'state');
      if (stateCol) return stateCol;
    }

    // Last resort: first select/relation column
    const firstSelectCol = tableColumns.find((col: ColumnModel) => {
      const config = typeof col.config === 'string' ? JSON.parse(col.config) : col.config;
      return col.type === 'select' || config?.relation?.enabled || config?.relatedTableId;
    });
    return firstSelectCol || null;
  }, [widget, tableColumns]);
  
  // Get relation table ID for the group column (for loading options and adding new columns)
  const groupColumnRelationTableId = useMemo(() => {
    if (!groupColumn?.config) return null;
    const config = typeof groupColumn.config === 'string' 
      ? JSON.parse(groupColumn.config) 
      : groupColumn.config;
    if (!config?.relation?.enabled) return null;
    return config?.relation?.tableId || config?.relatedTableId || null;
  }, [groupColumn]);
  
  // Load rows from relation table (for AddColumnOptionModal)
  const { data: relationTableRows } = useQuery({
    queryKey: publicSlug
      ? (['relation-table-rows', groupColumnRelationTableId, 'public', publicSlug] as const)
      : (['relation-table-rows', groupColumnRelationTableId] as const),
    queryFn: async () => {
      if (publicSlug) {
        const r = await publicApi.getTableRows(publicSlug, groupColumnRelationTableId, { limit: 500 });
        return (r.data.rows || []) as unknown as Array<{ id: string; data: Record<string, unknown> }>;
      }
      const response = await apiClient.request<{ data: { rows: Array<{ id: string; data: Record<string, unknown> }> } }>(
        `/tables/${groupColumnRelationTableId}/rows?limit=5000&mode=raw`
      );
      return response.data?.rows || [];
    },
    enabled: enabled && !!groupColumnRelationTableId
  });
  
  // Build group column options from relation data or column config
  const groupColumnOptions = useMemo((): ColumnOption[] => {
    // Priority 1: Explicitly configured options in widget config
    if (widget?.config?.category_options?.length > 0) {
      return widget.config.category_options;
    }
    
    // Priority 2: Build from relation data
    const groupColConfig = groupColumn?.config;
    const groupRelationTableId = groupColConfig?.relation?.tableId || 
                                  groupColConfig?.relation?.table_id || 
                                  groupColConfig?.relatedTableId;
    
    if (groupRelationTableId && allRelationData) {
      const relationMap = allRelationData.get(String(groupRelationTableId));
      if (relationMap && relationMap.size > 0) {
        return Array.from(relationMap.entries())
          .map(([value, info]) => ({
            value,
            label: info.label,
            color: info.color,
            order: info.order
          }))
          .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      }
    }
    
    // Priority 3: Use column's own options (for regular select columns)
    // Options can be either strings (legacy) or {value,label,color} objects.
    if (groupColumn?.config?.options?.length > 0) {
      return groupColumn.config.options.map((opt: string | { value: string; label?: string; color?: string }) => {
        if (typeof opt === 'string') {
          return { value: opt, label: opt };
        }
        return {
          value: opt.value,
          label: opt.label || opt.value,
          color: opt.color
        };
      });
    }

    return [];
  }, [widget, groupColumn, allRelationData]);
  
  // Build columnsInfo for widgets
  const columnsInfo = useMemo((): ColumnInfo[] => {
    return tableColumns
      .map((col: ColumnModel) => ({
        name: col.name,
        displayName: col.displayName || col.name,
        type: col.type,
        config: col.config,
        isVisible: col.isVisible !== false,
        orderIndex: col.orderIndex ?? 999,
        width: col.width
      }))
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [tableColumns]);
  
  return {
    // Loading states
    isLoading: isLoadingWidget || isLoadingData || isLoadingColumns,
    isLoadingWidget,
    isLoadingData,
    isLoadingColumns,
    
    // Core data
    widget,
    widgetData,
    tableColumns,
    columnsInfo,
    
    // Grouping data (generic names)
    groupColumn,
    groupColumnOptions,
    relationData: allRelationData,
    relationTableId: groupColumnRelationTableId,
    
    // Backwards compatibility aliases (for existing code)
    kanbanGroupColumn: groupColumn,
    kanbanColumnOptions: groupColumnOptions,
    
    // Table ID for convenience
    tableId,

    // Table config (row height settings)
    tableConfig,

    // For AddColumnOptionModal
    relationTableRows,
    
    // Refetch functions
    refetchData
  };
}

// Backwards compatibility alias
export const useKanbanData = useTicketData;