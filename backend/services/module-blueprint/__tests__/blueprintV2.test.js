import { describe, expect, it } from 'vitest';
import { validateBlueprint } from '../../ModuleInstaller.js';
import { normalizeBlueprint } from '../blueprintV2.js';

const V1 = {
  key: 'legacy-pack',
  version: '1.0.0',
  title: 'Legacy pack',
  tables: [{ key: 'items', name: 'legacy_items', columns: [{ column_name: 'name', type: 'text' }] }],
  widgets: [
    { key: 'board', preset_name: 'table_view', config: { table_id: { $table: 'items' } } },
    { key: 'count', preset_name: 'number_widget', dashboard: 'main', config: { table_id: { $table: 'items' } } },
  ],
  sidebar: [{ widget: 'board' }],
};

const V2 = {
  key: 'crm-lite',
  version: '2.0.0',
  schema: 2,
  title: 'CRM lite',
  projects: [{ key: 'main', title: 'Support' }, { key: 'analytics', title: 'Analytics' }],
  requires: {
    tables: [{
      key: 'tickets',
      hint: 'Existing tickets',
      columns: [{ column_name: 'status', type: 'select', required: true }],
    }],
  },
  tables: [{
    key: 'sla',
    project: 'main',
    name: 'crm_sla',
    columns: [{ column_name: 'name', type: 'text' }],
  }, {
    key: 'metrics',
    project: 'analytics',
    name: 'crm_metrics',
    columns: [{ column_name: 'value', type: 'number' }],
  }],
  seed: [{ table: 'sla', key: ['name'], rows: [{ name: 'Default' }] }],
  apps: [{ key: 'board', preset: 'table_view', table: 'tickets', config: {} }],
  dashboards: [{
    key: 'main',
    target: 'new',
    title: 'CRM Overview',
    tiles: [
      { key: 'open_count', preset: 'number_widget', table: 'tickets', config: { aggregate: 'count' } },
      { key: 'board_link', preset: 'quick_links', app: 'board' },
    ],
  }],
  sidebar: [{ widget: 'board', icon: 'Boxes' }],
  services: [{
    key: 'mail',
    type_slug: 'remote_mcp',
    url: 'https://mail.example.com/mcp',
    allowed_tools: ['send'],
    secrets: ['MAIL_API_KEY'],
  }],
};

describe('ADR-207 W2.1 blueprint normalization', () => {
  it('normalizes schema 1 into one implicit project, apps and default tiles', () => {
    const normalized = normalizeBlueprint(validateBlueprint(V1));

    expect(normalized.schema).toBe(2);
    expect(normalized.projects).toEqual([{ key: 'main', title: 'Legacy pack' }]);
    expect(normalized.tables[0].project).toBe('main');
    expect(normalized.apps.map((app) => app.key)).toEqual(['board']);
    expect(normalized.dashboards).toHaveLength(1);
    expect(normalized.dashboards[0]).toMatchObject({ key: 'default', target: 'default' });
    expect(normalized.dashboards[0].tiles.map((tile) => tile.key)).toEqual(['count']);
    expect(normalized.sidebar).toEqual(V1.sidebar);
  });

  it('accepts and normalizes every schema 2 section without dropping services metadata', () => {
    const blueprint = validateBlueprint(V2);

    expect(blueprint.schema).toBe(2);
    expect(blueprint.tables.map((table) => table.project)).toEqual(['main', 'analytics']);
    expect(blueprint.requires.tables[0].key).toBe('tickets');
    expect(blueprint.apps[0]).toMatchObject({ key: 'board', preset: 'table_view', table: 'tickets' });
    expect(blueprint.dashboards[0].tiles).toHaveLength(2);
    expect(blueprint.services[0]).toEqual(V2.services[0]);
  });

  it('defaults project and target fields without changing declared config', () => {
    const blueprint = structuredClone(V2);
    delete blueprint.tables[0].project;
    blueprint.dashboards[0].target = 'default';

    const validated = validateBlueprint(blueprint);

    expect(validated.tables[0].project).toBe('main');
    expect(validated.dashboards[0].target).toBe('default');
    expect(validated.apps[0].config).toEqual({});
  });
});

describe('ADR-207 catalog metadata', () => {
  it('keeps description and readme as install-safe metadata in both blueprint schemas', () => {
    for (const source of [V1, V2]) {
      const blueprint = validateBlueprint({
        ...source,
        description: 'Owner summary',
        readme: '# Owner guide\n\nMarkdown **content**.',
      });
      expect(blueprint).toMatchObject({
        description: 'Owner summary', readme: '# Owner guide\n\nMarkdown **content**.',
      });
      const normalized = normalizeBlueprint(blueprint);
      expect(normalized.tables).toEqual(blueprint.tables.map((table) => ({ ...table, project: table.project || 'main' })));
      expect(normalized.readme).toBe('# Owner guide\n\nMarkdown **content**.');
    }
  });

  it('rejects unbounded readme metadata', () => {
    expect(() => validateBlueprint({ ...V2, readme: 'x'.repeat(100001) })).toThrow(/readme/);
  });
});

describe('ADR-207 W2.1 strict references', () => {
  it.each([
    ['unknown app table', (bp) => { bp.apps[0].table = 'missing'; }],
    ['unknown tile table', (bp) => { bp.dashboards[0].tiles[0].table = 'missing'; }],
    ['unknown tile app', (bp) => { bp.dashboards[0].tiles[1].app = 'missing'; }],
    ['unknown seed table', (bp) => { bp.seed[0].table = 'missing'; }],
    ['unknown table project', (bp) => { bp.tables[0].project = 'missing'; }],
    ['sidebar pointing at a tile', (bp) => { bp.sidebar[0].widget = 'open_count'; }],
    ['tile with table and app', (bp) => { bp.dashboards[0].tiles[0].app = 'board'; }],
    ['tile without table or app', (bp) => { delete bp.dashboards[0].tiles[0].table; }],
    ['duplicate app and tile key', (bp) => { bp.dashboards[0].tiles[1].key = 'board'; }],
    ['invalid machine key', (bp) => { bp.projects[0].key = 'Main Project'; }],
    ['invalid secret name', (bp) => { bp.services[0].secrets = ['mail-api-key']; }],
    ['secret value instead of a name', (bp) => { bp.services[0].secrets = ['raw-secret-value']; }],
  ])('rejects %s', (_label, mutate) => {
    const blueprint = structuredClone(V2);
    mutate(blueprint);

    expect(() => validateBlueprint(blueprint)).toThrow();
  });

  it('rejects a non-existent preset and reserved ownership config', () => {
    const badPreset = structuredClone(V2);
    badPreset.apps[0].preset = 'not_a_preset';
    expect(() => validateBlueprint(badPreset)).toThrow(/preset/);

    const reserved = structuredClone(V2);
    reserved.apps[0].config.__module = { key: 'other' };
    expect(() => validateBlueprint(reserved)).toThrow(/reserved/);
  });
});
