// system-tables-creator/system-tables.js
// Core system tables: Users, Projects, Tables, Files, Storage Providers, Bugs

import { dbRun, toBool } from '../../database/connection.js';
import { insertColumns } from './helpers.js';

/**
 * Create Users system table
 * @param {number} projectId - Project ID
 */
export async function createUsersSystemTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Users', 'System users management', '👥', 'users']);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
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
  ]);

  return tableId;
}

/**
 * Create Projects system table
 * @param {number} projectId - Project ID
 */
export async function createProjectsSystemTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Projects', 'System projects management', '📁', 'projects']);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
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
  ]);

  return tableId;
}

/**
 * Create Tables system table
 * @param {number} projectId - Project ID
 */
export async function createTablesSystemTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Tables', 'System tables management', '📊', 'universal_tables']);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
    { name: 'id', display: 'ID', type: 'number', order: 0, is_system: true },
    { name: 'created_at', display: 'Created At', type: 'datetime', order: 1, is_system: true },
    { name: 'updated_at', display: 'Updated At', type: 'datetime', order: 2, is_system: true },
    { name: 'name', display: 'Name', type: 'text', order: 3, is_required: 1 },
    { name: 'display_name', display: 'Display Name', type: 'text', order: 4 },
    { name: 'icon', display: 'Icon', type: 'text', order: 5 },
    { name: 'project_id', display: 'Project', type: 'relation', order: 6 },
    { name: 'is_system', display: 'System Table', type: 'checkbox', order: 7 },
    { name: 'sync_target', display: 'Sync Target', type: 'text', order: 8 }
  ]);

  return tableId;
}

/**
 * Create Files system table
 * @param {number} projectId - Project ID
 */
export async function createFilesSystemTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Files', 'Uploaded files management', '📎', 'files']);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
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
  ]);

  return tableId;
}

/**
 * Create Storage Providers system table
 * @param {number} projectId - Project ID
 */
export async function createStorageProvidersSystemTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [projectId, 'Storage Providers', 'File storage providers configuration', '☁️', 'storage_providers']);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
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
  ]);

  return tableId;
}

/**
 * Create Widgets system table (ADR-0012 Phase 8.2)
 * Read-only registry view of widget templates (rows where is_template=true).
 * Per-space stub; data is global (not space-scoped).
 * @param {number} projectId - System Data project ID
 */
export async function createWidgetsSystemTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, display_name, description, icon, is_system, sync_target)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `, [projectId, 'Widgets', 'Widgets', 'Widget templates (read-only)', '🧩', 'widgets']);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
    { name: 'id', display: 'ID', type: 'number', order: 0, is_system: true },
    { name: 'preset_name', display: 'Preset', type: 'text', order: 1 },
    { name: 'title', display: 'Title', type: 'text', order: 2 },
    { name: 'icon', display: 'Icon', type: 'text', order: 3 },
    { name: 'description', display: 'Description', type: 'text', order: 4 },
    { name: 'config', display: 'Config', type: 'json', order: 5 },
    { name: 'widget_type', display: 'Type', type: 'text', order: 6 },
    { name: 'created_at', display: 'Created At', type: 'datetime', order: 7, is_system: true },
    { name: 'updated_at', display: 'Updated At', type: 'datetime', order: 8, is_system: true }
  ]);

  return tableId;
}

/**
 * Create Bugs table for Admin Owner's Space
 * @param {number} projectId - Project ID
 */
export async function createBugsTable(projectId) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, 'Bugs', 'Bug reports and issues', '🐛', toBool(false)]);

  const tableId = result.lastInsertRowid || result.lastID;

  await insertColumns(tableId, [
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
  ]);

  return tableId;
}
