import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { loadSchemaData } from '../store/loadSchemaLogic';
import { useSchemaEditorStore } from '../store/schemaEditorStore';
import { useApplyLayout } from '../components/useApplyLayout';
import { schemaApi } from '../api/schemaApi';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';
import type { SchemaResponse, TableNode, WidgetNode } from '../types/schema-editor.types';
import type { LayoutSettings } from '../components/modals/LayoutSettingsModal';
import type { ReactFlowInstance } from '@xyflow/react';

vi.mock('../api/schemaApi', () => ({ schemaApi: { getSpaceSchema: vi.fn(), saveLayout: vi.fn() } }));
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getRows: vi.fn() } }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));

const table: TableNode = {
  id: 'table-7', type: 'tableNode', position: { x: 20, y: 40 },
  data: { tableId: 7, name: 'tickets', displayName: 'Tickets', key: 'tickets', icon: '📋',
    projectId: 1, isExternal: false, columns: [] },
};
const widget: WidgetNode = {
  id: 'widget-9', type: 'widgetNode', position: { x: 20, y: -110 },
  data: { widgetId: 9, name: 'Board', displayName: 'Board', icon: '📋',
    widgetType: 'kanban', projectId: 1, mainTableId: 7 },
};
const schema: SchemaResponse = {
  tables: [{ id: 7, name: 'tickets', display_name: 'Tickets', project_id: 1, columns: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useSchemaEditorStore.getState().reset();
  vi.mocked(schemaApi.getSpaceSchema).mockResolvedValue(schema);
  vi.mocked(apiClient.request).mockResolvedValue({ success: true, data: [{
    id: 'project:1', type: 'project', name: 'Project', children: [
      { id: 'widget:9', type: 'widget', name: 'Board', data: { widget_type: 'preset', preset_name: 'kanban_board', main_table_id: '7' } },
      { id: 'widget:10', type: 'widget', name: 'Loose', data: { widget_type: 'custom' } },
    ],
  }] });
});
afterEach(() => vi.useRealTimers());

describe('mixed schema nodes', () => {
  it('preserves specialized widget config on both the tree and the table strip', async () => {
    const config = JSON.stringify({ procurement: { supplier_table_id: 6 } });
    vi.mocked(apiClient.request).mockResolvedValue({ success: true, data: [{
      id: 'widget:9', type: 'widget', name: 'Supplies', data: { preset_name: 'table_view', main_table_id: 7, config },
    }] });
    const result = await loadSchemaData(11);
    expect(result.navTree[0].widgetConfig).toBe(config);
    expect((result.nodes[0] as TableNode).data.widgets?.[0].widgetConfig).toBe(config);
  });

  it('glues a module to its main table and keeps only table-less modules as canvas cards', async () => {
    const result = await loadSchemaData(11);
    expect(result.nodes.map(n => n.type)).toEqual(['tableNode', 'widgetNode']);
    expect((result.nodes[0] as TableNode).data.widgets).toEqual([
      { widgetId: 9, name: 'Board', icon: '📋', presetName: 'kanban_board' },
    ]);
    expect(result.nodes[1]).toMatchObject({ id: 'widget-10', data: { mainTableId: undefined } });
    expect(result.edges).toEqual([]);
    expect(result.navTree[0].children[0]).toMatchObject({ presetName: 'kanban_board', mainTableId: 7 });
  });

  it('builds a root project when the navigation tree is empty', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ success: true, data: [] });
    const result = await loadSchemaData(11);
    expect(result.navTree[0]).toMatchObject({ id: 'project:1', parentId: null });
  });

  it('saves only table coordinates and excludes widgets from table visibility', async () => {
    useSchemaEditorStore.setState({ spaceId: 11, nodes: [table, widget] });
    await useSchemaEditorStore.getState().saveLayout();
    expect(schemaApi.saveLayout).toHaveBeenCalledWith(11, { nodes: [{ tableId: 7, x: 20, y: 40 }] });
    useSchemaEditorStore.getState().hideAllTables();
    expect(useSchemaEditorStore.getState().tableVisibility).toEqual({ 7: 'hidden' });
    useSchemaEditorStore.getState().showAllTables();
    expect(useSchemaEditorStore.getState().tableVisibility).toEqual({ 7: 'visible' });
  });

  it('refreshes rows only for tables while preserving widget nodes', async () => {
    useSchemaEditorStore.setState({ spaceId: 11 });
    vi.mocked(tablesApi.getRows).mockResolvedValue({ rows: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } });
    await useSchemaEditorStore.getState().refreshSchema();
    expect(tablesApi.getRows).toHaveBeenCalledTimes(1);
    expect(tablesApi.getRows).toHaveBeenCalledWith('7', 1, 10);
    const [refreshedTable, loose] = useSchemaEditorStore.getState().nodes;
    expect((refreshedTable as TableNode).data.widgets).toHaveLength(1);
    expect(loose.type).toBe('widgetNode');
  });
});

it('lays out unequal table heights without overlap when the grid is disabled', () => {
  vi.useFakeTimers();
  const tallTable: TableNode = { ...table, id: 'table-8', data: { ...table.data, tableId: 8,
    columns: Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `c${i}`,
      displayName: `Column ${i}`, type: 'text', isPrimaryKey: false, isForeignKey: false, isRequired: false })) } };
  const setNodes = vi.fn();
  const settings: LayoutSettings = { gridEnabled: false, gridCols: 5, gridRows: 5,
    gridDirection: 'horizontal', hierarchyEnabled: false, widgetsAbove: true, formsBelow: true,
    relationsEnabled: false, connectedLeft: true, isolatedRight: true,
    projectGroupEnabled: false, projectGap: 200, gapX: 100, gapY: 80 };
  const { result } = renderHook(() => useApplyLayout({ nodes: [tallTable, table, widget],
    storeEdges: [], setNodes, setLocalNodes: vi.fn(), saveLayout: vi.fn(),
    reactFlowInstance: { fitView: vi.fn() } as unknown as ReactFlowInstance }));
  act(() => result.current(settings));
  const placed = setNodes.mock.calls[0][0];
  expect(placed[0].position).toEqual({ x: 50, y: 50 });
  expect(placed[1].position.y).toBe(50 + 96 + 20 * 37 + 80);
  expect(placed.every((n: TableNode | WidgetNode) => Number.isFinite(n.position.y))).toBe(true);
});

it('keeps the grid column order from the API and maps row count and column flags', async () => {
  vi.mocked(schemaApi.getSpaceSchema).mockResolvedValue({ tables: [{
    id: 7, name: 'tickets', display_name: 'Tickets', project_id: 1, row_count: '1234',
    columns: [
      { id: 0, name: 'id', display_name: 'ID', type: 'number', is_required: true },
      { id: 12, name: 'b', display_name: 'B', type: 'text', is_required: false, order_index: 0, is_visible: 0, is_readonly: 1 },
      { id: 11, name: 'a', display_name: 'A', type: 'text', is_required: false, order_index: 1, is_visible: 1, is_locked: 1 },
    ],
  }, { id: 8, name: 'ext', display_name: 'Ext', project_id: 1, row_count: null, columns: [] }] });
  const { nodes } = await loadSchemaData(1);
  const [tickets, ext] = nodes as TableNode[];
  expect(tickets.data.rowCount).toBe(1234);
  expect(ext.data.rowCount).toBeUndefined();
  expect(tickets.data.columns.map((c) => c.name)).toEqual(['id', 'b', 'a']);
  expect(tickets.data.columns[1]).toMatchObject({ orderIndex: 0, isVisible: false, isReadonly: true, isLocked: false });
  expect(tickets.data.columns[2]).toMatchObject({ orderIndex: 1, isVisible: true, isReadonly: false, isLocked: true });
  expect(tickets.data.columns[0]).toMatchObject({ isPrimaryKey: true, isVisible: true, orderIndex: undefined });
});
