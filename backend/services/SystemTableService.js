// System Table Service - Sync real database tables to universal_tables interface
import { dbAll, dbGet } from '../database/connection.js';

/**
 * Get data from real system tables and format as universal table rows
 * @param {string} syncTarget - The database table name (users, projects, etc.)
 * @returns {Promise<Array>} Array of rows in universal format
 */
export async function getSystemTableData(syncTarget, projectId) {
  if (!syncTarget) {
    throw new Error('sync_target is required for system tables');
  }

  // Derive space for per-space scoping (projects, tables, files, etc.)
  let spaceId = null;
  if (projectId) {
    const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [projectId]);
    spaceId = project?.space_id || null;
  }

  // Admin System Management (space_id=1) should see global stock for projects/tables
  const isAdminSystemSpace = spaceId === 1;

  switch (syncTarget) {
    case 'users':
      return await getUsersData();
    case 'projects':
      return await getProjectsData(spaceId, isAdminSystemSpace);
    case 'spaces':
      return await getSpacesData();
    case 'data_sources':
      return await getDataSourcesData();
    case 'universal_tables':
      return await getTablesData(spaceId, isAdminSystemSpace);
    case 'table_columns':
      return await getColumnsData();
    case 'table_rows':
      return await getRowsData();
    case 'audit_log':
      return await getAuditLogData();
    case 'system_settings':
      return await getSystemSettingsData();
    case 'files':
      return await getFilesData(spaceId);
    case 'storage_providers':
      return await getStorageProvidersData();
    case 'automations':
      return await getAutomationsData();
    case 'automation_logs':
      return await getAutomationLogsData();
    case 'widgets':
      return await getWidgetsData();
    case '_inflight_runs':
      return await getInflightRunsData(spaceId, isAdminSystemSpace);
    default:
      throw new Error(`Unknown sync_target: ${syncTarget}`);
  }
}

/**
 * Get columns definition for system table
 * @param {string} syncTarget - The database table name
 * @returns {Array} Array of column definitions
 */
export function getSystemTableColumns(syncTarget) {
  const columnsMap = {
    users: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, orderIndex: 0 },
      { id: 'email', name: 'email', displayName: 'Email', type: 'email', isRequired: true, orderIndex: 1 },
      { id: 'name', name: 'name', displayName: 'Name', type: 'text', isRequired: true, orderIndex: 2 },
      { id: 'role', name: 'role', displayName: 'Role', type: 'select', config: { options: [{ label: 'Owner', value: 'owner' }, { label: 'Admin', value: 'admin' }, { label: 'User', value: 'user' }] }, orderIndex: 3 },
      { id: 'password_hash', name: 'password_hash', displayName: 'Password', type: 'password', isReadonly: true, orderIndex: 4 },
      { id: 'email_verified', name: 'email_verified', displayName: 'Email Verified', type: 'checkbox', orderIndex: 5 },
      { id: 'user_type', name: 'user_type', displayName: 'User Type', type: 'select', config: { options: [{ label: 'Human', value: 'human' }, { label: 'Agent', value: 'agent' }, { label: 'Bot', value: 'bot' }, { label: 'Service', value: 'service' }] }, orderIndex: 6 },
      { id: 'managed_by_agent_table_id', name: 'managed_by_agent_table_id', displayName: 'Agent Table ID', type: 'number', isReadonly: true, orderIndex: 7 },
      { id: 'managed_by_agent_row_id', name: 'managed_by_agent_row_id', displayName: 'Agent Row ID', type: 'number', isReadonly: true, orderIndex: 8 },
      { id: 'created_at', name: 'created_at', displayName: 'Created At', type: 'datetime', orderIndex: 9 }
    ],
    projects: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, orderIndex: 0 },
      { id: 'name', name: 'name', displayName: 'Name', type: 'text', isRequired: true, orderIndex: 1 },
      { id: 'description', name: 'description', displayName: 'Description', type: 'text', orderIndex: 2 },
      { id: 'icon', name: 'icon', displayName: 'Icon', type: 'text', orderIndex: 3 },
      { id: 'type', name: 'type', displayName: 'Type', type: 'select', config: { options: [{ label: 'Admin Space', value: 'admin_owner_space' }, { label: 'Personal Space', value: 'personal_space' }, { label: 'Custom', value: 'custom' }] }, orderIndex: 4 },
      { id: 'owner_id', name: 'owner_id', displayName: 'Owner ID', type: 'number', orderIndex: 5 },
      { id: 'created_at', name: 'created_at', displayName: 'Created At', type: 'datetime', orderIndex: 6 }
    ],
    universal_tables: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, orderIndex: 0 },
      { id: 'project_id', name: 'project_id', displayName: 'Project ID', type: 'number', isRequired: true, orderIndex: 1 },
      { id: 'name', name: 'name', displayName: 'Name', type: 'text', isRequired: true, orderIndex: 2 },
      { id: 'description', name: 'description', displayName: 'Description', type: 'text', orderIndex: 3 },
      { id: 'icon', name: 'icon', displayName: 'Icon', type: 'text', orderIndex: 4 },
      { id: 'is_system', name: 'is_system', displayName: 'System Table', type: 'checkbox', orderIndex: 5 },
      { id: 'sync_target', name: 'sync_target', displayName: 'Sync Target', type: 'text', orderIndex: 6 }
    ],
    table_columns: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, orderIndex: 0 },
      { id: 'table_id', name: 'table_id', displayName: 'Table ID', type: 'number', isRequired: true, orderIndex: 1 },
      { id: 'column_name', name: 'column_name', displayName: 'Column Name', type: 'text', isRequired: true, orderIndex: 2 },
      { id: 'display_name', name: 'display_name', displayName: 'Display Name', type: 'text', orderIndex: 3 },
      { id: 'type', name: 'type', displayName: 'Type', type: 'text', orderIndex: 4 },
      { id: 'is_required', name: 'is_required', displayName: 'Required', type: 'checkbox', orderIndex: 5 }
    ],
    table_rows: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, orderIndex: 0 },
      { id: 'table_id', name: 'table_id', displayName: 'Table ID', type: 'number', isRequired: true, orderIndex: 1 },
      { id: 'base_id', name: 'base_id', displayName: 'Base ID', type: 'text', isRequired: true, orderIndex: 2 },
      { id: 'data', name: 'data', displayName: 'Data (JSON)', type: 'text', orderIndex: 3 },
      { id: 'created_by', name: 'created_by', displayName: 'Created By', type: 'number', orderIndex: 4 }
    ],
    audit_log: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, orderIndex: 0 },
      { id: 'user_id', name: 'user_id', displayName: 'User ID', type: 'number', orderIndex: 1 },
      { id: 'action', name: 'action', displayName: 'Action', type: 'text', orderIndex: 2 },
      { id: 'entity_type', name: 'entity_type', displayName: 'Entity Type', type: 'text', orderIndex: 3 },
      { id: 'entity_id', name: 'entity_id', displayName: 'Entity ID', type: 'text', orderIndex: 4 },
      { id: 'created_at', name: 'created_at', displayName: 'Created At', type: 'datetime', orderIndex: 5 }
    ],
    system_settings: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, orderIndex: 0 },
      { id: 'key', name: 'key', displayName: 'Key', type: 'text', isRequired: true, orderIndex: 1 },
      { id: 'value', name: 'value', displayName: 'Value', type: 'text', orderIndex: 2 },
      { id: 'category', name: 'category', displayName: 'Category', type: 'text', orderIndex: 3 }
    ],
    spaces: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, orderIndex: 0 },
      { id: 'name', name: 'name', displayName: 'Name', type: 'text', isRequired: true, orderIndex: 1 },
      { id: 'slug', name: 'slug', displayName: 'Slug', type: 'text', orderIndex: 2 },
      { id: 'owner_id', name: 'owner_id', displayName: 'Owner', type: 'relation', orderIndex: 3 },
      { id: 'settings', name: 'settings', displayName: 'Settings', type: 'text', orderIndex: 4 },
      { id: 'created_at', name: 'created_at', displayName: 'Created At', type: 'datetime', orderIndex: 5 },
      { id: 'updated_at', name: 'updated_at', displayName: 'Updated At', type: 'datetime', orderIndex: 6 }
    ],
    // ADR-0063-A §3-rev — universal pause registry. 10 visible cols (metadata
    // intentionally hidden — JSONB internals). Status is a select for the
    // 4-value lifecycle; reason stays open-text so the taxonomy can grow
    // without a migration (see markPaused.js header).
    _inflight_runs: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, isReadonly: true, orderIndex: 0 },
      { id: 'ticket_id', name: 'ticket_id', displayName: 'Ticket', type: 'number', isReadonly: true, orderIndex: 1 },
      { id: 'agent_slug', name: 'agent_slug', displayName: 'Agent', type: 'text', isRequired: true, isReadonly: true, orderIndex: 2 },
      { id: 'conversation_id', name: 'conversation_id', displayName: 'Conversation', type: 'number', isReadonly: true, orderIndex: 3 },
      { id: 'started_at', name: 'started_at', displayName: 'Started', type: 'datetime', isReadonly: true, orderIndex: 4 },
      { id: 'last_step_id', name: 'last_step_id', displayName: 'Last Step', type: 'number', isReadonly: true, orderIndex: 5 },
      { id: 'status', name: 'status', displayName: 'Status', type: 'select', config: { options: [{ label: 'Running', value: 'running' }, { label: 'Paused', value: 'paused' }, { label: 'Done', value: 'done' }, { label: 'Failed', value: 'failed' }] }, isReadonly: true, orderIndex: 6 },
      { id: 'reason', name: 'reason', displayName: 'Reason', type: 'text', isReadonly: true, orderIndex: 7 },
      { id: 'resume_at', name: 'resume_at', displayName: 'Resume At', type: 'datetime', isReadonly: true, orderIndex: 8 },
      { id: 'resume_attempts', name: 'resume_attempts', displayName: 'Attempts', type: 'number', isReadonly: true, orderIndex: 9 }
    ],
    // ADR-0012 Phase 8.2 — global template view (one row per preset_name).
    // Lists template widgets only (is_template=true). Per-document instance
    // widgets (legacy) are deliberately excluded from this view.
    widgets: [
      { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, isReadonly: true, orderIndex: 0 },
      { id: 'preset_name', name: 'preset_name', displayName: 'Preset', type: 'text', isRequired: true, isReadonly: true, orderIndex: 1 },
      { id: 'title', name: 'title', displayName: 'Title', type: 'text', orderIndex: 2 },
      { id: 'icon', name: 'icon', displayName: 'Icon', type: 'text', orderIndex: 3 },
      { id: 'description', name: 'description', displayName: 'Description', type: 'text', orderIndex: 4 },
      { id: 'config', name: 'config', displayName: 'Config', type: 'json', orderIndex: 5 },
      { id: 'widget_type', name: 'widget_type', displayName: 'Type', type: 'text', isReadonly: true, orderIndex: 6 },
      { id: 'created_at', name: 'created_at', displayName: 'Created At', type: 'datetime', isReadonly: true, orderIndex: 7 },
      { id: 'updated_at', name: 'updated_at', displayName: 'Updated At', type: 'datetime', isReadonly: true, orderIndex: 8 }
    ]
  };

  return columnsMap[syncTarget] || [];
}

// Data fetchers for each system table
async function getUsersData() {
  const users = await dbAll('SELECT id, email, name, role, password_hash, email_verified, user_type, managed_by_agent_table_id, managed_by_agent_row_id, created_at FROM users ORDER BY id');
  return users.map(u => ({
    id: `user-${u.id}`,
    base_id: `USER${String(u.id).padStart(4, '0')}`,
    data: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      password_hash: u.password_hash ? '••••••••' : null, // Show indicator, not actual hash
      email_verified: u.email_verified,
      user_type: u.user_type || 'human',
      managed_by_agent_table_id: u.managed_by_agent_table_id || null,
      managed_by_agent_row_id: u.managed_by_agent_row_id || null,
      created_at: u.created_at
    },
    created_at: u.created_at,
    updated_at: u.created_at,
    created_by: 'system'
  }));
}

async function getProjectsData(spaceId, isAdminSystemSpace = false) {
  const query = spaceId && !isAdminSystemSpace
    ? 'SELECT id, name, description, icon, type, owner_id, space_id, theme_primary, created_at FROM projects WHERE space_id = ? ORDER BY id'
    : 'SELECT id, name, description, icon, type, owner_id, space_id, theme_primary, created_at FROM projects ORDER BY id';

  const params = spaceId && !isAdminSystemSpace ? [spaceId] : [];
  const projects = await dbAll(query, params);
  return projects.map(p => ({
    id: `project-${p.id}`,
    base_id: `PROJ${String(p.id).padStart(4, '0')}`,
    data: {
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      type: p.type,
      owner_id: p.owner_id,
      space_id: p.space_id,
      theme_primary: p.theme_primary,
      created_at: p.created_at
    },
    created_at: p.created_at,
    updated_at: p.created_at,
    created_by: 'system'
  }));
}

async function getSpacesData() {
  const spaces = await dbAll('SELECT id, name, description, icon, type, owner_id, theme_primary, theme_secondary, created_at, updated_at FROM spaces ORDER BY id');
  return spaces.map(s => ({
    id: `space-${s.id}`,
    base_id: `SPC${String(s.id).padStart(4, '0')}`,
    data: {
      id: s.id,
      name: s.name,
      description: s.description,
      icon: s.icon,
      type: s.type,
      owner_id: s.owner_id,
      theme_primary: s.theme_primary,
      theme_secondary: s.theme_secondary,
      created_at: s.created_at
    },
    created_at: s.created_at,
    updated_at: s.updated_at,
    created_by: 'system'
  }));
}

async function getDataSourcesData() {
  const sources = await dbAll('SELECT id, name, type, db_host, db_port, db_name, db_username, last_test_status, sync_enabled, last_sync_at, created_at FROM data_sources ORDER BY created_at DESC');
  return sources.map(ds => ({
    id: `ds-${ds.id}`,
    base_id: `DS${String(ds.id).substring(0, 8).toUpperCase()}`,
    data: {
      id: ds.id,
      name: ds.name,
      type: ds.type,
      db_host: ds.db_host,
      db_port: ds.db_port,
      db_name: ds.db_name,
      db_username: ds.db_username,
      last_test_status: ds.last_test_status,
      sync_enabled: ds.sync_enabled,
      last_sync_at: ds.last_sync_at,
      created_at: ds.created_at
    },
    created_at: ds.created_at,
    updated_at: ds.created_at,
    created_by: 'system'
  }));
}

async function getTablesData(spaceId, isAdminSystemSpace = false) {
  const query = spaceId && !isAdminSystemSpace
    ? `
      SELECT ut.* 
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ?
      ORDER BY ut.id
    `
    : 'SELECT * FROM universal_tables ORDER BY id';

  const params = spaceId && !isAdminSystemSpace ? [spaceId] : [];
  const tables = await dbAll(query, params);
  return tables.map(t => ({
    id: `table-${t.id}`,
    base_id: `TBL${String(t.id).padStart(5, '0')}`,
    data: {
      id: t.id,
      project_id: t.project_id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      is_system: t.is_system,
      sync_target: t.sync_target
    },
    created_at: t.created_at,
    updated_at: t.updated_at,
    created_by: 'system'
  }));
}

async function getColumnsData() {
  const columns = await dbAll('SELECT * FROM table_columns ORDER BY table_id, order_index');
  return columns.map(c => ({
    id: `column-${c.id}`,
    base_id: `COL${String(c.id).padStart(5, '0')}`,
    data: {
      id: c.id,
      table_id: c.table_id,
      column_name: c.column_name,
      display_name: c.display_name,
      type: c.type,
      is_required: c.is_required
    },
    created_at: c.created_at,
    updated_at: c.updated_at,
    created_by: 'system'
  }));
}

async function getRowsData() {
  const rows = await dbAll('SELECT id, table_id, base_id, data, created_by, created_at FROM table_rows ORDER BY id LIMIT 100');
  return rows.map(r => ({
    id: `row-${r.id}`,
    base_id: r.base_id,
    data: {
      id: r.id,
      table_id: r.table_id,
      base_id: r.base_id,
      data: r.data,
      created_by: r.created_by
    },
    created_at: r.created_at,
    updated_at: r.created_at,
    created_by: r.created_by
  }));
}

async function getAuditLogData() {
  const logs = await dbAll('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100');
  return logs.map(l => ({
    id: `audit-${l.id}`,
    base_id: `AUD${String(l.id).padStart(6, '0')}`,
    data: {
      id: l.id,
      user_id: l.user_id,
      action: l.action,
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      created_at: l.created_at
    },
    created_at: l.created_at,
    updated_at: l.created_at,
    created_by: l.user_id
  }));
}

async function getSystemSettingsData() {
  const settings = await dbAll('SELECT * FROM system_settings ORDER BY category, key');
  return settings.map(s => ({
    id: `setting-${s.id}`,
    base_id: `SET${String(s.id).padStart(5, '0')}`,
    data: {
      id: s.id,
      key: s.key,
      value: s.value,
      category: s.category
    },
    created_at: s.created_at,
    updated_at: s.updated_at,
    created_by: 'system'
  }));
}

async function getFilesData(spaceId) {
  let query = `
    SELECT f.*, u.name as uploaded_by_name 
    FROM files f 
    LEFT JOIN users u ON f.uploaded_by = u.id 
  `;
  const params = [];
  if (spaceId) {
    query += ' WHERE f.space_id = ?';
    params.push(spaceId);
  }
  query += ' ORDER BY f.created_at DESC';

  const files = await dbAll(query, params);
  return files.map(f => ({
    id: `file-${f.id}`,
    base_id: f.id,
    data: {
      id: f.id,
      name: f.name,
      original_name: f.original_name,
      mime_type: f.mime_type,
      size: f.size,
      url: f.url,
      space_id: f.space_id,
      project_id: f.project_id,
      uploaded_by: f.uploaded_by_name || f.uploaded_by,
      storage_provider_id: f.storage_provider_id,
      description: f.description,
      created_at: f.created_at,
      updated_at: f.updated_at
    },
    created_at: f.created_at,
    updated_at: f.updated_at,
    created_by: f.uploaded_by
  }));
}

async function getStorageProvidersData() {
  const providers = await dbAll('SELECT * FROM storage_providers ORDER BY is_default DESC, name ASC');
  return providers.map(p => ({
    id: `provider-${p.id}`,
    base_id: p.id,
    data: {
      id: p.id,
      name: p.name,
      type: p.type,
      is_default: p.is_default,
      is_enabled: p.is_enabled,
      config: p.config,
      created_at: p.created_at,
      updated_at: p.updated_at
    },
    created_at: p.created_at,
    updated_at: p.updated_at,
    created_by: 'system'
  }));
}

async function getAutomationsData() {
  const automations = await dbAll(`
    SELECT a.*, t.name as table_name 
    FROM automations a 
    LEFT JOIN universal_tables t ON a.table_id = t.id 
    ORDER BY a.created_at DESC
  `);
  
  // Get last run info for each automation
  const lastRuns = await dbAll(`
    SELECT automation_id, MAX(executed_at) as last_run, COUNT(*) as run_count
    FROM automation_logs
    GROUP BY automation_id
  `);
  const runMap = new Map(lastRuns.map(r => [r.automation_id, r]));
  
  return automations.map(a => {
    const runInfo = runMap.get(a.id) || { last_run: null, run_count: 0 };
    return {
      id: `automation-${a.id}`,
      base_id: a.id,
      data: {
        id: a.id,
        name: a.name,
        description: a.description,
        table_id: a.table_id,
        table_name: a.table_name,
        trigger_type: a.trigger_type,
        action_type: a.action_type,
        is_active: Boolean(a.is_active),
        trigger_config: a.trigger_config,
        action_config: a.action_config,
        last_run: runInfo.last_run,
        run_count: runInfo.run_count,
        created_at: a.created_at
      },
      created_at: a.created_at,
      updated_at: a.updated_at,
      created_by: 'system'
    };
  });
}

// ADR-0012 Phase 8.2 — global widget templates (one row per preset).
// Returns ONLY rows where is_template=true. Doc-owned instance widgets
// stay invisible to this view (they migrate to per-doc atom rows during
// Phase 8.4). No per-space scoping: templates are a global registry,
// every space sees the same 8 rows.
async function getWidgetsData() {
  const widgets = await dbAll(`
    SELECT id, preset_name, widget_type, title, description, icon,
           config, position, source_widget_id, owner_kind, owner_id,
           created_at, updated_at
    FROM widgets
    WHERE is_template = true
    ORDER BY preset_name
  `);
  return widgets.map(w => {
    let configValue = w.config;
    try { configValue = w.config ? JSON.parse(w.config) : {}; }
    catch { /* keep raw text on parse failure */ }

    return {
      id: `widget-${w.id}`,
      base_id: `WGT${String(w.id).padStart(5, '0')}`,
      data: {
        id: w.id,
        preset_name: w.preset_name,
        widget_type: w.widget_type,
        title: w.title,
        description: w.description,
        icon: w.icon,
        config: configValue,
        created_at: w.created_at,
        updated_at: w.updated_at
      },
      created_at: w.created_at,
      updated_at: w.updated_at,
      created_by: 'system'
    };
  });
}

// ADR-0063-A §3-rev — surface the universal pause registry through the
// is_system+sync_target pattern. Space filter: admin (project in space 1)
// sees global; everyone else sees rows whose conversation belonged to their
// space, recorded as `metadata.space_id` by markPaused() (Option A — no
// join through 1784, see [[project_agent_slug_routing]]).
//
// ADR-0063-A §P3 — exported as the single source-of-truth for the scope
// filter so the `query_inflight_paused` MCP tool (used by the watchdog)
// builds the same WHERE clause. Pass `{ status, agent_slug, conversation_id,
// limit }` to reuse the predicate from the non-universal-wrapped path.
export async function queryInflightRuns({
  spaceId = null,
  isAdminSystemSpace = false,
  status = null,
  agent_slug = null,
  conversation_id = null,
  limit = 1000,
} = {}) {
  const clauses = [];
  const params = [];
  if (spaceId && !isAdminSystemSpace) {
    clauses.push(`(metadata->>'space_id')::int = ?`);
    params.push(spaceId);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (agent_slug) {
    clauses.push('agent_slug = ?');
    params.push(agent_slug);
  }
  if (conversation_id != null) {
    clauses.push('conversation_id = ?');
    params.push(conversation_id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 1000, 1000));
  params.push(cappedLimit);
  const sql = `
    SELECT id, ticket_id, agent_slug, conversation_id, started_at, last_step_id,
           status, reason, resume_at, resume_attempts, metadata, updated_at
    FROM _inflight_runs
    ${where}
    ORDER BY started_at DESC
    LIMIT ?
  `;
  return await dbAll(sql, params);
}

async function getInflightRunsData(spaceId, isAdminSystemSpace = false) {
  const rows = await queryInflightRuns({ spaceId, isAdminSystemSpace, limit: 1000 });
  return rows.map(r => ({
    id: `inflight-${r.id}`,
    base_id: `IFR${String(r.id).padStart(6, '0')}`,
    data: {
      id: r.id,
      ticket_id: r.ticket_id,
      agent_slug: r.agent_slug,
      conversation_id: r.conversation_id,
      started_at: r.started_at,
      last_step_id: r.last_step_id,
      status: r.status,
      reason: r.reason,
      resume_at: r.resume_at,
      resume_attempts: r.resume_attempts
    },
    created_at: r.started_at,
    updated_at: r.updated_at,
    created_by: 'system'
  }));
}

async function getAutomationLogsData() {
  const logs = await dbAll(`
    SELECT l.*, a.name as automation_name 
    FROM automation_logs l 
    LEFT JOIN automations a ON l.automation_id = a.id 
    ORDER BY l.executed_at DESC
    LIMIT 1000
  `);
  return logs.map(l => ({
    id: `log-${l.id}`,
    base_id: l.id,
    data: {
      id: l.id,
      automation_id: l.automation_id,
      automation_name: l.automation_name,
      status: l.status,
      trigger_data: l.trigger_data,
      result_data: l.result_data,
      error_message: l.error_message,
      duration_ms: l.duration_ms,
      executed_at: l.executed_at
    },
    created_at: l.executed_at,
    updated_at: l.executed_at,
    created_by: 'system'
  }));
}
