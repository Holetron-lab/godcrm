/**
 * Ticket utilities - shared helpers for ticket display
 *
 * Auto-discovery: if ticket_binding not configured in widget config,
 * searches for "Tickets" or "Tasks" table in the same project and auto-maps columns.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type {
  TicketBindingConfig,
  TicketRow,
  TicketDictItem,
  DocumentsWidgetConfig,
} from '../../../../types/documents.types';

export type { TicketRow, TicketDictItem };

// ============================
// COLUMN NAME ALIASES for auto-mapping
// ============================

const TITLE_ALIASES = ['title', 'what', 'name', 'subject'];
const DESCRIPTION_ALIASES = ['description', 'why', 'details', 'body'];
const TYPE_ALIASES = ['type', 'task_type', 'ticket_type', 'kind'];
const STATE_ALIASES = ['state', 'status', 'task_status'];
const PRIORITY_ALIASES = ['priority', 'urgency'];
const ACCEPTANCE_ALIASES = ['acceptance_criteria', 'criteria', 'ac'];
const TEST_STEPS_ALIASES = ['test_steps', 'testing', 'steps'];
const CREATED_ALIASES = ['created_date', 'created_at', 'date'];

function findColumn(
  columns: Array<{ name: string; column_type: string; config?: string }>,
  aliases: string[],
  preferTypes?: string[],
): string | undefined {
  for (const alias of aliases) {
    const col = columns.find(c => c.name === alias);
    if (col) {
      if (!preferTypes || preferTypes.includes(col.column_type)) return col.name;
      return col.name;
    }
  }
  return undefined;
}

function parseDictTableId(config: string | undefined | null): number | undefined {
  if (!config) return undefined;
  try {
    const parsed = typeof config === 'string' ? JSON.parse(config) : config;
    if (parsed && typeof parsed === 'object') {
      // DB may use either relatedTableId or relationTableId
      const p = parsed as Record<string, unknown>;
      const id = p.relatedTableId ?? p.relationTableId;
      if (typeof id === 'number') return id;
      if (typeof id === 'string') return parseInt(id, 10) || undefined;
    }
  } catch { /* ignore */ }
  return undefined;
}

// ============================
// useTicketConfig - auto-discovery hook
// ============================

interface TicketConfigResult {
  /** Resolved config (from widget or auto-discovered) */
  config: TicketBindingConfig | null;
  /** Whether still loading / discovering */
  isLoading: boolean;
  /** Human-readable source: 'configured' | 'auto:Tickets' | 'auto:Tasks' | null */
  source: string | null;
}

interface TableInfo {
  id: number;
  name: string;
  project_id: number;
}

interface ColumnInfo {
  /** API returns column_name AS name */
  name: string;
  display_name: string;
  /** API returns type AS column_type */
  column_type: string;
  config?: string;
}

export function useTicketConfig(widgetConfig: DocumentsWidgetConfig | undefined): TicketConfigResult {
  const projectId = widgetConfig?.project_id;

  // If ticket_binding is explicitly set, use it
  const explicitConfig = widgetConfig?.ticket_binding;

  // Fetch project tables for auto-discovery (only if no explicit config)
  const { data: projectTables, isLoading: isLoadingTables } = useQuery<TableInfo[]>({
    queryKey: ['ticket-discovery-tables', projectId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: TableInfo[] }>(`/projects/${projectId}/tables`);
      return response.data || [];
    },
    enabled: !!projectId && !explicitConfig,
    staleTime: 5 * 60_000,
  });

  // Find candidate table
  const candidateTable = useMemo(() => {
    if (explicitConfig) return null;
    if (!projectTables) return null;
    // Prefer "Tickets", then "Tasks"
    return projectTables.find(t => t.name === 'Tickets')
      || projectTables.find(t => t.name === 'Tasks')
      || projectTables.find(t => /ticket/i.test(t.name))
      || projectTables.find(t => /task/i.test(t.name))
      || null;
  }, [projectTables, explicitConfig]);

  // Fetch columns for candidate table
  const { data: tableColumns, isLoading: isLoadingCols } = useQuery<ColumnInfo[]>({
    queryKey: ['ticket-discovery-columns', candidateTable?.id],
    queryFn: async () => {
      const response = await apiClient.get<{ data: ColumnInfo[] }>(`/tables/${candidateTable!.id}/columns`);
      return response.data || [];
    },
    enabled: !!candidateTable,
    staleTime: 5 * 60_000,
  });

  // Build auto-discovered config
  const autoConfig = useMemo((): TicketBindingConfig | null => {
    if (!candidateTable || !tableColumns) return null;

    const titleCol = findColumn(tableColumns, TITLE_ALIASES);
    if (!titleCol) return null; // Must have a title column

    // Find dictionary table IDs from relation column configs
    const typeCol = findColumn(tableColumns, TYPE_ALIASES);
    const stateCol = findColumn(tableColumns, STATE_ALIASES);
    const priorityCol = findColumn(tableColumns, PRIORITY_ALIASES);

    const typeColInfo = typeCol ? tableColumns.find(c => c.name === typeCol) : undefined;
    const stateColInfo = stateCol ? tableColumns.find(c => c.name === stateCol) : undefined;
    const priorityColInfo = priorityCol ? tableColumns.find(c => c.name === priorityCol) : undefined;

    return {
      table_id: candidateTable.id,
      columns: {
        title: titleCol,
        description: findColumn(tableColumns, DESCRIPTION_ALIASES),
        type: typeCol,
        state: stateCol,
        priority: priorityCol,
        acceptance_criteria: findColumn(tableColumns, ACCEPTANCE_ALIASES),
        test_steps: findColumn(tableColumns, TEST_STEPS_ALIASES),
        created_date: findColumn(tableColumns, CREATED_ALIASES),
      },
      dictionaries: {
        types_table_id: parseDictTableId(typeColInfo?.config),
        states_table_id: parseDictTableId(stateColInfo?.config),
        priorities_table_id: parseDictTableId(priorityColInfo?.config),
      },
    };
  }, [candidateTable, tableColumns]);

  if (explicitConfig) {
    return { config: explicitConfig, isLoading: false, source: 'configured' };
  }

  if (isLoadingTables || isLoadingCols) {
    return { config: null, isLoading: true, source: null };
  }

  if (autoConfig && candidateTable) {
    return { config: autoConfig, isLoading: false, source: `auto:${candidateTable.name}` };
  }

  return { config: null, isLoading: false, source: null };
}

// ============================
// useTicketDictionaries - load type/state/priority names from DB
// ============================

interface TicketDictionaries {
  types: TicketDictItem[];
  states: TicketDictItem[];
  priorities: TicketDictItem[];
  isLoading: boolean;
}

interface DictResponse {
  rows?: TicketDictItem[];
}

export function useTicketDictionaries(config: TicketBindingConfig | null): TicketDictionaries {
  const typesTableId = config?.dictionaries?.types_table_id;
  const statesTableId = config?.dictionaries?.states_table_id;
  const prioritiesTableId = config?.dictionaries?.priorities_table_id;

  const { data: typesData, isLoading: l1 } = useQuery<DictResponse>({
    queryKey: ['ticket-dict', 'types', typesTableId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: DictResponse }>(`/tables/${typesTableId}/rows`);
      return response.data;
    },
    enabled: !!typesTableId,
    staleTime: 5 * 60_000,
  });

  const { data: statesData, isLoading: l2 } = useQuery<DictResponse>({
    queryKey: ['ticket-dict', 'states', statesTableId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: DictResponse }>(`/tables/${statesTableId}/rows`);
      return response.data;
    },
    enabled: !!statesTableId,
    staleTime: 5 * 60_000,
  });

  const { data: prioritiesData, isLoading: l3 } = useQuery<DictResponse>({
    queryKey: ['ticket-dict', 'priorities', prioritiesTableId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: DictResponse }>(`/tables/${prioritiesTableId}/rows`);
      return response.data;
    },
    enabled: !!prioritiesTableId,
    staleTime: 5 * 60_000,
  });

  // Normalize dict rows: flatten .data into top-level so .name, .icon etc. are accessible
  const normalizeDict = (rows: TicketDictItem[]): TicketDictItem[] =>
    rows.map(r => {
      const nested = (r as Record<string, unknown>).data;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return { ...r, ...(nested as Record<string, unknown>) };
      }
      return r;
    });

  return {
    types: normalizeDict(typesData?.rows || []),
    states: normalizeDict(statesData?.rows || []),
    priorities: normalizeDict(prioritiesData?.rows || []),
    isLoading: l1 || l2 || l3,
  };
}

// ============================
// DISPLAY HELPERS (work with dynamic dictionaries)
// ============================

const TYPE_ICONS: Record<string, string> = {
  bug: '\u{1F41B}',
  story: '\u{1F4D6}',
  task: '\u2705',
  spike: '\u{1F52C}',
  feature: '\u2728',
};

const STATE_COLORS: Record<string, string> = {
  backlog: 'bg-gray-500/20 text-gray-400',
  'in progress': 'bg-blue-500/20 text-blue-400',
  review: 'bg-purple-500/20 text-purple-400',
  done: 'bg-green-500/20 text-green-400',
  'on hold': 'bg-yellow-500/20 text-yellow-400',
  todo: 'bg-gray-500/20 text-gray-400',
  open: 'bg-blue-500/20 text-blue-400',
  closed: 'bg-green-500/20 text-green-400',
};

export function getTypeIcon(typeId: number | string | undefined, types: TicketDictItem[]): string {
  if (!typeId) return '\u{1F4CB}';
  const dictItem = types.find(t => t.id === Number(typeId));
  const name = (dictItem?.name || '').toLowerCase();
  return dictItem?.icon || TYPE_ICONS[name] || '\u{1F4CB}';
}

export function getTypeName(typeId: number | string | undefined, types: TicketDictItem[]): string {
  if (!typeId) return '';
  const dictItem = types.find(t => t.id === Number(typeId));
  return (dictItem?.name as string) || '';
}

export function getStateName(stateId: number | string | undefined, states: TicketDictItem[]): string {
  if (!stateId) return 'Не выбрано';
  const dictItem = states.find(s => s.id === Number(stateId));
  return (dictItem?.name as string) || 'Не выбрано';
}

export function getStateColor(stateId: number | string | undefined, states: TicketDictItem[]): string {
  if (!stateId) return 'bg-gray-500/20 text-gray-400';
  const dictItem = states.find(s => s.id === Number(stateId));
  const name = (dictItem?.name || '').toLowerCase();
  return STATE_COLORS[name] || 'bg-gray-500/20 text-gray-400';
}

const PRIORITY_COLORS: Record<string, string> = {
  'критический': 'text-red-500',
  'critical': 'text-red-500',
  'высокий': 'text-orange-400',
  'high': 'text-orange-400',
  'средний': 'text-yellow-400',
  'medium': 'text-yellow-400',
  'низкий': 'text-green-400',
  'low': 'text-green-400',
};

export function getPriorityName(priorityId: number | string | undefined, priorities: TicketDictItem[]): string {
  if (!priorityId) return 'Не выбрано';
  const dictItem = priorities.find(p => p.id === Number(priorityId));
  return (dictItem?.name as string) || 'Не выбрано';
}

export function getPriorityColor(priorityId: number | string | undefined, priorities: TicketDictItem[]): string {
  if (!priorityId) return 'text-gray-400';
  const dictItem = priorities.find(p => p.id === Number(priorityId));
  const name = (dictItem?.name || '').toLowerCase();
  return PRIORITY_COLORS[name] || 'text-gray-400';
}

/** Resolve row data: rows from API may have fields nested in .data */
function resolveRowData(row: TicketRow): Record<string, unknown> {
  const nested = (row as Record<string, unknown>).data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...row, ...(nested as Record<string, unknown>) };
  }
  return row as Record<string, unknown>;
}

/** Get ticket title using column mapping */
export function getTicketTitle(row: TicketRow, config: TicketBindingConfig): string {
  const col = config.columns.title;
  const data = resolveRowData(row);
  return (data[col] as string) || '';
}

/** Get ticket field using column mapping */
export function getTicketField(row: TicketRow, config: TicketBindingConfig, field: keyof TicketBindingConfig['columns']): unknown {
  const col = config.columns[field];
  if (!col) return undefined;
  const data = resolveRowData(row);
  return data[col];
}

// ============================
// Auto-mapping utility for settings UI
// ============================

export function autoMapColumns(
  columns: Array<{ name: string; column_type: string; config?: string }>,
): TicketBindingConfig['columns'] {
  return {
    title: findColumn(columns, TITLE_ALIASES) || '',
    description: findColumn(columns, DESCRIPTION_ALIASES),
    type: findColumn(columns, TYPE_ALIASES),
    state: findColumn(columns, STATE_ALIASES),
    priority: findColumn(columns, PRIORITY_ALIASES),
    acceptance_criteria: findColumn(columns, ACCEPTANCE_ALIASES),
    test_steps: findColumn(columns, TEST_STEPS_ALIASES),
    created_date: findColumn(columns, CREATED_ALIASES),
  };
}

export function autoMapDictionaries(
  columns: Array<{ name: string; column_type: string; config?: string }>,
): TicketBindingConfig['dictionaries'] {
  const typeCol = findColumn(columns, TYPE_ALIASES);
  const stateCol = findColumn(columns, STATE_ALIASES);
  const priorityCol = findColumn(columns, PRIORITY_ALIASES);

  const getConfig = (colName: string | undefined) => {
    if (!colName) return undefined;
    const col = columns.find(c => c.name === colName);
    return parseDictTableId(col?.config);
  };

  return {
    types_table_id: getConfig(typeCol),
    states_table_id: getConfig(stateCol),
    priorities_table_id: getConfig(priorityCol),
  };
}
