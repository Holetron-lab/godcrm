// System Tables Creation Service - v0.002.008
// ADR-026: Added Variables table for formulas and aggregations
import { dbRun, dbGet, toBool } from '../database/connection.js';

/**
 * Create system tables for Admin Owner's Space
 * @param {number} projectId - Admin Owner's Space project ID
 */
export async function createSystemTables(projectId) {
  await createUsersSystemTable(projectId);
  await createProjectsSystemTable(projectId);
  await createTablesSystemTable(projectId);
  await createFilesSystemTable(projectId);
  await createStorageProvidersSystemTable(projectId);
  await createBugsTable(projectId);
}

/**
 * Create Variables table for Space (ADR-026)
 * Stores calculated variables with formulas for tables and dashboards
 * @param {number} projectId - Project ID where to create the table
 * @returns {Promise<number>} Created table ID
 */
export async function createVariablesTable(projectId) {
  // Create table
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Variables', 'Space calculated variables', '🧮', toBool(false)]);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create columns per ADR-026 specification
  const columns = [
    { 
      name: 'name', 
      display: 'Name', 
      type: 'text', 
      order: 0, 
      is_required: 1,
      config: { placeholder: '$my_variable' }
    },
    { 
      name: 'scope_type', 
      display: 'Scope', 
      type: 'select', 
      order: 1, 
      is_required: 1,
      config: {
        options: [
          { label: '🌍 Space', value: 'space', color: '#3b82f6' },
          { label: '📊 Table', value: 'table', color: '#10b981' },
          { label: '📈 Dashboard', value: 'dashboard', color: '#8b5cf6' }
        ]
      }
    },
    { 
      name: 'scope_ref', 
      display: 'Applies To', 
      type: 'relation',
      order: 2,
      config: { 
        conditional_relation: true // Dynamic: Tables or Dashboards based on scope_type
      }
    },
    { 
      name: 'formula', 
      display: 'Formula', 
      type: 'textarea',
      order: 3,
      config: { multiline: true, placeholder: 'SUM({{amount}}) or $other_var * 2' }
    },
    { 
      name: 'description', 
      display: 'Description', 
      type: 'textarea',
      order: 4
    },
    { 
      name: 'stream_id', 
      display: 'Stream', 
      type: 'number', 
      order: 5,
      config: { default: 1, min: 1, max: 10 }
    },
    { 
      name: 'order_index', 
      display: 'Order', 
      type: 'number',
      order: 6,
      is_system: true
    },
    { 
      name: 'cached_value', 
      display: 'Current Value', 
      type: 'text', 
      order: 7,
      is_system: true
    },
    { 
      name: 'cached_at', 
      display: 'Cached At', 
      type: 'datetime', 
      order: 8,
      is_system: true
    },
    { 
      name: 'dependencies', 
      display: 'Dependencies', 
      type: 'json',
      order: 9,
      is_system: true
    }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Password Manager table for Personal Space
 * @param {number} projectId - Project ID where to create the table
 */
export async function createPasswordManagerTable(projectId) {
  // Create table
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Password Manager', 'Secure password storage', '🔐', toBool(false)]);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create columns
  const columns = [
    { name: 'title', display: 'Название', type: 'text', order: 0, is_required: 1 },
    { name: 'username', display: 'Логин', type: 'text', order: 1 },
    { name: 'password', display: 'Пароль', type: 'password', order: 2 },
    { name: 'url', display: 'URL', type: 'url', order: 3 },
    { name: 'category', display: 'Категория', type: 'select', order: 4, config: {
      options: [
        { label: 'Работа', value: 'work' },
        { label: 'Личное', value: 'personal' },
        { label: 'Финансы', value: 'finance' },
        { label: 'Социальные сети', value: 'social' },
        { label: 'Другое', value: 'other' }
      ]
    }},
    { name: 'notes', display: 'Заметки', type: 'textarea', order: 5 },
    { name: 'created_at', display: 'Создано', type: 'datetime', order: 6, is_system: true },
    { name: 'updated_at', display: 'Обновлено', type: 'datetime', order: 7, is_system: true }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Databases table for Data Sources project
 * @param {number} projectId - Project ID where to create the table
 */
export async function createDatabasesTable(projectId) {
  // Create table
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Базы данных', 'Подключенные источники данных', '🗄️', toBool(false)]);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create columns matching data_sources structure
  const columns = [
    { name: 'name', display: 'Название', type: 'text', order: 0, is_required: 1 },
    { name: 'type', display: 'Тип', type: 'select', order: 1, is_required: 1, config: {
      options: [
        { label: 'MySQL (Local)', value: 'local_mysql' },
        { label: 'PostgreSQL (Local)', value: 'local_postgres' },
        { label: 'SQLite', value: 'sqlite' },
        { label: 'MySQL (Remote)', value: 'remote_mysql' },
        { label: 'PostgreSQL (Remote)', value: 'remote_postgres' }
      ]
    }},
    { name: 'host', display: 'Хост', type: 'text', order: 2 },
    { name: 'port', display: 'Порт', type: 'number', order: 3 },
    { name: 'database', display: 'База данных', type: 'text', order: 4 },
    { name: 'username', display: 'Пользователь', type: 'text', order: 5 },
    { name: 'password', display: 'Пароль', type: 'password', order: 6 },
    { name: 'status', display: 'Статус', type: 'select', order: 7, config: {
      options: [
        { label: '✅ Подключено', value: 'connected' },
        { label: '❌ Отключено', value: 'disconnected' },
        { label: '⚠️ Ошибка', value: 'error' }
      ]
    }},
    { name: 'data_source_id', display: 'ID источника', type: 'text', order: 8, is_system: true },
    { name: 'created_at', display: 'Создано', type: 'datetime', order: 9, is_system: true },
    { name: 'updated_at', display: 'Обновлено', type: 'datetime', order: 10, is_system: true }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Users system table
 * @param {number} projectId - Project ID
 */
async function createUsersSystemTable(projectId) {
  // Create table
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Users', 'System users management', '👥', 'users']);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create columns
  const columns = [
    { name: 'id', display: 'ID', type: 'number', order: 0, is_system: true },
    { name: 'created_at', display: 'Created At', type: 'datetime', order: 1, is_system: true },
    { name: 'updated_at', display: 'Updated At', type: 'datetime', order: 2, is_system: true },
    { name: 'email', display: 'Email', type: 'email', order: 3, is_required: 1 },
    { name: 'name', display: 'Name', type: 'text', order: 4, is_required: 1 },
    { 
      name: 'role', 
      display: 'Role', 
      type: 'select', 
      order: 5,
      config: {
        options: [
          { label: 'Owner', value: 'owner' },
          { label: 'Admin', value: 'admin' },
          { label: 'User', value: 'user' }
        ]
      }
    },
    { name: 'avatar', display: 'Avatar', type: 'image', order: 6 },
    { name: 'totp_enabled', display: '2FA Enabled', type: 'checkbox', order: 7 },
    { name: 'email_verified', display: 'Email Verified', type: 'checkbox', order: 8 }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Projects system table
 * @param {number} projectId - Project ID
 */
async function createProjectsSystemTable(projectId) {
  // Create table
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Projects', 'System projects management', '📁', 'projects']);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create columns
  const columns = [
    { name: 'id', display: 'ID', type: 'number', order: 0, is_system: true },
    { name: 'created_at', display: 'Created At', type: 'datetime', order: 1, is_system: true },
    { name: 'updated_at', display: 'Updated At', type: 'datetime', order: 2, is_system: true },
    { name: 'name', display: 'Name', type: 'text', order: 3, is_required: 1 },
    { name: 'description', display: 'Description', type: 'text', order: 4 },
    { name: 'icon', display: 'Icon', type: 'text', order: 5 },
    { 
      name: 'type', 
      display: 'Type', 
      type: 'select', 
      order: 6,
      config: {
        options: [
          { label: 'Admin Owner Space', value: 'admin_owner_space' },
          { label: 'Personal Space', value: 'personal_space' },
          { label: 'Custom', value: 'custom' }
        ]
      }
    },
    { name: 'owner_id', display: 'Owner', type: 'user', order: 7 },
    { name: 'theme_primary', display: 'Primary Color', type: 'text', order: 8 },
    { name: 'theme_secondary', display: 'Secondary Color', type: 'text', order: 9 },
    { name: 'theme_tertiary', display: 'Tertiary Color', type: 'text', order: 10 }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Tables system table
 * @param {number} projectId - Project ID
 */
async function createTablesSystemTable(projectId) {
  // Create table
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Tables', 'System tables management', '📊', 'universal_tables']);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create columns
  const columns = [
    { name: 'id', display: 'ID', type: 'number', order: 0, is_system: true },
    { name: 'created_at', display: 'Created At', type: 'datetime', order: 1, is_system: true },
    { name: 'updated_at', display: 'Updated At', type: 'datetime', order: 2, is_system: true },
    { name: 'name', display: 'Name', type: 'text', order: 3, is_required: 1 },
    { name: 'display_name', display: 'Display Name', type: 'text', order: 4 },
    { name: 'icon', display: 'Icon', type: 'text', order: 5 },
    { name: 'project_id', display: 'Project', type: 'relation', order: 6 },
    { name: 'is_system', display: 'System Table', type: 'checkbox', order: 7 },
    { name: 'sync_target', display: 'Sync Target', type: 'text', order: 8 }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Files system table
 * @param {number} projectId - Project ID
 */
async function createFilesSystemTable(projectId) {
  // Create table
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Files', 'Uploaded files management', '📎', 'files']);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create columns matching files table structure
  const columns = [
    { name: 'id', display: 'ID', type: 'text', order: 0, is_system: true },
    { name: 'name', display: 'File Name', type: 'text', order: 1 },
    { name: 'original_name', display: 'Original Name', type: 'text', order: 2 },
    { name: 'mime_type', display: 'Type', type: 'text', order: 3 },
    { name: 'size', display: 'Size', type: 'number', order: 4 },
    { name: 'url', display: 'URL', type: 'url', order: 5 },
    { name: 'space_id', display: 'Space', type: 'relation', order: 6 },
    { name: 'project_id', display: 'Project', type: 'relation', order: 7 },
    { name: 'table_id', display: 'Table', type: 'relation', order: 8 },
    { name: 'row_id', display: 'Row', type: 'text', order: 9 },
    { name: 'uploaded_by', display: 'Uploaded By', type: 'user', order: 10 },
    { 
      name: 'storage_provider_id', 
      display: 'Storage', 
      type: 'select', 
      order: 11,
      config: {
        options: [
          { label: '💾 Local', value: 'local' },
          { label: '☁️ S3', value: 's3' },
          { label: '📁 Google Drive', value: 'google_drive' },
          { label: '📦 Dropbox', value: 'dropbox' }
        ]
      }
    },
    { name: 'description', display: 'Description', type: 'text', order: 12 },
    { name: 'created_at', display: 'Created At', type: 'datetime', order: 13, is_system: true },
    { name: 'updated_at', display: 'Updated At', type: 'datetime', order: 14, is_system: true }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Storage Providers system table
 * @param {number} projectId - Project ID
 */
async function createStorageProvidersSystemTable(projectId) {
  // Create table
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Storage Providers', 'File storage providers configuration', '☁️', 'storage_providers']);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create columns matching storage_providers table structure
  const columns = [
    { name: 'id', display: 'ID', type: 'text', order: 0, is_system: true },
    { name: 'name', display: 'Name', type: 'text', order: 1, is_required: 1 },
    { 
      name: 'type', 
      display: 'Type', 
      type: 'select', 
      order: 2, 
      is_required: 1,
      config: {
        options: [
          { label: '💾 Local Storage', value: 'local' },
          { label: '☁️ Amazon S3', value: 's3' },
          { label: '📁 Google Drive', value: 'google_drive' },
          { label: '📦 Dropbox', value: 'dropbox' }
        ]
      }
    },
    { name: 'is_default', display: 'Default', type: 'checkbox', order: 3 },
    { name: 'is_enabled', display: 'Enabled', type: 'checkbox', order: 4 },
    { name: 'config', display: 'Configuration', type: 'json', order: 5 },
    { name: 'created_at', display: 'Created At', type: 'datetime', order: 6, is_system: true },
    { name: 'updated_at', display: 'Updated At', type: 'datetime', order: 7, is_system: true }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Bugs table for Admin Owner's Space
 * @param {number} projectId - Project ID
 */
async function createBugsTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Bugs', 'Bug reports and issues', '🐛', toBool(false)]);

  const tableId = result.lastInsertRowid || result.lastID;

  const columns = [
    { name: 'title', display: 'Title', type: 'text', order: 0, is_required: 1 },
    { name: 'description', display: 'Description', type: 'textarea', order: 1 },
    { name: 'steps', display: 'Steps to Reproduce', type: 'textarea', order: 2 },
    { 
      name: 'severity', 
      display: 'Severity', 
      type: 'select', 
      order: 3, 
      config: {
        options: [
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' },
          { label: 'Critical', value: 'critical' }
        ]
      }
    },
    { 
      name: 'status', 
      display: 'Status', 
      type: 'select', 
      order: 4, 
      config: {
        options: [
          { label: 'New', value: 'new' },
          { label: 'In Progress', value: 'in_progress' },
          { label: 'Blocked', value: 'blocked' },
          { label: 'Resolved', value: 'resolved' }
        ]
      }
    },
    { name: 'page_url', display: 'Page URL', type: 'url', order: 5 },
    { name: 'attachments', display: 'Files', type: 'file', order: 6 },
    { name: 'created_at', display: 'Created At', type: 'datetime', order: 7, is_system: true },
    { name: 'updated_at', display: 'Updated At', type: 'datetime', order: 8, is_system: true }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }

  return tableId;
}

/**
 * Create Tickets module tables for a project (ADR-098: Unified Execution Ecosystem)
 * Creates: Tickets table + Ticket States dictionary table + Ticket Types dictionary table
 *
 * @param {number} projectId - Project ID where to create the tables
 * @returns {Promise<{ticketsTableId: number, statesTableId: number, typesTableId: number}>}
 */
export async function createTicketsModuleTables(projectId) {
  // === 1. Create Ticket States dictionary table ===
  const statesResult = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Ticket States', 'Status options for tickets', '🏷️', toBool(true)]);
  const statesTableId = statesResult.lastInsertRowid || statesResult.lastID;

  // State columns
  for (const col of [
    { name: 'name', display: 'Name', type: 'text', order: 0, is_required: 1 },
    { name: 'color', display: 'Color', type: 'text', order: 1 },
    { name: 'order_index', display: 'Order', type: 'number', order: 2 },
  ]) {
    await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_required, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [statesTableId, col.name, col.display, col.type, null, col.order, toBool(col.is_required), toBool(false)]);
  }

  // Seed default 7 states (ADR-098)
  const defaultStates = [
    { name: 'Backlog', color: '#6b7280' },
    { name: 'Assigned', color: '#3b82f6' },
    { name: 'In Progress', color: '#f59e0b' },
    { name: 'Review', color: '#8b5cf6' },
    { name: 'Control', color: '#ef4444' },
    { name: 'Rejected', color: '#dc2626' },
    { name: 'Done', color: '#22c55e' },
  ];

  const stateRowIds = [];
  for (let i = 0; i < defaultStates.length; i++) {
    const s = defaultStates[i];
    const sr = await dbRun(`
      INSERT INTO table_rows (table_id, data, created_at)
      VALUES (?, ?, ${toBool(true) === true ? "datetime('now')" : "NOW()"})
    `, [statesTableId, JSON.stringify({ name: s.name, color: s.color, order_index: i })]);
    stateRowIds.push(sr.lastInsertRowid || sr.lastID);
  }

  // === 2. Create Ticket Types dictionary table ===
  const typesResult = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Ticket Types', 'Type options for tickets', '📋', toBool(true)]);
  const typesTableId = typesResult.lastInsertRowid || typesResult.lastID;

  for (const col of [
    { name: 'name', display: 'Name', type: 'text', order: 0, is_required: 1 },
    { name: 'color', display: 'Color', type: 'text', order: 1 },
  ]) {
    await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_required, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [typesTableId, col.name, col.display, col.type, null, col.order, toBool(col.is_required), toBool(false)]);
  }

  // Seed default types
  const defaultTypes = [
    { name: 'Backend', color: '#3b82f6' },
    { name: 'Frontend', color: '#8b5cf6' },
    { name: 'Testing', color: '#22c55e' },
    { name: 'Architecture', color: '#f59e0b' },
    { name: 'DevOps', color: '#06b6d4' },
    { name: 'Bug', color: '#ef4444' },
  ];

  for (const t of defaultTypes) {
    await dbRun(`
      INSERT INTO table_rows (table_id, data, created_at)
      VALUES (?, ?, ${toBool(true) === true ? "datetime('now')" : "NOW()"})
    `, [typesTableId, JSON.stringify({ name: t.name, color: t.color })]);
  }

  // === 3. Create Tickets main table ===
  const ticketsResult = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Tickets', 'Development task tracking with state machine workflow', '🎫', toBool(false)]);
  const ticketsTableId = ticketsResult.lastInsertRowid || ticketsResult.lastID;

  // Tickets columns (ADR-098 full spec)
  const ticketColumns = [
    { name: 'what', display: 'What', type: 'text', order: 0, is_required: 1 },
    { name: 'why', display: 'Why', type: 'rich_text', order: 1 },
    {
      name: 'state', display: 'State', type: 'relation', order: 2, is_required: 1,
      config: {
        relation: { enabled: true, tableId: statesTableId, valueColumn: 'id', labelColumn: 'name' },
        relatedTableId: statesTableId
      }
    },
    {
      name: 'type', display: 'Type', type: 'relation', order: 3,
      config: {
        relation: { enabled: true, tableId: typesTableId, valueColumn: 'id', labelColumn: 'name' },
        relatedTableId: typesTableId
      }
    },
    { name: 'assigned_to', display: 'Assigned To', type: 'user', order: 4 },
    {
      name: 'priority', display: 'Priority', type: 'select', order: 5,
      config: {
        options: [
          { label: 'Critical', value: 'critical', color: '#ef4444' },
          { label: 'High', value: 'high', color: '#f59e0b' },
          { label: 'Medium', value: 'medium', color: '#3b82f6' },
          { label: 'Low', value: 'low', color: '#6b7280' },
        ]
      }
    },
    { name: 'acceptance_criteria', display: 'Acceptance Criteria', type: 'rich_text', order: 6 },
    { name: 'adr_ref', display: 'ADR Reference', type: 'text', order: 7 },
    {
      name: 'phase', display: 'Phase', type: 'select', order: 8,
      config: {
        options: [
          { label: 'Phase 0', value: 'phase_0', color: '#6b7280' },
          { label: 'Phase 1', value: 'phase_1', color: '#3b82f6' },
          { label: 'Phase 2', value: 'phase_2', color: '#8b5cf6' },
          { label: 'Phase 3', value: 'phase_3', color: '#22c55e' },
        ]
      }
    },
    { name: 'scheduled_date', display: 'Scheduled Date', type: 'datetime', order: 9 },
    { name: 'due_date', display: 'Due Date', type: 'datetime', order: 10 },
    { name: 'progress', display: 'Progress', type: 'number', order: 11, config: { min: 0, max: 100, suffix: '%' } },
    { name: 'depends_on', display: 'Depends On', type: 'text', order: 12 },
    { name: 'chain_id', display: 'Chain ID', type: 'text', order: 13 },
    {
      name: 'cycle', display: 'Cycle', type: 'select', order: 14,
      config: {
        options: [
          { label: 'Sprint 1', value: 'sprint_1' },
          { label: 'Sprint 2', value: 'sprint_2' },
          { label: 'Sprint 3', value: 'sprint_3' },
          { label: 'Backlog', value: 'backlog' },
        ]
      }
    },
  ];

  for (const col of ticketColumns) {
    await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_required, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      ticketsTableId, col.name, col.display, col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order, toBool(col.is_required), toBool(false)
    ]);
  }

  return { ticketsTableId, statesTableId, typesTableId, stateRowIds };
}

/**
 * Ensure per-space System Data project has core system tables (Projects, Tables, Files, Variables)
 * ADR-026: Added Variables table for formulas and aggregations
 * @param {number} spaceId
 * @returns {Promise<{systemProjectId:number, projectsTableId:number, tablesTableId:number, filesTableId:number, variablesTableId:number}|null>}
 */
export async function ensureCoreSystemTablesForSpace(spaceId) {
  if (!spaceId) return null;

  const space = await dbGet('SELECT id, owner_id, name FROM spaces WHERE id = ?', [spaceId]);
  if (!space) return null;

  // Find or create System Data project in this space
  let systemProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [spaceId]
  );

  if (!systemProject) {
    const now = new Date().toISOString();
    const result = await dbRun(
      `INSERT INTO projects (
        space_id, name, description, icon, type, owner_id,
        theme_primary, theme_secondary, theme_tertiary,
        created_at, updated_at
      ) VALUES (?, 'System Data', 'System data for this space', '⚙️', 'system_data', ?, '#0ea5e9', '#8b5cf6', '#10b981', ?, ?)`,
      [spaceId, space.owner_id, now, now]
    );
    systemProject = { id: result.lastInsertRowid || result.lastID };
  }

  const ensureTable = async (tableName, creator) => {
    const existing = await dbGet(
      'SELECT id FROM universal_tables WHERE project_id = ? AND name = ?',
      [systemProject.id, tableName]
    );
    if (existing) return existing.id;
    return await creator(systemProject.id);
  };

  const projectsTableId = await ensureTable('Projects', createProjectsSystemTable);
  const tablesTableId = await ensureTable('Tables', createTablesSystemTable);
  const filesTableId = await ensureTable('Files', createFilesSystemTable);
  const variablesTableId = await ensureTable('Variables', createVariablesTable);

  return {
    systemProjectId: systemProject.id,
    projectsTableId,
    tablesTableId,
    filesTableId,
    variablesTableId
  };
}
