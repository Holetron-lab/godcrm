// The regression is a project dashboard with space_id NULL, as in staging widget 4376.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbGet, dbAll, dbRun, resetAdapter, destroyAdapter, safeJsonParse } from '../../../database/connection.js';
import * as connection from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { createWidget } from '../../../services/WidgetService.js';
import { installModule, uninstallModule } from '../../../services/ModuleInstaller.js';
import { NEO16_BLUEPRINT } from '../blueprint.js';
import router from '../routes.js';

let ws, widget, userId;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: userId }; next(); });
app.use('/neo16', router);
const install = (extra = {}) => installModule({ blueprint: NEO16_BLUEPRINT, spaceId: ws.spaceId,
  projectId: ws.projectId, userId: ws.userId, existingWidgets: { game: widget.id }, ...extra });
const readWidget = () => dbGet('SELECT * FROM widgets WHERE id = ?', [widget.id]);

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});
beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'neo16-adopt', table: false });
  userId = ws.userId;
  widget = await createWidget({ dashboard_id: ws.dashboardId, widget_type: 'preset', preset_name: '16neo',
    title: 'Keep my name', config: { quest_key: 'arrange_meeting', custom_setting: { keep: true } }, created_by: ws.userId });
});
afterEach(async () => {
  if (!ws) return;
  await dbRun('DELETE FROM _command_policies WHERE space_id = ?', [ws.spaceId]);
  const live = await dbGet('SELECT id FROM module_installations WHERE space_id = ? AND module_key = ?', [ws.spaceId, 'neo16']);
  if (live) await uninstallModule({ moduleKey: 'neo16', spaceId: ws.spaceId, purge: true });
  await dbRun('DELETE FROM module_installations WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM widgets WHERE dashboard_id IN (SELECT id FROM dashboards WHERE space_id = ? OR project_id = ?)', [ws.spaceId, ws.projectId]);
  await dbRun('DELETE FROM dashboards WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id=? AND id<>?)', [ws.spaceId, ws.projectId]);
  await dbRun('DELETE FROM projects WHERE space_id=? AND id<>?', [ws.spaceId, ws.projectId]);
  await ws.cleanup();
});
afterAll(destroyAdapter);

describe('Neo16 adoption of an existing project widget', () => {
  it('dry-run targets the original URL and writes neither widget nor installation/tables', async () => {
    const before = await readWidget();
    const out = await install({ dryRun: true });
    expect(out.plan.widgets).toMatchObject([{ action: 'adopt', widget_id: widget.id, dashboard_id: ws.dashboardId }]);
    expect(await readWidget()).toEqual(before);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [ws.projectId])).toEqual([]);
  });
  it('atomically provisions seven tables and adopts without changing identity, settings or layout; retry is a no-op', async () => {
    const before = await readWidget();
    const out = await install();
    expect(out.widgets).toMatchObject([{ widget_id: widget.id, action: 'adopted' }]);
    const after = await readWidget();
    for (const key of ['id', 'dashboard_id', 'owner_kind', 'owner_id', 'title', 'position', 'created_at', 'is_public']) expect(after[key]).toEqual(before[key]);
    const config = safeJsonParse(after.config);
    expect(config).toMatchObject({ ...widget.config, __module: { key: 'neo16', widget_key: 'game' } });
    for (const t of NEO16_BLUEPRINT.tables) expect(config[`${t.key}_table_id`]).toBe(out.mapping[t.key].table_id);
    expect(Object.keys(out.mapping)).toHaveLength(7);
    expect((await install()).status).toBe('unchanged');
    expect(await readWidget()).toEqual(after);
    expect(await dbAll('SELECT id FROM widgets WHERE dashboard_id = ?', [ws.dashboardId])).toHaveLength(1);
  });
  it('refuses foreign-space widgets before provisioning', async () => {
    await expect(install({ spaceId: ws.spaceId + 100000, projectId: ws.projectId })).rejects.toMatchObject({ code: 'PROJECT_NOT_IN_SPACE' });
    await expect(install({ existingWidgets: { game: 2147483647 } })).rejects.toMatchObject({ code: 'WIDGET_ADOPTION_CONFLICT' });
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [ws.projectId])).toEqual([]);
  });
  it('refuses wrong presets, reserved ownership and invalid mapping', async () => {
    await expect(install({ existingWidgets: { game: -1 } })).rejects.toMatchObject({ code: 'BLUEPRINT_INVALID' });
    await expect(install({ existingWidgets: { missing: widget.id } })).rejects.toMatchObject({ code: 'WIDGET_ADOPTION_CONFLICT' });
    await dbRun('UPDATE widgets SET preset_name = ? WHERE id = ?', ['table_view', widget.id]);
    await expect(install()).rejects.toMatchObject({ code: 'WIDGET_ADOPTION_CONFLICT' });
    await dbRun('UPDATE widgets SET preset_name = ?, config = ? WHERE id = ?', ['16neo', JSON.stringify({ __module: { key: 'other', widget_key: 'game' } }), widget.id]);
    await expect(install()).rejects.toMatchObject({ code: 'WIDGET_ADOPTION_CONFLICT' });
  });
  it('keeps seeded/user rows and rejects switching an installation to another project', async () => {
    const out = await install();
    const before = await dbAll('SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY id', [out.mapping.content.table_id]);
    await install();
    expect(await dbAll('SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY id', [out.mapping.content.table_id])).toEqual(before);
    const p = await dbRun('INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, ?, ?)', [ws.userId, ws.spaceId, 'other-adopt-project', 'business']);
    try { await expect(install({ projectId: p.lastInsertRowid })).rejects.toMatchObject({ code: 'INSTALLATION_PROJECT_MISMATCH' }); }
    finally { await dbRun('DELETE FROM projects WHERE id = ?', [p.lastInsertRowid]); }
  });
  it('owner HTTP dry-run/install works on a project dashboard; world API can then enter that same widget', async () => {
    const url = `/neo16/widgets/${widget.id}/install`;
    expect((await request(app).post(url).send({ data: { dry_run: true } })).status).toBe(200);
    const applied = await request(app).post(url).send({ data: {} });
    expect(applied.status).toBe(200);
    expect(applied.body.data.npc_agents.agents).toHaveLength(3);
    const tables = await dbAll('SELECT t.name, t.project_id, p.type FROM universal_tables t JOIN projects p ON p.id=t.project_id WHERE p.space_id=?', [ws.spaceId]);
    expect(tables.filter(t => t.name.startsWith('neo16_'))).toHaveLength(7);
    expect(tables.filter(t => t.name.startsWith('neo16_')).every(t => t.project_id === ws.projectId)).toBe(true);
    expect(tables.filter(t => ['AI Agents', 'AI Operators'].includes(t.name))).toHaveLength(2);
    expect(tables.filter(t => ['AI Agents', 'AI Operators'].includes(t.name)).every(t => t.type === 'system_data' && t.project_id !== ws.projectId)).toBe(true);
    expect((await request(app).post(url).send({ data: {} })).body.data.npc_agents.agents.map(a => a.agent_row_id))
      .toEqual(applied.body.data.npc_agents.agents.map(a => a.agent_row_id));
    const world = await request(app).post('/neo16/worlds').send({ data: { widget_id: widget.id } });
    expect(world.status).toBe(201);
    expect(world.body.data.npcs.length).toBeGreaterThan(0);
  });
  it('rejects a project override on a project widget before creating any tables', async () => {
    const other = await dbRun("INSERT INTO projects (owner_id,space_id,name,type) VALUES (?,?,'Other module project','business')", [ws.userId, ws.spaceId]);
    for (const dry_run of [true, false]) {
      const out = await request(app).post(`/neo16/widgets/${widget.id}/install`).send({ data: { dry_run, project_id: other.lastInsertRowid } });
      expect(out.status).toBe(409);
      expect(out.body.error.code).toBe('PROJECT_NOT_WIDGET_PROJECT');
    }
    expect(await dbAll('SELECT t.id FROM universal_tables t JOIN projects p ON p.id=t.project_id WHERE p.space_id=?', [ws.spaceId])).toEqual([]);
  });
  it('uses an explicit same-space project for a widget on the space dashboard', async () => {
    await dbRun('UPDATE dashboards SET project_id=NULL, space_id=? WHERE id=?', [ws.spaceId, ws.dashboardId]);
    const out = await request(app).post(`/neo16/widgets/${widget.id}/install`).send({ data: { project_id: ws.projectId } });
    expect(out.status).toBe(200);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id=?', [ws.projectId])).toHaveLength(7);
    expect(out.body.data.npc_agents.system_project.id).not.toBe(ws.projectId);
  });
  it('concurrent adoption creates no duplicate widget, tables or installation', async () => {
    await Promise.all([install(), install(), install()]);
    expect(await dbAll('SELECT id FROM widgets WHERE dashboard_id = ?', [ws.dashboardId])).toHaveLength(1);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [ws.projectId])).toHaveLength(7);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toHaveLength(1);
    expect(await dbAll('SELECT id FROM dashboards WHERE space_id = ?', [ws.spaceId])).toHaveLength(0);
  });
  it('movement, NPC dialogue and progress reload work through the adopted project widget', async () => {
    const installed = await install();
    const world = (await request(app).post('/neo16/worlds').send({ data: { widget_id: widget.id } })).body.data;
    const moved = await request(app).post(`/neo16/worlds/${world.world_id}/commands`).send({ data: {
      widget_id: widget.id, request_id: 'move-1', expected_version: world.state_version,
      command: 'move', payload: { destination: { x: 6, y: 1 } },
    } });
    expect(moved.status).toBe(200);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 4000);
    try {
      const tick = await request(app).post(`/neo16/worlds/${world.world_id}/commands`).send({ data: {
        widget_id: widget.id, request_id: 'tick-1', expected_version: moved.body.data.world.state_version,
        command: 'heartbeat', payload: {},
      } });
      expect(tick.status).toBe(200);
      expect(tick.body.data.world.snapshot.world.players.find((p) => p.id === world.learner_player_id).position.x).toBeGreaterThan(1);
    } finally { clock.mockRestore(); }
    const session = await request(app).post('/neo16/sessions').send({ data: {
      widget_id: widget.id, command: 'start_session', payload: { quest_key: 'arrange_meeting', content_version: 1 },
    } });
    expect(session.body.data.world_id).toBe(world.world_id);
    const sid = session.body.data.session_id;
    // Explicit TEST fixture only: no silent rules binding is created by install or the live runbook.
    await dbRun('INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)', [
      installed.mapping.content.table_id, 'adopt-rules-fixture', JSON.stringify({ kind: 'agent_binding', content_key: 'evaluator',
        content_version: 1, status: 'active', payload: { evaluator: 'rules' } }), ws.userId,
    ]);
    for (const [i, npc_key, text] of [[0, 'nora', 'When is she free?'], [1, 'nora', 'Where should I meet her?'], [2, 'reed', 'Thursday at two in Lab B works for me.']]) {
      const response = await request(app).post(`/neo16/sessions/${sid}/commands`).send({ data: {
        widget_id: widget.id, command: 'say', request_id: `dialogue-${i}`, expected_version: i, payload: { npc_key, text },
      } });
      expect(response.status).toBe(200);
    }
    await install();
    const reload = await request(app).get(`/neo16/sessions/${sid}/state`).query({ widget_id: widget.id });
    expect(reload.body.data.session.status).toBe('completed');
    expect(reload.body.data.progress.xp).toBe(50);
    expect(reload.body.data.turns).toHaveLength(3);
  });
  it('refuses another widget when the module already owns a game URL', async () => {
    const installed = await installModule({ blueprint: NEO16_BLUEPRINT, spaceId: ws.spaceId, projectId: ws.projectId, userId: ws.userId });
    expect(installed.widgets[0].widget_id).not.toBe(widget.id);
    const before = await readWidget();
    await expect(install()).rejects.toMatchObject({ code: 'WIDGET_ADOPTION_CONFLICT' });
    expect(await readWidget()).toEqual(before);
  });
  it('refuses incompatible existing table schemas without changing their rows', async () => {
    await install();
    const table = await dbGet('SELECT id FROM universal_tables WHERE project_id = ? AND name = ?', [ws.projectId, 'neo16_content']);
    await dbRun('UPDATE table_columns SET type = ? WHERE table_id = ? AND column_name = ?', ['number', table.id, 'content_key']);
    const before = await dbAll('SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY id', [table.id]);
    await expect(install()).rejects.toMatchObject({ code: 'WIDGET_ADOPTION_CONFLICT' });
    expect(await dbAll('SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY id', [table.id])).toEqual(before);
  });
  it('rolls back a failed agent phase and completes setup on retry without replacing the installed widget', async () => {
    const original = connection.withTransactionAsync;
    const failure = vi.spyOn(connection, 'withTransactionAsync').mockImplementation(fn => original(trx => {
      const run = trx.run;
      trx.run = (sql, params) => {
        if (sql.includes('INSERT INTO _command_policies')) throw new Error('Injected policy write failure');
        return run(sql, params);
      };
      return fn(trx);
    }));
    try {
      const failed = await request(app).post(`/neo16/widgets/${widget.id}/install`).send({ data: {} });
      expect(failed.status).toBe(409);
      expect(failed.body.error.code).toBe('NPC_SETUP_INCOMPLETE');
      expect(safeJsonParse((await readWidget()).config).__module.key).toBe('neo16');
      expect(await dbAll("SELECT id FROM universal_tables WHERE project_id=? AND name='AI Agents'", [ws.projectId])).toEqual([]);
    } finally { failure.mockRestore(); }
    const retry = await request(app).post(`/neo16/widgets/${widget.id}/install`).send({ data: {} });
    expect(retry.status).toBe(200);
    expect(retry.body.data.npc_agents.agents).toHaveLength(3);
    expect(await dbAll('SELECT id FROM widgets WHERE dashboard_id=?', [ws.dashboardId])).toEqual([{ id: widget.id }]);
  });
  it('HTTP activation denies a non-owner and rejects unknown input', async () => {
    userId = 2147483647;
    expect((await request(app).post(`/neo16/widgets/${widget.id}/install`).send({ data: {} })).status).toBe(404);
    userId = ws.userId;
    expect((await request(app).post(`/neo16/widgets/${widget.id}/install`).send({ data: { surprise: true } })).status).toBe(400);
  });
});
