import { dbAll, dbGet, safeJsonParse } from '../database/connection.js';
import { generateBaseId } from '../utils/baseId.js';
import { getAgentTableIds } from './agentTableResolver.js';
import { vaultSecretRef } from './connectors/remoteConnectorRuntime.js';

const componentTag = (blueprint, key, kind) => ({ key: blueprint.key, component_key: key, kind });
const isOwned = (data, blueprint, key, kind) => {
  const tag = safeJsonParse(data, {})?.__module;
  return tag?.key === blueprint.key && tag?.component_key === key && tag?.kind === kind;
};

function desiredServiceDefinition(service, blueprint, bindings) {
  const secretRefs = Object.fromEntries((service.secrets || []).map((name) => [name, bindings.secrets?.[name]]));
  return {
    url: service.url,
    allowed_tools: service.allowed_tools || [],
    secret_refs: secretRefs,
    __module: componentTag(blueprint, service.key, 'service'),
  };
}

function sameServiceDefinition(current, desired) {
  return current.url === desired.url
    && JSON.stringify(current.allowed_tools || []) === JSON.stringify(desired.allowed_tools)
    && JSON.stringify(current.secret_refs || {}) === JSON.stringify(desired.secret_refs);
}

async function planServices(blueprint, spaceId, bindings, conflicts) {
  const specs = blueprint.services || [];
  if (!specs.length) return { services: [], changes: 0 };
  const declaredSecrets = new Set(specs.flatMap((service) => service.secrets || []));
  for (const key of Object.keys(bindings.secrets || {})) {
    if (!declaredSecrets.has(key)) conflicts.push({ kind: 'UNKNOWN_SECRET_BINDING', secret: key, blocking: true });
  }
  for (const service of specs) {
    for (const name of service.secrets || []) {
      const ref = bindings.secrets?.[name];
      if (!ref) {
        conflicts.push({ kind: 'SERVICE_SECRET_UNBOUND', service: service.key, secret: name, blocking: true });
        continue;
      }
      const stored = await dbGet('SELECT id FROM _secrets WHERE key = ? AND space_id = ?', [name, spaceId]);
      if (!stored) conflicts.push({ kind: 'SERVICE_SECRET_NOT_FOUND', service: service.key, secret: name, blocking: true });
    }
  }

  const rows = await dbAll(
    `SELECT id, space_id, status, custom_definition FROM space_connectors
      WHERE space_id = ? AND kind = 'mcp' AND status <> 'revoked'`,
    [spaceId],
  );
  const services = specs.map((service) => {
    const desired = desiredServiceDefinition(service, blueprint, bindings);
    const existing = rows.find((row) => isOwned(safeJsonParse(row.custom_definition, {}), blueprint, service.key, 'service'));
    return {
      key: service.key,
      connector_id: existing?.id ?? null,
      allowed_tools: service.allowed_tools || [],
      secrets: service.secrets || [],
      action: !existing ? 'create' : existing.status === 'active' && sameServiceDefinition(safeJsonParse(existing.custom_definition, {}), desired) ? 'existing' : 'update',
    };
  });
  return { services, changes: services.filter((service) => service.action !== 'existing').length };
}

function agentData(spec, blueprint) {
  const { key, config, ...fields } = spec;
  delete fields.table;
  delete fields.columnRefPaths;
  return {
    ...(config || {}),
    ...fields,
    name: fields.name || config?.name || key,
    __module: componentTag(blueprint, key, 'agent'),
  };
}

async function planAgents(blueprint, spaceId, plannedTables, conflicts) {
  const specs = blueprint.agents || [];
  if (!specs.length) return { agents: [], changes: 0 };
  const ownedRegistry = blueprint.tables.find((table) => table.table_type === 'ai_agents');
  const plannedRegistry = ownedRegistry && plannedTables.find((table) => table.key === ownedRegistry.key);
  const registryIds = await getAgentTableIds({ spaceId });
  if (plannedRegistry?.table_id) registryIds.push(plannedRegistry.table_id);
  if (!plannedRegistry && registryIds.length === 0) {
    conflicts.push({ kind: 'AGENT_REGISTRY_NOT_FOUND', blocking: true });
  } else if (plannedRegistry?.action === 'skip') {
    conflicts.push({ kind: 'AGENT_REGISTRY_NOT_FOUND', table: plannedRegistry.key, blocking: true });
  }
  const ids = [...new Set(registryIds)];
  const rows = ids.length
    ? await dbAll('SELECT id, table_id, data FROM table_rows WHERE table_id = ANY(?)', [ids])
    : [];
  const agents = specs.map((spec) => {
    const existing = rows.find((row) => isOwned(row.data, blueprint, spec.key, 'agent'));
    return {
      key: spec.key,
      table: spec.table || null,
      config: spec.config || {},
      name: agentData(spec, blueprint).name,
      tools: spec.tools || spec.config?.tools || [],
      table_id: existing?.table_id ?? plannedRegistry?.table_id ?? ids[0] ?? null,
      row_id: existing?.id ?? null,
      action: existing ? 'existing' : 'create',
    };
  });
  return { agents, changes: agents.filter((agent) => agent.action === 'create').length };
}

async function automationRegistry(spaceId) {
  const project = await dbGet("SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'", [spaceId]);
  if (!project) return { project_id: null, table_id: null, rows: [] };
  const table = await dbGet("SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automations_list'", [project.id]);
  if (!table) return { project_id: project.id, table_id: null, rows: [] };
  const rows = await dbAll('SELECT id, table_id, data FROM table_rows WHERE table_id = ?', [table.id]);
  return { project_id: project.id, table_id: table.id, rows };
}

function automationData(spec, blueprint, mapping = null) {
  const { key, table, config, ...fields } = spec;
  delete fields.columnRefPaths;
  return {
    ...(config || {}),
    ...fields,
    name: fields.name || config?.name || key,
    ...(table ? { table_id: mapping?.[table]?.table_id ?? null } : {}),
    __module: componentTag(blueprint, key, 'automation'),
  };
}

async function planAutomations(blueprint, spaceId, plannedTables, mapping, conflicts) {
  const specs = blueprint.automations || [];
  if (!specs.length) return { automations: [], changes: 0 };
  const registry = await automationRegistry(spaceId);
  const automations = specs.map((spec) => {
    const plannedTable = plannedTables.find((table) => table.key === spec.table);
    if (spec.table && (!plannedTable || (plannedTable.action !== 'create' && !mapping[spec.table]))) {
      conflicts.push({ kind: 'AUTOMATION_TABLE_UNBOUND', automation: spec.key, table: spec.table, blocking: true });
    }
    const existing = registry.rows.find((row) => isOwned(row.data, blueprint, spec.key, 'automation'));
    return {
      key: spec.key,
      table: spec.table || null,
      config: spec.config || {},
      name: automationData(spec, blueprint).name,
      registry_table_id: registry.table_id,
      row_id: existing?.id ?? null,
      action: existing ? 'existing' : 'create',
    };
  });
  return {
    automations,
    changes: automations.filter((automation) => automation.action === 'create').length + (registry.table_id ? 0 : 1),
  };
}

export async function planModuleComponents({ blueprint, spaceId, bindings, plannedTables, tableMapping }) {
  const conflicts = [];
  const services = await planServices(blueprint, spaceId, bindings, conflicts);
  const agents = await planAgents(blueprint, spaceId, plannedTables, conflicts);
  const automations = await planAutomations(blueprint, spaceId, plannedTables, tableMapping, conflicts);
  return {
    services: services.services,
    agents: agents.agents,
    automations: automations.automations,
    conflicts,
    changes: services.changes + agents.changes + automations.changes,
  };
}

async function applyServices(blueprint, spaceId, userId, bindings, plan, trx) {
  const results = [];
  for (const service of blueprint.services || []) {
    const planned = plan.services.find((candidate) => candidate.key === service.key);
    const definition = desiredServiceDefinition(service, blueprint, bindings);
    for (const name of service.secrets || []) {
      const stored = await trx.get('SELECT id FROM _secrets WHERE key = ? AND space_id = ?', [name, spaceId]);
      if (!stored || definition.secret_refs[name] !== vaultSecretRef(name)) {
        const err = new Error(`Service secret "${name}" is not available in this space vault`);
        err.code = 'SERVICE_SECRET_NOT_FOUND';
        throw err;
      }
    }
    if (planned.action === 'create') {
      const inserted = await trx.run(
        `INSERT INTO space_connectors
          (space_id, type_slug, kind, display_name, status, encrypted_payload, custom_definition, created_by)
         VALUES (?, ?, 'mcp', ?, 'active', '{}'::jsonb, ?::jsonb, ?) RETURNING id`,
        [spaceId, service.type_slug === 'remote_mcp' ? 'custom_mcp' : service.type_slug, service.key, JSON.stringify(definition), userId],
      );
      results.push({ key: service.key, connector_id: inserted.lastInsertRowid, action: 'created' });
    } else {
      await trx.run(
        `UPDATE space_connectors SET status = 'active', encrypted_payload = '{}'::jsonb,
          custom_definition = ?::jsonb, updated_at = NOW() WHERE id = ? AND space_id = ?`,
        [JSON.stringify(definition), planned.connector_id, spaceId],
      );
      results.push({ key: service.key, connector_id: planned.connector_id, action: planned.action === 'update' ? 'updated' : 'existing' });
    }
  }
  return results;
}

async function applyAgents(blueprint, spaceId, userId, mapping, plan, trx) {
  const results = [];
  if (!(blueprint.agents || []).length) return results;
  const ownedRegistry = blueprint.tables.find((table) => table.table_type === 'ai_agents');
  const registryIds = ownedRegistry ? [] : await getAgentTableIds({ spaceId });
  for (const spec of blueprint.agents || []) {
    const planned = plan.agents.find((candidate) => candidate.key === spec.key);
    if (planned.action === 'existing') {
      results.push({ key: spec.key, row_id: planned.row_id, table_id: planned.table_id, action: 'existing' });
      continue;
    }
    const tableId = ownedRegistry ? mapping[ownedRegistry.key]?.table_id : planned.table_id ?? registryIds[0];
    if (!tableId) throw new Error('AI Agents registry is not available');
    const inserted = await trx.run(
      'INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW()) RETURNING id',
      [tableId, generateBaseId('agent'), JSON.stringify(agentData(spec, blueprint)), userId],
    );
    results.push({ key: spec.key, row_id: inserted.lastInsertRowid, table_id: tableId, action: 'created' });
  }
  return results;
}

const AUTOMATION_COLUMNS = [
  ['name', 'Name', 'text'], ['description', 'Description', 'text'], ['table_id', 'Table ID', 'number'],
  ['table_name', 'Table', 'text'], ['trigger_type', 'Trigger', 'select'], ['action_type', 'Action', 'select'],
  ['is_active', 'Active', 'checkbox'], ['trigger_config', 'Trigger Config', 'text'], ['action_config', 'Action Config', 'text'],
  ['last_run', 'Last Run', 'date'], ['run_count', 'Run Count', 'number'], ['created_at', 'Created At', 'date'],
];
const AUTOMATION_LOG_COLUMNS = [
  ['automation_id', 'Automation ID', 'number'], ['automation_name', 'Automation', 'text'], ['status', 'Status', 'select'],
  ['trigger_data', 'Trigger Data', 'text'], ['result_data', 'Result', 'text'], ['error_message', 'Error', 'text'],
  ['duration_ms', 'Duration (ms)', 'number'], ['executed_at', 'Executed At', 'date'],
];

async function ensureAutomationRegistry(spaceId, userId, trx) {
  let project = await trx.get("SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'", [spaceId]);
  if (!project) {
    const inserted = await trx.run(
      "INSERT INTO projects (space_id, name, owner_id, type) VALUES (?, 'System Data', ?, 'system_data') RETURNING id",
      [spaceId, userId],
    );
    project = { id: inserted.lastInsertRowid };
  }
  const ids = {};
  for (const [name, displayName, columns] of [
    ['automations_list', 'Automations', AUTOMATION_COLUMNS],
    ['automation_logs_list', 'Automation Logs', AUTOMATION_LOG_COLUMNS],
  ]) {
    let table = await trx.get('SELECT id FROM universal_tables WHERE project_id = ? AND name = ?', [project.id, name]);
    if (!table) {
      const inserted = await trx.run(
        'INSERT INTO universal_tables (project_id, name, display_name) VALUES (?, ?, ?) RETURNING id',
        [project.id, name, displayName],
      );
      table = { id: inserted.lastInsertRowid };
      for (const [index, [columnName, columnTitle, type]] of columns.entries()) {
        await trx.run(
          'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, ?, ?, ?, ?, 1)',
          [table.id, columnName, columnTitle, type, index],
        );
      }
    }
    ids[name] = table.id;
  }
  return ids.automations_list;
}

async function applyAutomations(blueprint, spaceId, userId, mapping, plan, trx) {
  const results = [];
  if (!(blueprint.automations || []).length) return results;
  const registryTableId = await ensureAutomationRegistry(spaceId, userId, trx);
  for (const spec of blueprint.automations) {
    const planned = plan.automations.find((candidate) => candidate.key === spec.key);
    if (planned.action === 'existing') {
      results.push({ key: spec.key, row_id: planned.row_id, action: 'existing' });
      continue;
    }
    const data = automationData(spec, blueprint, mapping);
    data.table_name = data.table_id
      ? (await trx.get('SELECT name FROM universal_tables WHERE id = ?', [data.table_id]))?.name || ''
      : '';
    const inserted = await trx.run(
      'INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW()) RETURNING id',
      [registryTableId, generateBaseId('auto'), JSON.stringify(data), userId],
    );
    results.push({ key: spec.key, row_id: inserted.lastInsertRowid, action: 'created' });
  }
  return results;
}

export async function applyModuleComponents({ blueprint, spaceId, userId, bindings, mapping, plan, trx }) {
  const services = await applyServices(blueprint, spaceId, userId, bindings, plan, trx);
  const agents = await applyAgents(blueprint, spaceId, userId, mapping, plan, trx);
  const automations = await applyAutomations(blueprint, spaceId, userId, mapping, plan, trx);
  return { services, agents, automations };
}

export async function uninstallModuleComponents({ blueprint, spaceId, trx }) {
  const connectors = await trx.all(
    `SELECT id, custom_definition FROM space_connectors
      WHERE space_id = ? AND kind = 'mcp' AND status <> 'revoked'`,
    [spaceId],
  );
  const services = [];
  for (const connector of connectors) {
    const definition = safeJsonParse(connector.custom_definition, {});
    if (definition.__module?.key !== blueprint.key || definition.__module?.kind !== 'service') continue;
    await trx.run("UPDATE space_connectors SET status = 'disabled', updated_at = NOW() WHERE id = ?", [connector.id]);
    services.push({ connector_id: connector.id, status: 'disabled' });
  }

  const rows = await trx.all(
    `SELECT tr.id, tr.data FROM table_rows tr
     JOIN universal_tables ut ON ut.id = tr.table_id
     JOIN projects p ON p.id = ut.project_id WHERE p.space_id = ?`,
    [spaceId],
  );
  const agents = [];
  const automations = [];
  for (const row of rows) {
    const tag = safeJsonParse(row.data, {})?.__module;
    if (tag?.key !== blueprint.key || !['agent', 'automation'].includes(tag?.kind)) continue;
    await trx.run('DELETE FROM table_rows WHERE id = ?', [row.id]);
    (tag.kind === 'agent' ? agents : automations).push({ row_id: row.id });
  }
  return { services, agents, automations };
}
