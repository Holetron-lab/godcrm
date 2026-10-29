// Neo16 W1 — the installable module shell, against godcrm_test (doc 239900 W1 acceptance):
// dry-run writes nothing; install produces ONE installation with per-space table refs
// resolved into the game widget; retried and CONCURRENT installs create no duplicate
// authoritative records (tables, widgets, installation).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbGet, dbAll, dbRun, resetAdapter, destroyAdapter, safeJsonParse } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { installModule, uninstallModule, WIDGET_TAG_KEY } from '../../../services/ModuleInstaller.js';
import { NEO16_BLUEPRINT } from '../blueprint.js';

const SLOW = 30_000;
let ws;

const tablesOf = () => dbAll(
  `SELECT id, name FROM universal_tables WHERE project_id = ? AND name LIKE 'neo16_%' ORDER BY name, id`,
  [ws.projectId],
);
const widgetsOf = () => dbAll(
  `SELECT w.id, w.preset_name, w.config FROM widgets w JOIN dashboards d ON d.id = w.dashboard_id WHERE d.space_id = ? ORDER BY w.id`,
  [ws.spaceId],
);
const installationsOf = () => dbAll(
  `SELECT id, status, version, project_id FROM module_installations WHERE module_key = ? AND space_id = ?`,
  [NEO16_BLUEPRINT.key, ws.spaceId],
);
const install = (dryRun = false) => installModule({
  blueprint: NEO16_BLUEPRINT, spaceId: ws.spaceId, projectId: ws.projectId, userId: ws.userId, dryRun,
});

beforeAll(async () => {
  await resetAdapter();
  const db = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(db.db).toMatch(/_test$/);
  expect([null, '127.0.0.1', '::1']).toContain(db.host);
  ws = await createEphemeralWorkspace({ label: 'neo16-w1', table: false, dashboard: false });
}, SLOW);

afterAll(async () => {
  if (ws) {
    const live = (await installationsOf()).find((i) => i.status === 'active');
    if (live) await uninstallModule({ moduleKey: NEO16_BLUEPRINT.key, spaceId: ws.spaceId, purge: true, userId: ws.userId });
    await dbRun('DELETE FROM module_installations WHERE module_key = ? AND space_id = ?', [NEO16_BLUEPRINT.key, ws.spaceId]);
    // The default board the install created, and whatever a failing run left on it (widgets do
    // not cascade from dashboards — a red concurrency run would otherwise leak stamped widgets).
    await dbRun('DELETE FROM widgets WHERE dashboard_id IN (SELECT id FROM dashboards WHERE space_id = ?)', [ws.spaceId]);
    await dbRun('DELETE FROM dashboards WHERE space_id = ?', [ws.spaceId]);
    await ws.cleanup();
  }
  await destroyAdapter();
}, SLOW);

describe('Neo16 W1 — blueprint install (godcrm_test)', () => {
  it('dry-run plans every blueprint table and one widget and writes nothing', async () => {
    const out = await install(true);
    expect(out.dry_run).toBe(true);
    expect(out.status).toBe('install');
    expect(out.plan.tables.map((t) => [t.name, t.action])).toEqual(NEO16_BLUEPRINT.tables.map((t) => [t.name, 'create']));
    expect(out.plan.widgets).toEqual([expect.objectContaining({ key: 'game', preset_name: '16neo', action: 'create' })]);
    expect(await tablesOf()).toEqual([]);
    expect(await widgetsOf()).toEqual([]);
    expect(await installationsOf()).toEqual([]);
  }, SLOW);

  it('concurrent installs of the same blueprint yield ONE installation, one table per name, one widget', async () => {
    const results = await Promise.allSettled([install(), install(), install()]);
    const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
    expect(failed).toEqual([]);

    const tables = await tablesOf();
    expect(tables.map((t) => t.name)).toEqual(NEO16_BLUEPRINT.tables.map((t) => t.name).sort());

    const installations = await installationsOf();
    expect(installations).toHaveLength(1);
    expect(installations[0]).toMatchObject({ status: 'active', version: NEO16_BLUEPRINT.version, project_id: ws.projectId });

    const widgets = await widgetsOf();
    expect(widgets).toHaveLength(1);
    const config = safeJsonParse(widgets[0].config, {});
    expect(widgets[0].preset_name).toBe('16neo');
    expect(config[WIDGET_TAG_KEY]).toEqual({ key: 'neo16', widget_key: 'game' });
    // Per-space table refs: the widget points at THIS project's tables, not at ids from elsewhere.
    const byName = Object.fromEntries(tables.map((t) => [t.name, t.id]));
    for (const t of NEO16_BLUEPRINT.tables) {
      expect(config[`${t.key}_table_id`]).toBe(byName[t.name]);
    }
    // W2: the seeded quest content landed exactly once despite three concurrent installs.
    const content = await dbAll(`SELECT data FROM table_rows WHERE table_id = ?`, [byName.neo16_content]);
    expect(content.map((r) => safeJsonParse(r.data, {}).content_key)).toEqual(['arrange_meeting']);
  }, SLOW);

  it('a retried install is a no-op: same ids, nothing added', async () => {
    const before = { tables: await tablesOf(), widgets: await widgetsOf() };
    const out = await install();
    expect(out.status).toBe('unchanged');
    expect(await tablesOf()).toEqual(before.tables);
    expect(await widgetsOf()).toEqual(before.widgets);
    expect(await installationsOf()).toHaveLength(1);
  }, SLOW);
});
