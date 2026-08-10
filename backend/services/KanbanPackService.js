/**
 * KanbanPackService - Creates Kanban/Tickets project with all necessary tables
 *
 * Creates (matches Development space schema):
 *   Dictionaries project:
 *     - Ticket States (8 kanban columns)
 *     - Ticket Types (4 types: bug, story, task, spike)
 *     - Ticket Priorities (4 levels: low..critical)
 *   Kanban Board project:
 *     - Tickets (main table, 18 columns)
 *     - Ticket Dependencies
 *     - Ticket Metrics (DORA metrics)
 *   Bug Tracker project:
 *     - Bugs (with screenshots, severity, status)
 */

import { dbRun, dbGet } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

function generateBaseId(prefix = 'row') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ── Helpers ──────────────────────────────────────────────────────

async function createProject(spaceId, name, type, icon, description, ownerId) {
  const result = await dbRun(`
    INSERT INTO projects (name, type, icon, description, owner_id, space_id, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '{}', NOW(), NOW())
  `, [name, type, icon, description, ownerId, spaceId]);
  return result.lastInsertRowid || result.lastID;
}

async function createTable(projectId, name, icon, description, isSystem = false) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, icon, description, is_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NOW(), NOW())
  `, [projectId, name, icon, description, isSystem ? 1 : 0]);
  return result.lastInsertRowid || result.lastID;
}

async function createColumns(tableId, columns) {
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const config = col.config ? JSON.stringify(col.config) : null;
    await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, is_system, order_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      tableId,
      col.key,
      col.name,
      col.type,
      config,
      col.width || 150,
      col.required ? 1 : 0,
      col.system ? 1 : 0,
      i + 1
    ]);
  }
}

async function createRows(tableId, rows, createdBy) {
  const ids = [];
  for (const row of rows) {
    const result = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
    `, [tableId, generateBaseId('kanban'), JSON.stringify(row), createdBy]);
    ids.push(result.lastInsertRowid || result.lastID);
  }
  return ids;
}

// ── Table Definitions (matches Development space live schema) ────

const TICKET_STATES_COLUMNS = [
  { key: 'name', name: 'Name', type: 'text', required: true },
  { key: 'order', name: 'Order', type: 'number', required: true },
  { key: 'color', name: 'Color', type: 'color' },
  { key: 'is_final', name: 'Is Final', type: 'checkbox' },
];

const TICKET_STATES_SEED = [
  { name: 'backlog', order: 1, color: '#6b7280', is_final: false },
  { name: 'assigned', order: 2, color: '#6366f1', is_final: false },
  { name: 'in progress', order: 3, color: '#3b82f6', is_final: false },
  { name: 'review', order: 4, color: '#a855f7', is_final: false },
  { name: 'control', order: 5, color: '#f59e0b', is_final: false },
  { name: 'on hold', order: 6, color: '#f59e0b', is_final: false },
  { name: 'done', order: 7, color: '#22c55e', is_final: true },
  { name: 'rejected', order: 8, color: '#ef4444', is_final: true },
];

const TICKET_TYPES_COLUMNS = [
  { key: 'name', name: 'Name', type: 'text', required: true },
  { key: 'color', name: 'Color', type: 'color' },
  { key: 'icon', name: 'Icon', type: 'text' },
];

const TICKET_TYPES_SEED = [
  { name: 'bug', color: '#ef4444', icon: '🐛' },
  { name: 'story', color: '#3b82f6', icon: '📖' },
  { name: 'task', color: '#22c55e', icon: '✅' },
  { name: 'spike', color: '#a855f7', icon: '🔬' },
];

const TICKET_PRIORITIES_COLUMNS = [
  { key: 'name', name: 'Name', type: 'text', required: true },
  { key: 'level', name: 'Level', type: 'number', required: true },
  { key: 'color', name: 'Color', type: 'color' },
];

const TICKET_PRIORITIES_SEED = [
  { name: 'low', level: 1, color: '#6b7280' },
  { name: 'medium', level: 2, color: '#f59e0b' },
  { name: 'high', level: 3, color: '#f97316' },
  { name: 'critical', level: 4, color: '#ef4444' },
];

function getTicketsColumns(statesTableId, typesTableId, prioritiesTableId, usersTableId) {
  return [
    {
      key: 'type', name: 'Type', type: 'select', required: true, width: 120,
      config: { relatedTableId: typesTableId, relation: { enabled: true, tableId: typesTableId, labelColumn: 'name' } }
    },
    {
      key: 'adr_ref', name: 'ADR', type: 'select', width: 120,
      config: { options: [] }  // In Dev this is a relation to ADR table; stays empty for new spaces (no ADR table to link)
    },
    {
      key: 'priority', name: 'Priority', type: 'select', width: 120,
      config: { relatedTableId: prioritiesTableId, relation: { enabled: true, tableId: prioritiesTableId, labelColumn: 'name' } }
    },
    {
      key: 'state', name: 'State', type: 'select', required: true, width: 140,
      config: { relatedTableId: statesTableId, relation: { enabled: true, tableId: statesTableId, labelColumn: 'name' } }
    },
    {
      key: 'assigned_to', name: 'Assigned To', type: 'select', width: 150,
      config: usersTableId
        ? { relatedTableId: usersTableId, relation: { enabled: true, tableId: usersTableId, labelColumn: 'name' } }
        : { options: [] }
    },
    { key: 'what', name: 'What', type: 'text', required: true, width: 800 },
    { key: 'why', name: 'Why', type: 'text', width: 632, config: { cellFormat: { mode: 'markdown' } } },
    { key: 'acceptance_criteria', name: 'Acceptance Criteria', type: 'textarea', width: 300 },
    { key: 'test_steps', name: 'Test Steps', type: 'textarea', width: 300 },
    { key: 'created_date', name: 'Created', type: 'datetime', width: 150 },
    { key: 'completed_date', name: 'Completed', type: 'datetime', width: 150 },
    {
      key: 'phase', name: 'Phase', type: 'select', width: 120,
      config: {
        options: [
          { value: 'phase_0', label: 'Phase 0', color: '#ef4444' },
          { value: 'phase_1', label: 'Phase 1', color: '#f59e0b' },
          { value: 'phase_2', label: 'Phase 2', color: '#3b82f6' },
          { value: 'phase_3', label: 'Phase 3', color: '#22c55e' },
        ]
      }
    },
    { key: 'scheduled_date', name: 'Scheduled Date', type: 'date', width: 140 },
    { key: 'due_date', name: 'Due Date', type: 'date', width: 140 },
    { key: 'progress', name: 'Progress', type: 'number', width: 100, config: { min: 0, max: 100, suffix: '%' } },
    { key: 'depends_on', name: 'Depends On', type: 'text', width: 150 },
    { key: 'chain_id', name: 'Chain ID', type: 'text', width: 120 },
    {
      key: 'cycle', name: 'Cycle', type: 'select', width: 120,
      config: {
        options: [
          { value: 'sprint_1', label: 'Sprint 1', color: '#3b82f6' },
          { value: 'sprint_2', label: 'Sprint 2', color: '#8b5cf6' },
          { value: 'sprint_3', label: 'Sprint 3', color: '#ec4899' },
          { value: 'sprint_4', label: 'Sprint 4', color: '#14b8a6' },
        ]
      }
    },
  ];
}

const TICKET_DEPENDENCIES_COLUMNS = (ticketsTableId) => [
  {
    key: 'dependent_id', name: 'Dependent Ticket', type: 'select', required: true, width: 200,
    config: { relatedTableId: ticketsTableId, relation: { enabled: true, tableId: ticketsTableId, labelColumn: 'what' } }
  },
  {
    key: 'dependency_id', name: 'Depends On', type: 'select', required: true, width: 200,
    config: { relatedTableId: ticketsTableId, relation: { enabled: true, tableId: ticketsTableId, labelColumn: 'what' } }
  },
  { key: 'created_date', name: 'Created', type: 'datetime', width: 150 },
  {
    key: 'color_tag', name: 'Color', type: 'select', width: 100,
    config: {
      options: [
        { value: 'gray', label: 'Gray', color: '#6b7280' }, { value: 'red', label: 'Red', color: '#ef4444' },
        { value: 'orange', label: 'Orange', color: '#f97316' }, { value: 'yellow', label: 'Yellow', color: '#eab308' },
        { value: 'green', label: 'Green', color: '#22c55e' }, { value: 'blue', label: 'Blue', color: '#3b82f6' },
        { value: 'purple', label: 'Purple', color: '#a855f7' }, { value: 'pink', label: 'Pink', color: '#ec4899' },
      ]
    }
  },
];

const TICKET_METRICS_COLUMNS = (ticketsTableId) => [
  {
    key: 'ticket_id', name: 'Ticket', type: 'select', required: true, width: 200,
    config: { relatedTableId: ticketsTableId, relation: { enabled: true, tableId: ticketsTableId, labelColumn: 'what' } }
  },
  { key: 'lead_time', name: 'Lead Time (min)', type: 'number', width: 140 },
  { key: 'change_failure', name: 'Change Failure', type: 'checkbox', width: 120 },
  { key: 'deployment_date', name: 'Deployment Date', type: 'datetime', width: 160 },
  { key: 'restoration_time', name: 'Restoration Time (min)', type: 'number', width: 160 },
  { key: 'record_date', name: 'Record Date', type: 'datetime', width: 150 },
];

const BUGS_COLUMNS = [
  { key: 'title', name: 'Title', type: 'text', required: true, width: 300 },
  { key: 'description', name: 'Description', type: 'text', width: 400, config: { cellFormat: { mode: 'markdown' } } },
  { key: 'images', name: 'Screenshots', type: 'image', width: 200, config: { multiple: true, accept: 'image/*', pasteEnabled: true } },
  { key: 'steps', name: 'Steps to Reproduce', type: 'textarea', width: 300 },
  {
    key: 'severity', name: 'Severity', type: 'select', width: 120,
    config: {
      options: [
        { value: 'low', label: 'Low', color: '#6b7280' },
        { value: 'medium', label: 'Medium', color: '#f59e0b' },
        { value: 'high', label: 'High', color: '#f97316' },
        { value: 'critical', label: 'Critical', color: '#ef4444' },
      ]
    }
  },
  {
    key: 'status', name: 'Status', type: 'select', width: 120,
    config: {
      options: [
        { value: 'new', label: 'New', color: '#6b7280' },
        { value: 'in_progress', label: 'In Progress', color: '#3b82f6' },
        { value: 'blocked', label: 'Blocked', color: '#f59e0b' },
        { value: 'resolved', label: 'Resolved', color: '#22c55e' },
      ]
    }
  },
  { key: 'page_url', name: 'Page URL', type: 'url', width: 250 },
  { key: 'attachments', name: 'Files', type: 'file', width: 150 },
  { key: 'created_at', name: 'Created At', type: 'datetime', system: true, width: 150 },
  { key: 'updated_at', name: 'Updated At', type: 'datetime', system: true, width: 150 },
];

// ── Main Pack Creator ────────────────────────────────────────────

/**
 * Create Kanban Pack for a space
 * Creates 3 projects with 7 tables matching Development space schema
 *
 * @param {number} spaceId - Target space ID
 * @param {number} ownerId - User ID for ownership
 * @param {object} [options] - Optional configuration
 * @param {number} [options.usersTableId] - Users table to link assigned_to relations
 * @returns {Promise<object>} Created project/table IDs
 */
export async function createKanbanPack(spaceId, ownerId, options = {}) {
  apiLogger.info({ spaceId }, 'Creating Kanban Pack');

  try {
    // ── 1. Dictionaries project ──
    const dictProjectId = await createProject(
      spaceId, 'Dictionaries', 'custom', '📚',
      'Ticket dictionaries: states, types, priorities', ownerId
    );

    const statesTableId = await createTable(dictProjectId, 'Ticket States', '📊', 'Kanban column states', false);
    await createColumns(statesTableId, TICKET_STATES_COLUMNS);
    const stateRowIds = await createRows(statesTableId, TICKET_STATES_SEED, ownerId);

    const typesTableId = await createTable(dictProjectId, 'Ticket Types', '🏷️', 'Ticket type categories', false);
    await createColumns(typesTableId, TICKET_TYPES_COLUMNS);
    await createRows(typesTableId, TICKET_TYPES_SEED, ownerId);

    const prioritiesTableId = await createTable(dictProjectId, 'Ticket Priorities', '🎯', 'Priority levels', false);
    await createColumns(prioritiesTableId, TICKET_PRIORITIES_COLUMNS);
    await createRows(prioritiesTableId, TICKET_PRIORITIES_SEED, ownerId);

    apiLogger.debug({ dictProjectId, statesTableId, typesTableId, prioritiesTableId }, 'Dictionaries project created');

    // ── 2. Kanban Board project ──
    const kanbanProjectId = await createProject(
      spaceId, 'Kanban Board', 'project', '🎫',
      'Task tracking with kanban workflow', ownerId
    );

    const ticketsTableId = await createTable(kanbanProjectId, 'Tickets', '🎫', 'Development task tracking');
    await createColumns(ticketsTableId, getTicketsColumns(
      statesTableId, typesTableId, prioritiesTableId, options.usersTableId
    ));

    const depsTableId = await createTable(kanbanProjectId, 'Ticket Dependencies', '🔗', 'Ticket dependency graph');
    await createColumns(depsTableId, TICKET_DEPENDENCIES_COLUMNS(ticketsTableId));

    const metricsTableId = await createTable(kanbanProjectId, 'Ticket Metrics', '📈', 'DORA metrics tracking');
    await createColumns(metricsTableId, TICKET_METRICS_COLUMNS(ticketsTableId));

    apiLogger.debug({ kanbanProjectId, ticketsTableId, depsTableId, metricsTableId }, 'Kanban Board project created');

    // ── 3. Bug Tracker project ──
    const bugsProjectId = await createProject(
      spaceId, 'Bug Tracker', 'custom', '🐛',
      'Bug reports with screenshots and severity tracking', ownerId
    );

    const bugsTableId = await createTable(bugsProjectId, 'Bugs', '🐛', 'Bug reports and issues');
    await createColumns(bugsTableId, BUGS_COLUMNS);

    apiLogger.debug({ bugsProjectId, bugsTableId }, 'Bug Tracker project created');

    const result = {
      success: true,
      dictionaries_project_id: dictProjectId,
      kanban_project_id: kanbanProjectId,
      bugs_project_id: bugsProjectId,
      tables: {
        ticket_states_id: statesTableId,
        ticket_types_id: typesTableId,
        ticket_priorities_id: prioritiesTableId,
        tickets_id: ticketsTableId,
        ticket_dependencies_id: depsTableId,
        ticket_metrics_id: metricsTableId,
        bugs_id: bugsTableId,
      },
      state_row_ids: stateRowIds,
      status: 'created'
    };

    apiLogger.info({ spaceId, ...result.tables }, 'Kanban Pack created successfully');
    return result;

  } catch (err) {
    apiLogger.error({ err, spaceId }, 'Error creating Kanban Pack');
    throw err;
  }
}

/**
 * Install Kanban Pack for a space (idempotent)
 * Checks if pack already exists before creating
 *
 * @param {number} spaceId - Target space ID
 * @param {number} userId - User ID
 * @returns {Promise<object>}
 */
export async function installKanbanPack(spaceId, userId) {
  // Check if Kanban Board project already exists
  const existing = await dbGet(
    `SELECT id FROM projects WHERE space_id = ? AND name = 'Kanban Board'`,
    [spaceId]
  );

  if (existing) {
    apiLogger.debug({ spaceId }, 'Kanban Pack already exists, skipping');
    return { success: true, kanban_project_id: existing.id, status: 'existing' };
  }

  // Find Users table for relation linking (optional)
  const usersTable = await dbGet(`
    SELECT ut.id FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = ? AND LOWER(ut.name) = 'users'
    LIMIT 1
  `, [spaceId]);

  return createKanbanPack(spaceId, userId, { usersTableId: usersTable?.id });
}

export default {
  createKanbanPack,
  installKanbanPack
};
