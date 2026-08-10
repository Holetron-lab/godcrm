import { logger, apiLogger } from '../../utils/logger.js';
import express from 'express';
import crypto from 'crypto';
import { dbAll, dbRun, dbGet } from '../../database/connection.js';
import scheduleTriggerService from '../../services/ScheduleTriggerService.js';
import { executeDevReport } from '../../services/schedule-trigger/action-executors.js';

const router = express.Router();

/**
 * Find or create automations_list and automation_logs_list tables in System Data
 */
async function findOrCreateAutomationTables(tableId) {
  // Get project and space for this table
  const table = await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [tableId]);
  if (!table) return null;
  
  const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [table.project_id]);
  if (!project) return null;

  // Find System Data project in this space
  let systemDataProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [project.space_id]
  );

  // If no System Data project, create one
  if (!systemDataProject) {
    const now = new Date().toISOString();
    const result = await dbRun(
      "INSERT INTO projects (name, space_id, created_at, updated_at) VALUES ('System Data', ?, ?, ?)",
      [project.space_id, now, now]
    );
    systemDataProject = { id: result.lastInsertRowid };
    logger.info(`[automations] Created System Data project ${systemDataProject.id} for space ${project.space_id}`);
  }

  // Find or create automations_list table
  let automationsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automations_list'",
    [systemDataProject.id]
  );

  if (!automationsTable) {
    const now = new Date().toISOString();
    const result = await dbRun(
      "INSERT INTO universal_tables (name, display_name, project_id, created_at, updated_at) VALUES ('automations_list', 'Automations', ?, ?, ?)",
      [systemDataProject.id, now, now]
    );
    automationsTable = { id: result.lastInsertRowid };
    logger.info(`[automations] Created automations_list table ${automationsTable.id}`);

    // Create columns
    const columns = [
      { column_name: 'name', display_name: 'Name', type: 'text', order_index: 0 },
      { column_name: 'description', display_name: 'Description', type: 'text', order_index: 1 },
      { column_name: 'table_id', display_name: 'Table ID', type: 'number', order_index: 2 },
      { column_name: 'table_name', display_name: 'Table', type: 'text', order_index: 3 },
      { column_name: 'trigger_type', display_name: 'Trigger', type: 'select', order_index: 4 },
      { column_name: 'action_type', display_name: 'Action', type: 'select', order_index: 5 },
      { column_name: 'is_active', display_name: 'Active', type: 'checkbox', order_index: 6 },
      { column_name: 'trigger_config', display_name: 'Trigger Config', type: 'text', order_index: 7 },
      { column_name: 'action_config', display_name: 'Action Config', type: 'text', order_index: 8 },
      { column_name: 'last_run', display_name: 'Last Run', type: 'date', order_index: 9 },
      { column_name: 'run_count', display_name: 'Run Count', type: 'number', order_index: 10 },
      { column_name: 'created_at', display_name: 'Created At', type: 'date', order_index: 11 }
    ];

    for (const col of columns) {
      await dbRun(
        'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, ?, ?, ?, ?, 1)',
        [automationsTable.id, col.column_name, col.display_name, col.type, col.order_index]
      );
    }
  }

  // Find or create automation_logs_list table
  let logsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automation_logs_list'",
    [systemDataProject.id]
  );

  if (!logsTable) {
    const now = new Date().toISOString();
    const result = await dbRun(
      "INSERT INTO universal_tables (name, display_name, project_id, created_at, updated_at) VALUES ('automation_logs_list', 'Automation Logs', ?, ?, ?)",
      [systemDataProject.id, now, now]
    );
    logsTable = { id: result.lastInsertRowid };
    logger.info(`[automations] Created automation_logs_list table ${logsTable.id}`);

    // Create columns
    const columns = [
      { column_name: 'automation_id', display_name: 'Automation ID', type: 'number', order_index: 0 },
      { column_name: 'automation_name', display_name: 'Automation', type: 'text', order_index: 1 },
      { column_name: 'status', display_name: 'Status', type: 'select', order_index: 2 },
      { column_name: 'trigger_data', display_name: 'Trigger Data', type: 'text', order_index: 3 },
      { column_name: 'result_data', display_name: 'Result', type: 'text', order_index: 4 },
      { column_name: 'error_message', display_name: 'Error', type: 'text', order_index: 5 },
      { column_name: 'duration_ms', display_name: 'Duration (ms)', type: 'number', order_index: 6 },
      { column_name: 'executed_at', display_name: 'Executed At', type: 'date', order_index: 7 }
    ];

    for (const col of columns) {
      await dbRun(
        'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, ?, ?, ?, ?, 1)',
        [logsTable.id, col.column_name, col.display_name, col.type, col.order_index]
      );
    }
  }

  return { automationsTableId: automationsTable.id, logsTableId: logsTable.id, systemDataProjectId: systemDataProject.id };
}

/**
 * Find automation tables for a project (by project ID)
 */
async function findAutomationTablesForProject(projectId) {
  const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [projectId]);
  if (!project) return null;

  const systemDataProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [project.space_id]
  );
  if (!systemDataProject) return null;

  const automationsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automations_list'",
    [systemDataProject.id]
  );

  const logsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automation_logs_list'",
    [systemDataProject.id]
  );

  return automationsTable && logsTable 
    ? { automationsTableId: automationsTable.id, logsTableId: logsTable.id, systemDataProjectId: systemDataProject.id }
    : null;
}

// Get all automations for a table
router.get('/table/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;
    
    const tables = await findOrCreateAutomationTables(tableId);
    if (!tables) {
      return res.json({ success: true, data: [] });
    }

    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC',
      [tables.automationsTableId]
    );

    // Filter by table_id and parse
    const automations = rows
      .map(row => {
        const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        return { id: row.id, ...data };
      })
      .filter(a => a.table_id === parseInt(tableId))
      .map(a => ({
        ...a,
        trigger_config: typeof a.trigger_config === 'string' ? JSON.parse(a.trigger_config || '{}') : (a.trigger_config || {}),
        action_config: typeof a.action_config === 'string' ? JSON.parse(a.action_config || '{}') : (a.action_config || {}),
        is_active: a.is_active !== false && a.is_active !== 0
      }));
    
    res.json({ success: true, data: automations });
  } catch (error) {
    logger.error('Error fetching automations:', error);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get all automations for a project
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const tables = await findAutomationTablesForProject(projectId);
    if (!tables) {
      return res.json({ success: true, data: [], stats: { totalExecutions: 0 } });
    }

    // Get all table IDs for this project
    const projectTables = await dbAll(
      'SELECT id, name FROM universal_tables WHERE project_id = ?',
      [projectId]
    );
    const tableIds = projectTables.map(t => t.id);
    const tableNameMap = Object.fromEntries(projectTables.map(t => [t.id, t.name]));

    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC',
      [tables.automationsTableId]
    );

    // Filter by project tables
    const automations = rows
      .map(row => {
        const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        return { id: row.id, ...data };
      })
      .filter(a => tableIds.includes(a.table_id))
      .map(a => ({
        ...a,
        table_name: tableNameMap[a.table_id] || a.table_name,
        trigger_config: typeof a.trigger_config === 'string' ? JSON.parse(a.trigger_config || '{}') : (a.trigger_config || {}),
        action_config: typeof a.action_config === 'string' ? JSON.parse(a.action_config || '{}') : (a.action_config || {}),
        is_active: a.is_active !== false && a.is_active !== 0
      }));

    // Count logs for these automations
    const automationIds = automations.map(a => a.id);
    let totalExecutions = 0;
    if (automationIds.length > 0) {
      const logsRows = await dbAll(
        'SELECT id, data FROM table_rows WHERE table_id = ?',
        [tables.logsTableId]
      );
      totalExecutions = logsRows.filter(row => {
        const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        return automationIds.includes(data.automation_id);
      }).length;
    }
    
    res.json({ success: true, data: automations, stats: { totalExecutions } });
  } catch (error) {
    logger.error('Error fetching project automations:', error);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get automation logs
router.get('/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const { project_id } = req.query;
    const limit = parseInt(req.query.limit) || 50;
    
    if (!project_id) {
      return res.status(400).json({ success: false, error: { message: 'project_id is required' } });
    }

    const tables = await findAutomationTablesForProject(project_id);
    if (!tables) {
      return res.json({ success: true, data: [] });
    }

    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC',
      [tables.logsTableId]
    );

    const logs = rows
      .map(row => {
        const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        return { id: row.id, ...data };
      })
      .filter(log => log.automation_id === parseInt(id))
      .slice(0, limit)
      .map(log => ({
        id: log.id,
        automationId: log.automation_id,
        rowId: log.row_id,
        status: log.status,
        triggerData: log.trigger_data ? (typeof log.trigger_data === 'string' ? JSON.parse(log.trigger_data) : log.trigger_data) : null,
        resultData: log.result_data ? (typeof log.result_data === 'string' ? JSON.parse(log.result_data) : log.result_data) : null,
        errorMessage: log.error_message,
        executedAt: log.executed_at,
        durationMs: log.duration_ms
      }));
    
    res.json({ success: true, data: logs });
  } catch (error) {
    logger.error('Error fetching automation logs:', error);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get single automation
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { project_id } = req.query;
    
    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    const tables = await findAutomationTablesForProject(project_id);
    if (!tables) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const row = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [id, tables.automationsTableId]
    );
    
    if (!row) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    
    res.json({
      id: row.id,
      ...data,
      trigger_config: typeof data.trigger_config === 'string' ? JSON.parse(data.trigger_config || '{}') : (data.trigger_config || {}),
      action_config: typeof data.action_config === 'string' ? JSON.parse(data.action_config || '{}') : (data.action_config || {}),
      is_active: data.is_active !== false && data.is_active !== 0
    });
  } catch (error) {
    logger.error('Error fetching automation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create automation
router.post('/', async (req, res) => {
  try {
    const { 
      name, 
      table_id, 
      trigger_type, 
      trigger_config, 
      action_type, 
      action_config,
      is_active = true
    } = req.body;
    
    if (!name || !table_id || !trigger_type || !action_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const tables = await findOrCreateAutomationTables(table_id);
    if (!tables) {
      return res.status(500).json({ error: 'Failed to create automation tables' });
    }

    // Get table name
    const sourceTable = await dbGet('SELECT name FROM universal_tables WHERE id = ?', [table_id]);
    
    const now = new Date().toISOString();
    // Store trigger_config and action_config as objects (not JSON strings)
    // so they remain proper JSONB objects inside the data column.
    // Previously JSON.stringify() here caused double-encoding in PostgreSQL JSONB.
    const rowData = {
      name,
      description: req.body.description || null,
      table_id: parseInt(table_id),
      table_name: sourceTable?.name || '',
      trigger_type,
      trigger_config: trigger_config || {},
      action_type,
      action_config: action_config || {},
      is_active: is_active ? true : false,
      run_count: 0,
      last_run: null,
      created_at: now
    };

    // Generate unique base_id
    const baseId = `auto_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const result = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [tables.automationsTableId, baseId, JSON.stringify(rowData), now, now]
    );

    // Reload schedule automations so newly created schedules take effect immediately
    if (trigger_type === 'schedule') {
      scheduleTriggerService.reload().catch(err => {
        logger.error('Failed to reload schedule automations after create:', err);
      });
    }

    res.status(201).json({
      id: result.lastInsertRowid,
      ...rowData,
      trigger_config: trigger_config || {},
      action_config: action_config || {}
    });
  } catch (error) {
    logger.error('Error creating automation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update automation
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const { project_id } = req.query;

    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    const tables = await findAutomationTablesForProject(project_id);
    if (!tables) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const row = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [id, tables.automationsTableId]
    );
    
    if (!row) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const previousTriggerType = data.trigger_type;

    // Apply updates
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.trigger_type !== undefined) data.trigger_type = updates.trigger_type;
    if (updates.trigger_config !== undefined) data.trigger_config = updates.trigger_config;
    if (updates.action_type !== undefined) data.action_type = updates.action_type;
    if (updates.action_config !== undefined) data.action_config = updates.action_config;
    if (updates.is_active !== undefined) data.is_active = updates.is_active ? true : false;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), id]
    );

    // Reload schedule automations if this is/was a schedule trigger
    // (covers changes to cron, is_active toggle, or trigger_type switch away from schedule)
    if (data.trigger_type === 'schedule' || previousTriggerType === 'schedule') {
      scheduleTriggerService.reload().catch(err => {
        logger.error('Failed to reload schedule automations after update:', err);
      });
    }

    res.json({
      id: parseInt(id),
      ...data,
      trigger_config: typeof data.trigger_config === 'string' ? JSON.parse(data.trigger_config || '{}') : (data.trigger_config || {}),
      action_config: typeof data.action_config === 'string' ? JSON.parse(data.action_config || '{}') : (data.action_config || {}),
      is_active: data.is_active !== false && data.is_active !== 0
    });
  } catch (error) {
    logger.error('Error updating automation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete automation
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { project_id } = req.query;

    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    const tables = await findAutomationTablesForProject(project_id);
    if (!tables) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const row = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [id, tables.automationsTableId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const rowData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

    await dbRun('DELETE FROM table_rows WHERE id = ?', [id]);

    // Reload schedule automations if the deleted automation was a schedule trigger
    if (rowData && rowData.trigger_type === 'schedule') {
      scheduleTriggerService.reload().catch(err => {
        logger.error('Failed to reload schedule automations after delete:', err);
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting automation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute automation
router.post('/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowId, rowData, project_id } = req.body;

    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    const tables = await findAutomationTablesForProject(project_id);
    if (!tables) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const row = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [id, tables.automationsTableId]
    );
    
    if (!row) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const automation = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    automation.id = row.id;
    
    const actionConfig = typeof automation.action_config === 'string' 
      ? JSON.parse(automation.action_config || '{}') 
      : (automation.action_config || {});
    
    logger.info('[Automation Execute] action_type:', automation.action_type);
    logger.info('[Automation Execute] actionConfig:', JSON.stringify(actionConfig, null, 2));

    const startTime = Date.now();
    let result;
    
    switch (automation.action_type) {
      case 'webhook':
      case 'n8n':
        result = await executeWebhook(actionConfig, rowData);
        break;
      case 'api_sync':
        result = await executeApiSync(automation.table_id, actionConfig);
        break;
      case 'update_field':
        result = await executeUpdateField(automation.table_id, rowId, actionConfig);
        break;
      case 'formula':
        result = await executeFormula(rowId, actionConfig);
        break;
      case 'create_row':
        result = await executeCreateRow(actionConfig, rowData, rowId);
        break;
      case 'send_notification':
      case 'notification':
        result = { success: true, message: 'Notification sent (mock)' };
        break;
      case 'dev_report':
        result = await executeDevReport(actionConfig, rowData || {});
        break;
      default:
        result = { success: false, error: 'Unknown action type: ' + automation.action_type };
    }

    const durationMs = Date.now() - startTime;
    const now = new Date().toISOString();

    // Log execution to automation_logs_list
    const logData = {
      automation_id: parseInt(id),
      automation_name: automation.name,
      row_id: rowId,
      status: result.success ? 'success' : 'error',
      trigger_data: JSON.stringify(rowData || {}),
      result_data: JSON.stringify(result),
      error_message: result.error || null,
      duration_ms: durationMs,
      executed_at: now
    };

    // Generate unique base_id for log entry
    const logBaseId = `autolog_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [tables.logsTableId, logBaseId, JSON.stringify(logData), now, now]
    );

    // Update automation run count and last_run
    automation.run_count = (automation.run_count || 0) + 1;
    automation.last_run = now;
    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(automation), now, id]
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error executing automation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
async function executeWebhook(config, rowData) {
  try {
    const response = await fetch(config.url, {
      method: config.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {})
      },
      body: JSON.stringify({
        data: rowData,
        timestamp: new Date().toISOString()
      })
    });
    
    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function executeApiSync(tableId, config) {
  try {
    const { url, headers = {}, data_path, field_mapping = {}, static_fields = {},
            pagination_field, max_pages = 50, computed_fields = {} } = config;

    logger.info('[API Sync] Starting sync for table', tableId);
    logger.info('[API Sync] URL:', url);

    // Fetch all pages if pagination is configured
    let allItems = [];
    let nextUrl = url;
    let pageCount = 0;

    while (nextUrl && pageCount < max_pages) {
      const response = await fetch(nextUrl, { method: 'GET', headers });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API error: ${response.status} - ${errorText}` };
      }

      const apiData = await response.json();

      let items = apiData;
      if (data_path && data_path !== '.') {
        for (const key of data_path.split('.').filter(k => k)) {
          items = items?.[key];
        }
      }

      if (!Array.isArray(items)) {
        if (pageCount === 0) {
          return { success: false, error: `Data path did not resolve to an array. Got ${typeof items}` };
        }
        break;
      }

      allItems = allItems.concat(items);
      pageCount++;

      // Check for next page URL
      if (pagination_field && apiData[pagination_field]) {
        nextUrl = apiData[pagination_field];
      } else {
        break; // No pagination or no more pages
      }
    }

    if (pageCount > 1) {
      logger.info(`[API Sync] Fetched ${pageCount} pages, ${allItems.length} total items`);
    }

    const existingRows = await dbAll(
      'SELECT id, base_id, data FROM table_rows WHERE table_id = ?',
      [tableId]
    );

    const existingByModelId = {};
    for (const row of existingRows) {
      const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
      let key = data.model_id || data.post_id || data.id;
      if (!key) {
        const idField = Object.keys(data).find(k => k.endsWith('_id'));
        key = idField ? data[idField] : null;
      }
      if (key) existingByModelId[key] = row;
    }

    let created = 0, updated = 0;

    for (const item of allItems) {
      const rowData = {};
      for (const [tableField, apiField] of Object.entries(field_mapping)) {
        // Support nested paths like "owner/name" via template syntax "{owner}/{name}"
        if (apiField.includes('{')) {
          rowData[tableField] = apiField.replace(/\{(\w+)\}/g, (_, key) => item[key] ?? '');
        } else {
          rowData[tableField] = item[apiField];
        }
      }
      // Computed fields: derive values from item data using templates
      for (const [field, template] of Object.entries(computed_fields)) {
        if (typeof template === 'string') {
          rowData[field] = template.replace(/\{(\w+)\}/g, (_, key) => item[key] ?? '');
        }
      }
      for (const [field, value] of Object.entries(static_fields)) {
        rowData[field] = value;
      }

      let uniqueKey = rowData.model_id || rowData.post_id || rowData.id;
      if (!uniqueKey) {
        const idField = Object.keys(rowData).find(k => k.endsWith('_id'));
        uniqueKey = idField ? rowData[idField] : null;
      }
      const existing = uniqueKey ? existingByModelId[uniqueKey] : null;

      if (existing) {
        const existingData = typeof existing.data === 'string' ? JSON.parse(existing.data || '{}') : (existing.data || {});
        const newData = { ...existingData, ...rowData };
        await dbRun(
          'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(newData), new Date().toISOString(), existing.id]
        );
        updated++;
      } else {
        const baseId = 'SYNC_' + Math.random().toString(36).substr(2, 8).toUpperCase();
        await dbRun(
          'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [tableId, baseId, JSON.stringify(rowData), new Date().toISOString(), new Date().toISOString()]
        );
        created++;
      }
    }

    return { success: true, stats: { created, updated, total: allItems.length, pages: pageCount } };
  } catch (error) {
    logger.error('[API Sync] Error:', error);
    return { success: false, error: error.message };
  }
}

async function executeUpdateField(tableId, rowId, config) {
  try {
    const { column_id, value } = config;
    
    const row = await dbGet('SELECT * FROM table_rows WHERE id = ?', [rowId]);
    if (!row) {
      return { success: false, error: 'Row not found' };
    }
    
    const data = JSON.parse(row.data || '{}');
    data[column_id] = value;
    
    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), rowId]
    );
    
    return { success: true, updated: { [column_id]: value } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Evaluate a formula expression against a row's data and write the result to a
// target column. Fields are referenced with {{column_key}} placeholders.
// Safety: after substitution, a string containing ONLY digits/operators/parens
// is treated as arithmetic and evaluated in a locked-down scope; anything else
// is returned verbatim as a text template. No row value ever reaches the
// evaluator as code — only the whitelisted arithmetic charset is ever eval'd.
function evaluateFormula(formula, data) {
  const substituted = String(formula).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => {
    const v = data?.[key];
    return v === undefined || v === null ? '' : String(v);
  });

  // Arithmetic mode: only numbers, whitespace and + - * / ( ) . %
  if (/^[\s\d+\-*/().%]+$/.test(substituted) && /\d/.test(substituted)) {
    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${substituted});`)();
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    } catch {
      // fall through to template mode
    }
  }

  // Template mode: return the substituted string as-is.
  return substituted;
}

async function executeFormula(rowId, config) {
  try {
    const columnId = config.column_id || config.targetColumnId;
    const formula = config.formula;
    if (!columnId) return { success: false, error: 'No target column specified' };
    if (!formula) return { success: false, error: 'No formula specified' };
    if (!rowId) return { success: false, error: 'No row to apply the formula to' };

    const row = await dbGet('SELECT * FROM table_rows WHERE id = ?', [rowId]);
    if (!row) return { success: false, error: 'Row not found' };

    const data = JSON.parse(row.data || '{}');
    const value = evaluateFormula(formula, data);
    data[columnId] = value;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), rowId]
    );

    return { success: true, updated: { [columnId]: value } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function executeCreateRow(config, sourceRowData, sourceRowId) {
  try {
    // Support both naming conventions — parseInt guards against JSONB type coercion
    // (action_config may be stored as a JSON string inside JSONB, causing targetTableId
    // to arrive as a string instead of a number after parsing)
    const rawTargetId = config.targetTableId || config.target_table_id;
    const targetTableId = rawTargetId ? parseInt(rawTargetId, 10) : null;
    if (!targetTableId || isNaN(targetTableId)) {
      return { success: false, error: `No valid target table ID (got ${rawTargetId})` };
    }

    const newData = {};

    // Format 1: Array of { sourceColumnId, targetColumnId, staticValue }
    const fieldMappings = config.fieldMappings;
    if (Array.isArray(fieldMappings)) {
      for (const mapping of fieldMappings) {
        if (mapping.staticValue !== undefined) {
          newData[mapping.targetColumnId] = mapping.staticValue;
        } else if (mapping.sourceColumnId || mapping.source) {
          const src = mapping.sourceColumnId || mapping.source;
          const tgt = mapping.targetColumnId || mapping.target;
          newData[tgt] = sourceRowData[src];
        }
      }
    }

    // Format 2: Flat object { targetField: sourceField }
    const fieldMapping = config.field_mapping;
    if (fieldMapping && typeof fieldMapping === 'object' && !Array.isArray(fieldMapping)) {
      for (const [targetField, sourceField] of Object.entries(fieldMapping)) {
        newData[targetField] = sourceRowData[sourceField];
      }
    }

    // Static fields (separate from mappings)
    if (config.static_fields && typeof config.static_fields === 'object') {
      Object.assign(newData, config.static_fields);
    }

    // Source tracking — link created row back to source
    if (sourceRowId && config.sourceRowIdField) {
      newData[config.sourceRowIdField] = sourceRowId;
    }

    const now = new Date().toISOString();
    const baseId = 'AUTO_' + Math.random().toString(36).substr(2, 8).toUpperCase();

    const result = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [targetTableId, baseId, JSON.stringify(newData), now, now]
    );

    return { success: true, created_row_id: result.lastInsertRowid || result.lastID, data: newData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default router;
