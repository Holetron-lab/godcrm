// NPC identities belong to the installing space's normal Agents registry, never the
// Development registry. Agent registries live in System Data; module tables stay
// in the widget's project. Reuse core definitions and the authored personas.
import { randomUUID } from 'node:crypto';
import { withTransactionAsync, safeJsonParse } from '../../database/connection.js';
import { getTableDefinitions } from '../../routes/v3/ai-agents/setupTablesData.js';
import { BlueprintError } from '../../services/ModuleInstaller.js';
import { apiLogger } from '../../utils/logger.js';
import { ARRANGE_MEETING } from './content/quests.js';

/** Retriable second setup phase; all agents, policies and bindings commit together. */
export async function setupNpcAgents({ spaceId, projectId, userId, dryRun = false }) {
  return withTransactionAsync(async (trx) => {
    await trx.run('SELECT pg_advisory_xact_lock(hashtext(?))', [`neo16-agents:${spaceId}`]);
    const project = await trx.get('SELECT space_id FROM projects WHERE id = ?', [projectId]);
    if (Number(project?.space_id) !== Number(spaceId)) throw new BlueprintError('Project is outside the widget space', 'PROJECT_NOT_IN_SPACE');
    const installation = await trx.get("SELECT project_id FROM module_installations WHERE module_key = 'neo16' AND space_id = ? AND status = 'active'", [spaceId]);
    if (!dryRun && !installation) throw new BlueprintError('Install Neo16 before its agents', 'NOT_INSTALLED');
    if (installation && Number(installation.project_id) !== Number(projectId)) throw new BlueprintError('Installation project differs', 'INSTALLATION_PROJECT_MISMATCH');
    const content = await trx.get("SELECT id FROM universal_tables WHERE project_id = ? AND name = 'neo16_content'", [projectId]);
    if (!dryRun && !content) throw new BlueprintError('Neo16 content table is missing', 'NOT_INSTALLED');

    const systemProjects = await trx.all(
      "SELECT id, name FROM projects WHERE space_id=? AND (type='system_data' OR name='System Data') ORDER BY id", [spaceId],
    );
    if (systemProjects.length > 1) throw new BlueprintError('Ambiguous System Data project', 'AGENT_SETUP_CONFLICT');
    const systemProject = { id: systemProjects[0]?.id ?? null, name: systemProjects[0]?.name ?? 'System Data', action: systemProjects.length ? 'existing' : 'create' };

    const definitions = getTableDefinitions().filter(t => ['AI Operators', 'AI Agents'].includes(t.name));
    definitions[1].columns.push(
      { name: 'slug', type: 'text' }, { name: 'main_instructions', type: 'long_text' },
      { name: 'run_timeout_min', type: 'number' }, { name: 'neo16_npc_key', type: 'text' },
    );
    const tables = [];
    for (const def of definitions) {
      const matches = await trx.all(
        `SELECT t.id, t.name, t.project_id FROM universal_tables t JOIN projects p ON p.id=t.project_id
          WHERE p.space_id=? AND (t.name=? OR (?='AI Agents' AND t.table_type='ai_agents')) ORDER BY t.id`,
        [spaceId, def.name, def.name],
      );
      if (matches.length > 1 || (matches[0] && matches[0].name !== def.name)) throw new BlueprintError(`Ambiguous/renamed ${def.name} registry`, 'AGENT_SETUP_CONFLICT');
      const current = matches[0] ? await trx.all('SELECT column_name, type, config, is_required FROM table_columns WHERE table_id=?', [matches[0].id]) : [];
      for (const col of def.columns) {
        const old = current.find(c => c.column_name === col.name);
        // Do not retype an owner's column or insert a string into a numeric relation.
        if (old && old.type !== col.type) {
          throw new BlueprintError(`Incompatible ${def.name}.${col.name} type`, 'AGENT_SETUP_CONFLICT');
        }
      }
      const seedFields = def.name === 'AI Agents'
        ? ['name', 'slug', 'neo16_npc_key', 'description', 'main_instructions', 'system_prompt', 'operator_id', 'model', 'status', 'run_timeout_min', 'response_mode', 'group_chat_behavior']
        : ['name', 'provider', 'status', 'description'];
      if (current.some(col => col.is_required && !seedFields.includes(col.column_name))) {
        throw new BlueprintError(`Required custom fields in ${def.name} need owner values`, 'AGENT_SETUP_CONFLICT');
      }
      const missing = def.columns.filter(c => !current.some(old => old.column_name === c.name));
      const providerOptions = safeJsonParse(current.find(c => c.column_name === 'provider')?.config, {})?.options;
      const optionsAdded = Array.isArray(providerOptions) && !providerOptions.some(o => (typeof o === 'string' ? o : o.value) === 'codex') ? ['codex'] : [];
      const currentProjectId = matches[0]?.project_id ?? null;
      tables.push({ provider_options_added: optionsAdded, name: def.name, table_id: matches[0]?.id ?? null,
        project_id: systemProject.id, from_project_id: currentProjectId,
        action: matches[0] ? (currentProjectId === systemProject.id ? 'existing' : 'move') : 'create', columns_added: missing.map(c => c.name) });
    }
    const operators = tables[0].table_id ? await trx.all('SELECT id, data FROM table_rows WHERE table_id=? ORDER BY id', [tables[0].table_id]) : [];
    let operator = operators.find(r => { const d = safeJsonParse(r.data, {}); return d.provider === 'codex' && d.status === 'active'; });
    if (!operator && operators.some(r => safeJsonParse(r.data, {}).provider === 'codex')) {
      throw new BlueprintError('The local Codex operator is disabled; refusing to create an active duplicate', 'AGENT_SETUP_CONFLICT');
    }
    const existingAgents = tables[1].table_id ? await trx.all('SELECT id, data FROM table_rows WHERE table_id=? ORDER BY id', [tables[1].table_id]) : [];
    const bindings = content ? await trx.all("SELECT id, data FROM table_rows WHERE table_id=? AND data->>'kind'='agent_binding'", [content.id]) : [];
    if (bindings.some(r => safeJsonParse(r.data, {}).content_key === 'evaluator')) {
      throw new BlueprintError('An evaluator binding already exists; choose explicitly before adding NPC-specific bindings', 'AGENT_SETUP_CONFLICT');
    }
    const agents = ARRANGE_MEETING.payload.npcs.map(npc => {
      const slug = `neo16-${spaceId}-${npc.key}`;
      const found = existingAgents.filter(r => safeJsonParse(r.data, {}).slug === slug);
      if (found.length > 1 || (found[0] && safeJsonParse(found[0].data, {}).neo16_npc_key !== npc.key)) throw new BlueprintError(`Agent identity conflict: ${slug}`, 'AGENT_SETUP_CONFLICT');
      const bound = bindings.filter(r => safeJsonParse(r.data, {}).content_key === npc.key);
      if (bound.length > 1 || (bound[0] && safeJsonParse(bound[0].data, {}).payload?.agent_row_id !== found[0]?.id)) throw new BlueprintError(`Existing binding for ${npc.key}; refusing to overwrite`, 'AGENT_SETUP_CONFLICT');
      return { npc_key: npc.key, agent_row_id: found[0]?.id ?? null, slug, action: found[0] ? 'existing' : 'create', binding_id: bound[0]?.id ?? null };
    });
    if (dryRun) return { dry_run: true, system_project: systemProject, tables, operator: { action: operator ? 'existing' : 'create', row_id: operator?.id ?? null, provider: 'codex' }, agents };

    if (!systemProject.id) {
      const result = await trx.run(
        "INSERT INTO projects (owner_id,space_id,name,type,icon,description) VALUES (?,?,'System Data','system_data','⚙️','System configuration and logs')",
        [userId, spaceId],
      );
      systemProject.id = result.lastInsertRowid;
    }
    for (const [i, def] of definitions.entries()) {
      tables[i].project_id = systemProject.id;
      if (tables[i].action === 'move') {
        await trx.run('UPDATE universal_tables SET project_id=? WHERE id=?', [systemProject.id, tables[i].table_id]);
      }
      if (!tables[i].table_id) {
        const result = await trx.run('INSERT INTO universal_tables (project_id,name,display_name,icon,table_type,created_by) VALUES (?,?,?,?,?,?)',
          [systemProject.id, def.name, def.name, def.icon, def.name === 'AI Agents' ? 'ai_agents' : null, userId]);
        tables[i].table_id = result.lastInsertRowid;
      }
      for (const col of def.columns.filter(c => tables[i].columns_added.includes(c.name))) {
        const config = col.config || {};
        if (def.name === 'AI Operators' && col.name === 'provider') config.options = [...(config.options || []), { value: 'codex', label: 'Codex CLI' }];
        await trx.run('INSERT INTO table_columns (table_id,column_name,display_name,type,is_required,config,order_index) VALUES (?,?,?,?,?,?,(SELECT COALESCE(MAX(order_index),0)+1 FROM table_columns WHERE table_id=?))',
          [tables[i].table_id, col.name, col.name, col.type, col.isRequired ? 1 : 0, JSON.stringify(config), tables[i].table_id]);
      }
    }
    if (!operator) {
      const providerColumn = await trx.get("SELECT id, config FROM table_columns WHERE table_id=? AND column_name='provider'", [tables[0].table_id]);
      const config = safeJsonParse(providerColumn.config, {});
      if (Array.isArray(config.options) && !config.options.some(o => (typeof o === 'string' ? o : o.value) === 'codex')) {
        await trx.run('UPDATE table_columns SET config=? WHERE id=?', [JSON.stringify({ ...config, options: [...config.options, { value: 'codex', label: 'Codex CLI' }] }), providerColumn.id]);
      }
      const result = await trx.run('INSERT INTO table_rows (table_id,base_id,data,created_by) VALUES (?,?,?,?)',
        [tables[0].table_id, randomUUID(), JSON.stringify({ name: 'Codex CLI — Neo16', provider: 'codex', status: 'active', description: 'Neo16 NPC runtime; host CLI authentication required' }), userId]);
      operator = { id: result.lastInsertRowid };
    }
    for (const [i, agent] of agents.entries()) {
      const npc = ARRANGE_MEETING.payload.npcs[i];
      if (!agent.agent_row_id) {
        const result = await trx.run('INSERT INTO table_rows (table_id,base_id,data,created_by) VALUES (?,?,?,?)', [tables[1].table_id, randomUUID(), JSON.stringify({
          name: `Neo16 · ${npc.name}`, slug: agent.slug, neo16_npc_key: npc.key, description: npc.role,
          main_instructions: npc.persona, system_prompt: npc.persona, operator_id: operator.id, model: 'gpt-6-astra',
          status: 'active', run_timeout_min: 1, response_mode: 'mention_only', group_chat_behavior: 'silent',
        }), userId]);
        agent.agent_row_id = result.lastInsertRowid;
      }
      const policy = await trx.get("SELECT id FROM _command_policies WHERE scope='space' AND space_id=? AND agent_id=? AND tool_id IS NULL AND pattern='' AND match_type='prefix' AND action='deny'", [spaceId, agent.agent_row_id]);
      if (!policy) await trx.run("INSERT INTO _command_policies (scope,space_id,agent_id,tool_id,pattern,match_type,action,reason) VALUES ('space',?,?,NULL,'','prefix','deny','Neo16 NPC: dialogue only, no tools')", [spaceId, agent.agent_row_id]);
      if (!agent.binding_id) {
        const result = await trx.run('INSERT INTO table_rows (table_id,base_id,data,created_by) VALUES (?,?,?,?)', [content.id, randomUUID(), JSON.stringify({
          kind: 'agent_binding', content_key: npc.key, content_version: 1, title: npc.name, status: 'active', payload: { agent_row_id: agent.agent_row_id },
        }), userId]);
        agent.binding_id = result.lastInsertRowid;
      }
    }
    apiLogger.info({ spaceId, projectId, agents: agents.map(a => a.agent_row_id) }, '[neo16] space NPC agents ready');
    return { dry_run: false, system_project: systemProject, tables, operator: { row_id: operator.id, provider: 'codex' }, agents };
  });
}
