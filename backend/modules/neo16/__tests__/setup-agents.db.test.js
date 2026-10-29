import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { dbGet, dbAll, dbRun, resetAdapter, destroyAdapter, getAdapter, safeJsonParse } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { installModule, uninstallModule } from '../../../services/ModuleInstaller.js';
import { NEO16_BLUEPRINT } from '../blueprint.js';
import { resolveBinding, resolveBoundAgent } from '../learning/agentRun.js';
import resolver from '../../../services/agent-permissions/resolver.js';
import { setupNpcAgents } from '../setupNpcAgents.js';
let ws;
const setup = (dryRun = false) => setupNpcAgents({ spaceId: ws.spaceId, projectId: ws.projectId, userId: ws.userId, dryRun });
beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});
beforeEach(async () => { ws = await createEphemeralWorkspace({ label: 'neo16-agents', table: false, dashboard: false }); });
afterEach(async () => {
  await resolver.shutdown();
  await dbRun('DELETE FROM _command_policies WHERE space_id = ?', [ws.spaceId]);
  await dbRun("DELETE FROM users WHERE user_type = 'agent' AND managed_by_agent_row_id IN (SELECT r.id FROM table_rows r JOIN universal_tables t ON t.id=r.table_id JOIN projects p ON p.id=t.project_id WHERE p.space_id=?)", [ws.spaceId]);
  const installed = await dbGet('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId]);
  if (installed) await uninstallModule({ moduleKey: 'neo16', spaceId: ws.spaceId, purge: true });
  await dbRun('DELETE FROM module_installations WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM widgets WHERE dashboard_id IN (SELECT id FROM dashboards WHERE space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM dashboards WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id=? AND id<>?)', [ws.spaceId, ws.projectId]);
  await dbRun('DELETE FROM projects WHERE space_id=? AND id<>?', [ws.spaceId, ws.projectId]);
  await ws.cleanup();
});
afterAll(destroyAdapter);
const install = () => installModule({ blueprint: NEO16_BLUEPRINT, spaceId: ws.spaceId, projectId: ws.projectId, userId: ws.userId });

describe('Neo16 NPC agents in the installation space', () => {
  it('dry-run before module install describes three agents and local tables without writing', async () => {
    const out = await setup(true);
    expect(out.agents.map(a => a.npc_key)).toEqual(['nora', 'reed', 'casey']);
    expect(out.tables.map(t => t.name)).toEqual(['AI Operators', 'AI Agents']);
    expect(out.system_project).toEqual({ id: null, name: 'System Data', action: 'create' });
    expect(await dbAll('SELECT id FROM projects WHERE space_id=?', [ws.spaceId])).toEqual([{ id: ws.projectId }]);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [ws.projectId])).toEqual([]);
  });
  it('creates local agents, Codex operator, bindings and deny-all policies; resolves through the real fleet', async () => {
    const installed = await install();
    const out = await setup();
    expect(out.agents).toHaveLength(3);
    const system = await dbGet("SELECT id, owner_id, type FROM projects WHERE space_id=? AND name='System Data'", [ws.spaceId]);
    expect(system).toMatchObject({ owner_id: ws.userId, type: 'system_data' });
    expect(system.id).not.toBe(ws.projectId);
    expect(await dbAll('SELECT name FROM universal_tables WHERE project_id=? ORDER BY name', [ws.projectId]))
      .toEqual(NEO16_BLUEPRINT.tables.map(t => ({ name: t.name })).sort((a, b) => a.name.localeCompare(b.name)));
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id=? ORDER BY id', [system.id]))
      .toEqual(out.tables.map(t => ({ id: t.table_id })));
    await resolver.init({ adapter: await getAdapter() });
    for (const a of out.agents) {
      const row = await dbGet('SELECT r.data, p.space_id FROM table_rows r JOIN universal_tables t ON t.id=r.table_id JOIN projects p ON p.id=t.project_id WHERE r.id=?', [a.agent_row_id]);
      expect(row.space_id).toBe(ws.spaceId);
      expect(safeJsonParse(row.data)).toMatchObject({ status: 'active', model: 'gpt-6-astra', response_mode: 'mention_only', group_chat_behavior: 'silent' });
      expect(await resolveBinding(installed.mapping, a.npc_key)).toMatchObject({ kind: 'agent', agentRowId: a.agent_row_id });
      expect(await resolveBoundAgent(a.agent_row_id, ws.spaceId)).toMatchObject({ provider: 'codex', requestedModel: 'gpt-6-astra' });
      expect((await resolver.resolve({ agent_id: a.agent_row_id, space_id: ws.spaceId, tool_name: 'mcp__godcrm__add_table_row', tool_input: {} })).decision).toBe('deny');
      expect((await resolver.resolve({ agent_id: a.agent_row_id, space_id: ws.spaceId, tool_name: 'Bash', tool_input: { command: 'ls /tmp' } })).decision).toBe('deny');
    }
  });
  it('reuses a renamed System Data project by type and reports its destination in dry-run', async () => {
    await install();
    const system = await dbRun("INSERT INTO projects (owner_id,space_id,name,type) VALUES (?,?,'System registry','system_data')", [ws.userId, ws.spaceId]);
    const plan = await setup(true);
    expect(plan.system_project).toEqual({ id: system.lastInsertRowid, name: 'System registry', action: 'existing' });
    expect(plan.tables.every(t => t.project_id === system.lastInsertRowid)).toBe(true);
    const out = await setup();
    expect(out.system_project.id).toBe(system.lastInsertRowid);
    expect(await dbAll('SELECT id FROM projects WHERE space_id=?', [ws.spaceId])).toHaveLength(2);
  });
  it('moves legacy registries on repeat setup without changing IDs, rows, policies or bindings', async () => {
    const installed = await install();
    const first = await setup();
    const ids = first.tables.map(t => t.table_id);
    await dbRun('UPDATE universal_tables SET project_id=? WHERE id IN (?,?)', [ws.projectId, ...ids]);
    const rows = await dbAll('SELECT id, data FROM table_rows WHERE table_id IN (?,?,?) ORDER BY id', [...ids, installed.mapping.content.table_id]);
    const policies = await dbAll('SELECT * FROM _command_policies WHERE space_id=? ORDER BY id', [ws.spaceId]);
    const plan = await setup(true);
    expect(plan.tables.map(t => t.action)).toEqual(['move', 'move']);
    expect(plan.tables.every(t => t.from_project_id === ws.projectId)).toBe(true);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id=?', [ws.projectId])).toHaveLength(9);
    const out = await setup();
    expect(out.tables.map(t => t.table_id)).toEqual(ids);
    expect(out.agents).toEqual(first.agents.map(a => ({ ...a, action: 'existing' })));
    expect(await dbAll('SELECT id, data FROM table_rows WHERE table_id IN (?,?,?) ORDER BY id', [...ids, installed.mapping.content.table_id])).toEqual(rows);
    expect(await dbAll('SELECT * FROM _command_policies WHERE space_id=? ORDER BY id', [ws.spaceId])).toEqual(policies);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id=?', [ws.projectId])).toHaveLength(7);
    expect((await setup()).tables.map(t => t.action)).toEqual(['existing', 'existing']);
  });
  it('refuses ambiguous System Data projects without changing tables', async () => {
    await install();
    await dbRun("INSERT INTO projects (owner_id,space_id,name,type) VALUES (?,?,'System Data','system_data'), (?,?,'Other system','system_data')", [ws.userId, ws.spaceId, ws.userId, ws.spaceId]);
    await expect(setup()).rejects.toMatchObject({ code: 'AGENT_SETUP_CONFLICT' });
    expect(await dbAll('SELECT t.id FROM universal_tables t JOIN projects p ON p.id=t.project_id WHERE p.space_id=? AND t.name IN (?,?)', [ws.spaceId, 'AI Agents', 'AI Operators'])).toEqual([]);
  });
  it('concurrent/repeated setup preserves agent customizations and creates no duplicates', async () => {
    await install();
    const [a, b] = await Promise.all([setup(), setup()]);
    expect(a.agents.map(x => x.agent_row_id)).toEqual(b.agents.map(x => x.agent_row_id));
    await dbRun("UPDATE table_rows SET data=data || ?::jsonb WHERE id=?", [JSON.stringify({ main_instructions: 'Owner edited persona' }), a.agents[0].agent_row_id]);
    await setup();
    const row = await dbGet('SELECT data FROM table_rows WHERE id=?', [a.agents[0].agent_row_id]);
    expect(safeJsonParse(row.data).main_instructions).toBe('Owner edited persona');
    expect(await dbAll('SELECT id FROM _command_policies WHERE space_id=?', [ws.spaceId])).toHaveLength(3);
    expect(await dbAll("SELECT id FROM projects WHERE space_id=? AND type='system_data'", [ws.spaceId])).toHaveLength(1);
  });
  it('refuses disabled local operators and schema conflicts without provisioning agents', async () => {
    await install();
    const out = await setup();
    await dbRun("UPDATE table_rows SET data=data || ?::jsonb WHERE id=?", [JSON.stringify({ status: 'inactive' }), out.operator.row_id]);
    await expect(setup()).rejects.toMatchObject({ code: 'AGENT_SETUP_CONFLICT' });
    await dbRun("UPDATE table_rows SET data=data || ?::jsonb WHERE id=?", [JSON.stringify({ status: 'active' }), out.operator.row_id]);
    await dbRun("UPDATE table_columns SET type='number' WHERE table_id=? AND column_name='model'", [out.tables[1].table_id]);
    await expect(setup()).rejects.toMatchObject({ code: 'AGENT_SETUP_CONFLICT' });
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id=?', [out.tables[1].table_id])).toHaveLength(3);
  });
  it('does not override an existing evaluator binding', async () => {
    const installed = await install();
    await dbRun('INSERT INTO table_rows (table_id,base_id,data) VALUES (?,?,?)', [installed.mapping.content.table_id, 'owner-evaluator',
      JSON.stringify({ kind: 'agent_binding', content_key: 'evaluator', content_version: 1, status: 'active', payload: { evaluator: 'rules' } })]);
    await expect(setup()).rejects.toMatchObject({ code: 'AGENT_SETUP_CONFLICT' });
    expect(await dbAll("SELECT id FROM universal_tables WHERE project_id=? AND name='AI Agents'", [ws.projectId])).toEqual([]);
  });
  it('adds NPCs to the existing Agents table in another project of the SAME space, preserving all prior rows', async () => {
    await install();
    const p = await dbRun('INSERT INTO projects (owner_id,space_id,name,type) VALUES (?,?,?,?)', [ws.userId, ws.spaceId, `System ${ws.token}`, 'business']);
    const t = await dbRun("INSERT INTO universal_tables (project_id,name,table_type) VALUES (?,'AI Agents','ai_agents')", [p.lastInsertRowid]);
    try {
      await dbRun("INSERT INTO table_columns (table_id,column_name,display_name,type,is_required) VALUES (?,'name','Name','text',1)", [t.lastInsertRowid]);
      const priorData = { name: 'Owner existing agent', custom_field: { keep: true } };
      const prior = await dbRun('INSERT INTO table_rows (table_id,base_id,data) VALUES (?,?,?)', [t.lastInsertRowid, 'keep-owner-agent', JSON.stringify(priorData)]);
      const out = await setup();
      expect(out.tables[1].table_id).toBe(t.lastInsertRowid);
      expect(out.tables[1].action).toBe('move');
      expect(out.tables[1].from_project_id).toBe(p.lastInsertRowid);
      expect(await dbAll('SELECT id FROM table_rows WHERE table_id=?', [t.lastInsertRowid])).toHaveLength(4);
      expect(safeJsonParse((await dbGet('SELECT data FROM table_rows WHERE id=?', [prior.lastInsertRowid])).data)).toEqual(priorData);
      expect(await dbAll("SELECT t.id FROM universal_tables t JOIN projects p ON p.id=t.project_id WHERE p.space_id=? AND t.name='AI Agents'", [ws.spaceId])).toEqual([{ id: t.lastInsertRowid }]);
    } finally {
      await dbRun('UPDATE universal_tables SET project_id=? WHERE id=?', [ws.projectId, t.lastInsertRowid]);
      await dbRun('DELETE FROM projects WHERE id=?', [p.lastInsertRowid]);
    }
  });
  it('fails closed without an active installation and creates no agent tables', async () => {
    await expect(setup()).rejects.toMatchObject({ code: 'NOT_INSTALLED' });
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id=?', [ws.projectId])).toEqual([]);
  });
});
