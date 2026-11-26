import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateBlueprint } from '../../ModuleInstaller.js';
import { getDefaultModuleBlueprints } from '../defaultBlueprints.js';
import { remapBlueprintColumnRefs } from '../configRefs.js';

const corePresets = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../shared/widget-presets.json'), 'utf8'));

function connectedTables(blueprint, target) {
  return [...blueprint.tables, ...blueprint.requires.tables].map((table) => ({
    key: table.key,
    action: 'connect',
    columns: table.columns.map((column, index) => ({
      module_column: column.column_name,
      target: target(column, index),
    })),
  }));
}

describe('ADR-207 W2.4 default blueprint inventory', () => {
  it('converts every core preset and both named packs exactly once', () => {
    const blueprints = getDefaultModuleBlueprints();
    const presetBlueprints = blueprints.filter((blueprint) => blueprint.key.startsWith('preset_'));

    expect(presetBlueprints.map((blueprint) => blueprint.key)).toEqual(
      Object.keys(corePresets).map((key) => `preset_${key}`),
    );
    expect(blueprints.filter((blueprint) => !blueprint.key.startsWith('preset_')).map((blueprint) => blueprint.key)).toEqual([
      'kanban_pack',
      'ai_agents_pack',
    ]);
    expect(new Set(blueprints.map((blueprint) => blueprint.key)).size).toBe(28);
  });

  it.each(getDefaultModuleBlueprints())('$key is valid schema 2 with explicit column references', (blueprint) => {
    const validated = validateBlueprint(blueprint);

    expect(validated.schema).toBe(2);
    expect(validated.projects.length).toBeGreaterThan(0);
    for (const app of validated.apps) {
      expect(Array.isArray(app.columnRefPaths)).toBe(true);
    }
  });

  it.each(getDefaultModuleBlueprints())('$key supports connect rename and __new without mutating the source', (blueprint) => {
    const source = structuredClone(blueprint);
    const renamed = remapBlueprintColumnRefs(
      blueprint,
      connectedTables(blueprint, (column) => `live_${column.column_name}`),
    );
    const added = remapBlueprintColumnRefs(
      blueprint,
      connectedTables(blueprint, () => '__new'),
    );

    expect(renamed.conflicts).toEqual([]);
    expect(added.conflicts).toEqual([]);
    expect(remapBlueprintColumnRefs(blueprint, connectedTables(blueprint, (column) => `live_${column.column_name}`))).toEqual(renamed);
    expect(blueprint).toEqual(source);
  });

  it.each(['kanban_pack', 'preset_kanban_board'])('%s ships recurring ticket events', (key) => {
    const blueprint = getDefaultModuleBlueprints().find((candidate) => candidate.key === key);
    const tickets = blueprint.tables.find((table) => ['tickets', 'data'].includes(table.key));
    const events = blueprint.tables.find((table) => table.table_type === 'ticket_events');
    const columns = Object.fromEntries(tickets.columns.map((column) => [column.column_name, column]));

    expect(columns.what?.type).toBe('text');
    expect(columns.state).toBeDefined();
    expect(columns.repeat?.type).toBe('time');
    expect(columns.duration).toMatchObject({ type: 'number', config: { min: 1, suffix: ' min' } });
    expect(columns.scheduled_date?.type).toBe('datetime');
    expect(columns.due_date?.type).toBe('datetime');
    expect(events.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: 'ticket_id', type: 'relation', target: tickets.key, required: true }),
      expect.objectContaining({ column_name: 'state' }),
      expect.objectContaining({ column_name: 'original_start', type: 'datetime' }),
      expect.objectContaining({ column_name: 'start_datetime', type: 'datetime', required: true }),
      expect.objectContaining({ column_name: 'end_datetime', type: 'datetime' }),
    ]));
    expect(blueprint.apps[0].config.kanban.eventsTableId).toEqual({ $table: events.key });
  });

  it.each(getDefaultModuleBlueprints())('$key rejects null only when a config consumer references the column', (blueprint) => {
    const result = remapBlueprintColumnRefs(
      blueprint,
      connectedTables(blueprint, () => null),
    );
    const hasColumnConsumers = blueprint.apps.some((app) => app.columnRefPaths.length > 0);

    if (hasColumnConsumers) {
      expect(result.conflicts).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'COLUMN_REF_UNMAPPED', blocking: true }),
      ]));
    } else {
      expect(result.conflicts).toEqual([]);
    }
  });
});
