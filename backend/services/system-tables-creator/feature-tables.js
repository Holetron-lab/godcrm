// system-tables-creator/feature-tables.js
// Feature tables: Variables, Password Manager, Databases, Tickets module

import { dbRun, toBool } from '../../database/connection.js';
import { insertColumns } from './helpers.js';

/**
 * Create Variables table for Space (ADR-026)
 * Stores calculated variables with formulas for tables and dashboards
 * @param {number} projectId - Project ID where to create the table
 * @returns {Promise<number>} Created table ID
 */
export async function createVariablesTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Variables', 'Space calculated variables', '🧮', toBool(false)]);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
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
  ]);

  return tableId;
}

/**
 * Create Password Manager table for Personal Space
 * @param {number} projectId - Project ID where to create the table
 */
export async function createPasswordManagerTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Password Manager', 'Secure password storage', '🔐', toBool(false)]);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
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
  ]);

  return tableId;
}

/**
 * Create Databases table for Data Sources project
 * @param {number} projectId - Project ID where to create the table
 */
export async function createDatabasesTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Базы данных', 'Подключенные источники данных', '🗄️', toBool(false)]);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
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
  ]);

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
