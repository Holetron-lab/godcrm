import { describe, expect, it } from 'vitest';
import { COLUMN_REF_PATHS, remapBlueprintColumnRefs } from '../configRefs.js';

const plannedTables = (action = 'connect') => [{
  key: 'items',
  action,
  columns: [
    { module_column: 'status', target: 'state' },
    { module_column: 'amount', target: 'total' },
    { module_column: 'title', target: '__new' },
    { module_column: 'notes', target: null },
  ],
}];

const blueprint = () => ({
  schema: 2,
  apps: [
    {
      key: 'metric', preset: 'number_widget', table: 'items',
      config: {
        table_id: { $table: 'items' }, column: 'amount', filter: { column: 'status' },
        filters: [{ column: 'status' }], sort_by: 'title', group_by: 'status', sort: { column: 'amount' },
      },
    },
    {
      key: 'board', preset: 'kanban_board', table: 'items',
      config: {
        table_id: { $table: 'items' }, group_by_column: 'status', card_title_column: 'title',
        sort_by: 'amount', kanban: { statusColumn: 'status', titleColumn: 'title', cardColumns: ['title', 'amount'] },
      },
    },
    {
      key: 'graph', preset: 'chart_widget', table: 'items',
      config: { table_id: { $table: 'items' }, x_column: 'status', y_column: 'amount', group_by: 'status' },
    },
  ],
  dashboards: [{
    key: 'main',
    tiles: [
      { key: 'metric_tile', preset: 'number_widget', table: 'items', config: { filter: { column: 'status' } } },
      { key: 'board_link', preset: 'quick_links', app: 'board', config: { table_id: { $table: 'items' }, app_widget_id: { $app: 'board' } } },
    ],
  }],
  agents: [{
    key: 'helper', table: 'items', columnRefPaths: ['filter.column', 'columns[]'],
    config: { filter: { column: 'status' }, columns: ['title', 'amount'] },
  }],
  automations: [{
    key: 'on_status', table: 'items', columnRefPaths: ['filter.column', 'sort_by'],
    config: { filter: { column: 'status' }, sort_by: 'amount' },
  }],
});

describe('ADR-207 W2.2 column references', () => {
  it('declares the required preset paths and remaps apps, tiles, agents and automations without mutating input', () => {
    const raw = blueprint();
    const frozen = structuredClone(raw);

    const result = remapBlueprintColumnRefs(raw, plannedTables());

    expect(COLUMN_REF_PATHS).toHaveProperty('number_widget');
    expect(COLUMN_REF_PATHS).toHaveProperty('kanban_board');
    expect(COLUMN_REF_PATHS).toHaveProperty('chart_widget');
    expect(COLUMN_REF_PATHS).toHaveProperty('quick_links');
    expect(result.conflicts).toEqual([]);
    expect(result.blueprint.apps[0].config).toMatchObject({
      table_id: { $table: 'items' }, column: 'total', filter: { column: 'state' },
      filters: [{ column: 'state' }], sort_by: 'title', group_by: 'state', sort: { column: 'total' },
    });
    expect(result.blueprint.apps[1].config).toMatchObject({
      group_by_column: 'state', card_title_column: 'title', sort_by: 'total',
      kanban: { statusColumn: 'state', titleColumn: 'title', cardColumns: ['title', 'total'] },
    });
    expect(result.blueprint.apps[2].config).toMatchObject({ x_column: 'state', y_column: 'total', group_by: 'state' });
    expect(result.blueprint.dashboards[0].tiles[0].config.filter.column).toBe('state');
    expect(result.blueprint.dashboards[0].tiles[1].config).toEqual({ table_id: { $table: 'items' }, app_widget_id: { $app: 'board' } });
    expect(result.blueprint.agents[0].config).toEqual({ filter: { column: 'state' }, columns: ['title', 'total'] });
    expect(result.blueprint.automations[0].config).toEqual({ filter: { column: 'state' }, sort_by: 'total' });
    expect(raw).toEqual(frozen);
  });

  it('reports the exact consumer path when a referenced column is skipped', () => {
    const raw = blueprint();
    raw.apps[0].config.filter.column = 'notes';

    const result = remapBlueprintColumnRefs(raw, plannedTables());

    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'COLUMN_REF_UNMAPPED', table: 'items', column: 'notes',
        referenced_by: ['apps.metric.config.filter.column'], blocking: true,
      }),
    ]));
  });

  it('rejects an undeclared preset only for a connected table', () => {
    const raw = blueprint();
    raw.apps = [{ key: 'calendar', preset: 'calendar_widget', table: 'items', config: {} }];

    const connected = remapBlueprintColumnRefs(raw, plannedTables());
    const created = remapBlueprintColumnRefs(raw, plannedTables('create'));

    expect(connected.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'PRESET_COLUMN_MAPPING_UNSUPPORTED', preset: 'calendar_widget', referenced_by: ['apps.calendar'] }),
    ]));
    expect(created.conflicts).toEqual([]);
  });

  it('keeps schema 1 widget paths and table sentinels intact', () => {
    const raw = {
      widgets: [{
        key: 'legacy', preset_name: 'table_view',
        config: { table_id: { $table: 'items' }, sort_by: 'amount', filters: [{ column: 'status' }], visible_columns: ['title', 'amount'] },
      }],
    };

    const result = remapBlueprintColumnRefs(raw, plannedTables());

    expect(result.conflicts).toEqual([]);
    expect(result.blueprint.widgets[0].config).toEqual({
      table_id: { $table: 'items' }, sort_by: 'total', filters: [{ column: 'state' }], visible_columns: ['title', 'total'],
    });
  });
});
