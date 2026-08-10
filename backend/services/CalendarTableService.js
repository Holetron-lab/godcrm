/**
 * CalendarTableService - Creates a calendar table with holidays/weekends for 3 years
 * Includes background color and font color for visual customization
 */

import { dbGet, dbRun, dbAll } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

// Color constants
const COLORS = {
  // Background colors  
  BG_WEEKEND: '#FECACA',      // Light pink/red for weekends
  BG_WORKDAY: null,           // No fill for workdays (transparent)
  
  // Font colors
  FONT_WEEKEND: '#DC2626',    // Red text for weekends
  FONT_WORKDAY: null,         // Default text color for workdays
};

/**
 * Generate unique base_id for rows
 */
function generateBaseId(prefix = 'cal') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a calendar table in the given project
 */
async function createTable(projectId, name, icon, description) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, icon, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [projectId, name, icon, description]);
  
  apiLogger.debug({ name, tableId: result.lastInsertRowid }, 'Created table');
  return result.lastInsertRowid;
}

/**
 * Create columns for a table
 */
async function createColumns(tableId, columns) {
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const config = {
      icon: col.icon || null,
      ...(col.settings || {})
    };
    await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      tableId,
      col.key || col.name.toLowerCase().replace(/\s+/g, '_'),
      col.name,
      col.type,
      JSON.stringify(config),
      col.width || 150,
      col.required ? 1 : 0,
      i + 1
    ]);
  }
  apiLogger.debug({ count: columns.length }, 'Added columns');
}

/**
 * Get or create System Data project for a space
 */
async function getOrCreateSystemDataProject(spaceId, ownerId) {
  // Try to find existing System Data project
  let project = await dbGet(`
    SELECT id FROM projects 
    WHERE space_id = ? AND (type = 'system_data' OR name LIKE '%System Data%')
    LIMIT 1
  `, [spaceId]);
  
  if (project) {
    return project.id;
  }
  
  // Create new System Data project
  const result = await dbRun(`
    INSERT INTO projects (name, type, icon, description, owner_id, space_id, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '{}', datetime('now'), datetime('now'))
  `, ['System Data', 'system_data', '⚙️', 'System tables for automation', ownerId, spaceId]);
  
  apiLogger.info({ projectId: result.lastInsertRowid }, 'Created System Data project');
  return result.lastInsertRowid;
}

/**
 * Check if day is weekend (Saturday=6, Sunday=0)
 */
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Create calendar table with 2 years of data
 */
export async function createCalendarTable(projectId, ownerId, tableName = 'Calendar') {
  apiLogger.info({ projectId }, 'Creating Calendar Table');
  
  // Create the calendar table
  const tableId = await createTable(projectId, tableName, '📅', 'Calendar with holidays and weekends');
  
  // Create columns - simple structure with colors and tags
  await createColumns(tableId, [
    { key: 'date', name: 'Date', type: 'date', icon: '📅', required: true, width: 120 },
    { key: 'day_type', name: 'Day Type', type: 'select', icon: '🏷️', width: 120, settings: {
      options: [
        { value: 'workday', label: 'Workday', color: '#10B981' },
        { value: 'weekend', label: 'Weekend', color: '#6B7280' },
        { value: 'holiday', label: 'Holiday', color: '#EF4444' }
      ]
    }},
    { key: 'bg_color', name: 'Цвет столбца', type: 'color', icon: '🎨', width: 100 },
    { key: 'font_color', name: 'Цвет шрифта', type: 'color', icon: '✏️', width: 100 },
    { key: 'tags', name: 'Tags', type: 'multiselect', icon: '🏷️', width: 150, settings: {
      options: [
        { value: 'holiday', label: 'Holiday', color: '#EF4444' },
        { value: 'vacation', label: 'Vacation', color: '#3B82F6' },
        { value: 'sick', label: 'Sick Day', color: '#F59E0B' },
        { value: 'important', label: 'Important', color: '#8B5CF6' }
      ]
    }},
    { key: 'note', name: 'Note', type: 'text', icon: '📝', width: 200 }
  ]);
  
  // Generate calendar from Jan 1 of previous year to Dec 31 of next year
  const now = new Date();
  const currentYear = now.getFullYear();
  
  const startDate = new Date(currentYear - 1, 0, 1); // Jan 1 of previous year
  startDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(currentYear + 1, 11, 31); // Dec 31 of next year
  endDate.setHours(23, 59, 59, 999);
  
  const rows = [];
  const currentDate = new Date(startDate);
  
  apiLogger.debug({ startDate: formatDate(startDate), endDate: formatDate(endDate) }, 'Generating calendar');
  
  while (currentDate < endDate) {
    const weekend = isWeekend(currentDate);
    const dayType = weekend ? 'weekend' : 'workday';
    
    // Only set colors for weekends (red font, light pink bg)
    // Workdays have no colors (null = use defaults)
    rows.push({
      date: formatDate(currentDate),
      day_type: dayType,
      bg_color: weekend ? COLORS.BG_WEEKEND : null,
      font_color: weekend ? COLORS.FONT_WEEKEND : null,
      note: ''
    });
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Insert rows in batches
  apiLogger.debug({ count: rows.length }, 'Inserting calendar days');
  
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    
    for (const row of batch) {
      await dbRun(`
        INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [tableId, generateBaseId(), JSON.stringify(row), ownerId]);
    }
    
    // Progress indicator
    if ((i + batchSize) % 500 === 0 || i + batchSize >= rows.length) {
      apiLogger.debug({ inserted: Math.min(i + batchSize, rows.length), total: rows.length }, 'Insert progress');
    }
  }
  
  apiLogger.info({ tableId, daysCreated: rows.length }, 'Calendar table created successfully');
  
  return tableId;
}

/**
 * Create calendar table in System Data project
 */
export async function createCalendarTableInSystemData(spaceId, ownerId, tableName = 'Calendar') {
  const projectId = await getOrCreateSystemDataProject(spaceId, ownerId);
  return {
    projectId,
    tableId: await createCalendarTable(projectId, ownerId, tableName)
  };
}

export default {
  createCalendarTable,
  createCalendarTableInSystemData,
  getOrCreateSystemDataProject
};
