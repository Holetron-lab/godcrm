// @vitest-environment node
/**
 * ADR-164 addendum — table_type in global_search, fixture-backed (CRM doc 232328).
 *
 * Runs the real handler against the pinned test contour (godcrm_test) using
 * two ephemeral workspaces (= two spaces). Rows are removed by the fixture's
 * cleanup (DELETE FROM universal_tables WHERE project_id = ?).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { calendarToolHandlers } from '../calendar-tools.js';

const search = (args) => calendarToolHandlers.global_search(args);
const ids = (res) => res.results.tables.map((t) => Number(t.id)).sort((a, b) => a - b);

let a, b, marker, tables;

async function addTable(ws, name, tableType) {
  const row = await dbRun(
    'INSERT INTO universal_tables (project_id, name, table_type) VALUES (?, ?, ?)',
    [ws.projectId, name, tableType]
  );
  return Number(row.lastInsertRowid);
}

beforeAll(async () => {
  await resetAdapter();
  a = await createEphemeralWorkspace({ label: 'gs-a', table: false, dashboard: false });
  b = await createEphemeralWorkspace({ label: 'gs-b', table: false, dashboard: false });
  // Unique marker per run: the shared godcrm_test already holds real ai_agents rows.
  marker = `fx_${a.token}`.slice(0, 50);
  tables = {
    renamedA: await addTable(a, `Research Crew ${a.token}`, marker),
    otherMarkerA: await addTable(a, `AI Agents ${a.token}`, `${marker}_x`.slice(0, 50)),
    unmarkedA: await addTable(a, `AI Agents unmarked ${a.token}`, null),
    renamedB: await addTable(b, `Research Crew ${b.token}`, marker),
  };
});

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await destroyAdapter();
});

describe('global_search table_type against godcrm_test', () => {
  test('renamed marked table is found without a name query; other/unmarked excluded', async () => {
    const res = await search({ table_type: marker, types: ['tables'], space_id: a.spaceId, limit: 500 });
    expect(res.query).toBe('');
    expect(ids(res)).toEqual([tables.renamedA]);
    expect(res.results.tables[0].table_type).toBe(marker);
  });

  test('space_id isolates: space B returns only its own; omission returns both', async () => {
    const inB = await search({ table_type: marker, space_id: b.spaceId });
    expect(ids(inB)).toEqual([tables.renamedB]);

    const all = await search({ table_type: marker, limit: 500 });
    expect(ids(all)).toEqual([tables.renamedA, tables.renamedB].sort((x, y) => x - y));
  });

  test('name + marker combine with AND', async () => {
    const hit = await search({ table_type: marker, query: 'Research', space_id: a.spaceId });
    expect(ids(hit)).toEqual([tables.renamedA]);

    const miss = await search({ table_type: marker, query: 'AI Agents', space_id: a.spaceId });
    expect(ids(miss)).toEqual([]);
  });

  test('unknown marker returns an empty array, no name fallback', async () => {
    const res = await search({ table_type: `${marker}_nope`.slice(0, 50), space_id: a.spaceId });
    expect(res.results.tables).toEqual([]);
  });

  test('% in the marker is literal, not a wildcard', async () => {
    const res = await search({ table_type: 'fx_%', space_id: a.spaceId });
    expect(res.results.tables).toEqual([]);
  });

  test('legacy name search exposes table_type (string or null) and honours space_id', async () => {
    const res = await search({ query: `AI Agents`, types: ['tables'], space_id: a.spaceId, limit: 500 });
    const byId = Object.fromEntries(res.results.tables.map((t) => [Number(t.id), t.table_type]));
    expect(byId[tables.otherMarkerA]).toBe(`${marker}_x`.slice(0, 50));
    expect(byId[tables.unmarkedA]).toBeNull();
    expect(byId[tables.renamedA]).toBeUndefined();
  });

  test('limit is applied after filtering', async () => {
    const res = await search({ table_type: marker, limit: 1 });
    expect(res.results.tables).toHaveLength(1);
    expect(res.results.tables[0].table_type).toBe(marker);
  });
});
