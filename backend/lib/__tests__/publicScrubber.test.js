// ADR-0060 §Fat-P5 / AC14 — Golden-fixture tests for the public widget
// scrubber. These cover the deterministic blacklist + preset whitelist
// guarantees. FK-gating against `is_public=false` parents is verified at
// the route layer (see backend/routes/v3/__tests__/public.test.js).
import { describe, test, expect } from 'vitest';
import {
  PUBLIC_PRESET_WHITELIST,
  isPresetAllowed,
  extractWidgetTableRef,
  scrubWidgetConfig,
} from '../publicScrubber.js';

describe('publicScrubber — preset whitelist (AC11)', () => {
  test('whitelist contains exactly the documented preset names', () => {
    // ADR-0060 P6/B added 'documents' for the read-only docs mirror.
    expect([...PUBLIC_PRESET_WHITELIST].sort()).toEqual(
      ['documents', 'kanban_board', 'table_view', 'task_list'].sort()
    );
  });

  test('isPresetAllowed accepts whitelisted presets', () => {
    expect(isPresetAllowed('kanban_board')).toBe(true);
    expect(isPresetAllowed('table_view')).toBe(true);
    expect(isPresetAllowed('task_list')).toBe(true);
    expect(isPresetAllowed('documents')).toBe(true);
  });

  test('isPresetAllowed rejects unknown / sensitive preset names (default-deny)', () => {
    // Defensive: every non-whitelisted type must be unreachable, including
    // any current internal-only preset that might leak user-bound data.
    for (const name of [
      'project_stats',
      'ai_agents',
      'chart_widget',
      'recent_activity',
      'terminal',
      'tickets_list',
      'calendar_widget',
      'stats_counter',
      'number_widget',
      '',
      null,
      undefined,
      'TABLE_VIEW',           // case sensitive
      'kanban',               // typo / shorthand must not match
      'KanbanBoard',          // CamelCase variant must not match
    ]) {
      expect(isPresetAllowed(name)).toBe(false);
    }
  });
});

describe('publicScrubber — blacklist enforcement (AC14)', () => {
  test('strips top-level secret keys from config', () => {
    const out = scrubWidgetConfig({
      id: 42,
      preset_name: 'table_view',
      title: 'A table',
      config: {
        table_id: 9001,
        created_by: 1,
        email_to: 'admin@example.com',
        webhook_secret: 'shhh',
        api_key: 'sk-abc',
        password: 'p4ss',
        token: 'jwt',
      },
    });
    expect(out).not.toBeNull();
    expect(out.view_config).toEqual({ table_id: 9001 });
    expect(out.view_config.created_by).toBeUndefined();
    expect(out.view_config.email_to).toBeUndefined();
    expect(out.view_config.webhook_secret).toBeUndefined();
    expect(out.view_config.api_key).toBeUndefined();
    expect(out.view_config.password).toBeUndefined();
    expect(out.view_config.token).toBeUndefined();
  });

  test('strips nested secret keys (deep walk)', () => {
    const out = scrubWidgetConfig({
      id: 7,
      preset_name: 'kanban_board',
      title: 'Board',
      config: {
        kanban: {
          tableId: 5,
          webhook_url: 'https://hooks.evil/abc',
          lanes: [
            { id: 'a', name: 'Todo', owner_id: 99 },
            { id: 'b', name: 'Done', api_token: 'shhh' },
          ],
        },
      },
    });
    expect(out.view_config.kanban.webhook_url).toBeUndefined();
    expect(out.view_config.kanban.lanes[0].owner_id).toBeUndefined();
    expect(out.view_config.kanban.lanes[0].name).toBe('Todo');
    expect(out.view_config.kanban.lanes[1].api_token).toBeUndefined();
    expect(out.view_config.kanban.lanes[1].name).toBe('Done');
  });

  test('accepts a config provided as a JSON string (like the DB column)', () => {
    const out = scrubWidgetConfig({
      id: 1,
      preset_name: 'table_view',
      title: 'A',
      config: JSON.stringify({ table_id: 11, secret: 'no' }),
    });
    expect(out.view_config).toEqual({ table_id: 11 });
  });

  test('returns null for non-whitelisted preset even when config looks valid', () => {
    // Belt-and-braces: even if the route forgets the whitelist guard, the
    // scrubber refuses to project a non-public preset's config.
    const out = scrubWidgetConfig({
      id: 1,
      preset_name: 'project_stats',
      title: 'Stats',
      config: { table_id: 1 },
    });
    expect(out).toBeNull();
  });

  test('returns null for null/empty/garbage input', () => {
    expect(scrubWidgetConfig(null)).toBeNull();
    expect(scrubWidgetConfig(undefined)).toBeNull();
    expect(scrubWidgetConfig({})).toBeNull(); // no preset_name → not allowed
    expect(scrubWidgetConfig({ preset_name: '' })).toBeNull();
  });

  test('handles invalid config json gracefully (falls back to {})', () => {
    const out = scrubWidgetConfig({
      id: 1,
      preset_name: 'table_view',
      title: 'A',
      config: 'not-a-json-string',
    });
    expect(out).not.toBeNull();
    expect(out.view_config).toEqual({});
    expect(out.table_id).toBeNull();
  });

  test('surfaces filter/sort metadata when present, null otherwise', () => {
    const withFilter = scrubWidgetConfig({
      id: 1,
      preset_name: 'table_view',
      title: 'A',
      config: { table_id: 1, filter: { status: 'open' }, sort: { col: 'name', dir: 'asc' } },
    });
    expect(withFilter.filter).toEqual({ status: 'open' });
    expect(withFilter.sort).toEqual({ col: 'name', dir: 'asc' });

    const without = scrubWidgetConfig({
      id: 2,
      preset_name: 'task_list',
      title: 'B',
      config: { tasks_table_id: 7 },
    });
    expect(without.filter).toBeNull();
    expect(without.sort).toBeNull();
  });
});

describe('publicScrubber — extractWidgetTableRef (FK gate input)', () => {
  test.each([
    [{ table_id: 42 }, 42],
    [{ tasks_table_id: '99' }, 99],
    [{ data_table_id: 3 }, 3],
    [{ kanban: { tableId: 17 } }, 17],
    [{ tableId: 5 }, 5],
    [{}, null],
    [{ table_id: 'not-a-number' }, null],
    [{ table_id: 0 }, null],
    [{ table_id: -1 }, null],
  ])('returns %j → %j', (cfg, expected) => {
    expect(extractWidgetTableRef(cfg)).toBe(expected);
  });

  test('table_id surfaces on output of scrubWidgetConfig (lifted)', () => {
    const out = scrubWidgetConfig({
      id: 1,
      preset_name: 'kanban_board',
      title: 'B',
      config: { kanban: { tableId: 42 } },
    });
    // table_id is lifted to the top of the projection so the public renderer
    // can resolve rows without knowing the per-preset key convention.
    expect(out.table_id).toBe(42);
  });
});

describe('publicScrubber — output shape contract', () => {
  test('returns exactly the documented public-safe keys, no more', () => {
    const out = scrubWidgetConfig({
      id: 1,
      preset_name: 'table_view',
      title: 'A',
      icon: '📋',
      // Things the renderer should NOT see at top level:
      created_by: 1,
      owner_id: 5,
      dashboard_id: 99,
      is_template: false,
      config: { table_id: 1 },
    });
    expect(out).not.toBeNull();
    expect(Object.keys(out).sort()).toEqual(
      ['filter', 'id', 'name', 'sort', 'table_id', 'type', 'view_config'].sort()
    );
  });
});
