// AutomationTriggerService.js
// Ticket #43305: Fire automation triggers on row creation
// Looks up active automations and executes corresponding actions

import crypto from 'crypto';
import { dbAll, dbGet, dbRun } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { enrichSkill } from './SkillEnrichmentService.js';
import { sendMessage, sendAdminAlert } from './TelegramService.js';
import { executeTicketRouting } from './schedule-trigger/pipeline-executors.js';

/**
 * Find automation tables (automations_list and automation_logs_list)
 * for the space that contains the given table.
 * Same pattern as findOrCreateAutomationTables in automations.js,
 * but read-only — does not create tables if they don't exist.
 *
 * @param {number} tableId - The table ID to find automations for
 * @returns {Promise<{automationsTableId: number, logsTableId: number}|null>}
 */
async function findAutomationTables(tableId) {
  // Get project and space for this table
  const table = await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [tableId]);
  if (!table) return null;

  const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [table.project_id]);
  if (!project) return null;

  // Find System Data project in this space
  const systemDataProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [project.space_id]
  );
  if (!systemDataProject) return null;

  // Find automations_list table
  const automationsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automations_list'",
    [systemDataProject.id]
  );
  if (!automationsTable) return null;

  // Find automation_logs_list table
  const logsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automation_logs_list'",
    [systemDataProject.id]
  );
  if (!logsTable) return null;

  return {
    automationsTableId: automationsTable.id,
    logsTableId: logsTable.id
  };
}

/**
 * Get active automations for a table with a specific trigger type
 *
 * @param {number} automationsTableId - The automations_list table ID
 * @param {number} tableId - The target table ID to filter by
 * @param {string} triggerType - The trigger type to filter by (e.g., 'row_create')
 * @returns {Promise<Array>} Active automations matching the criteria
 */
async function getActiveAutomations(automationsTableId, tableId, triggerType) {
  const rows = await dbAll(
    'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC',
    [automationsTableId]
  );

  return rows
    .map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return { id: row.id, ...data };
    })
    .filter(a =>
      a.table_id === tableId &&
      a.trigger_type === triggerType &&
      a.is_active !== false &&
      a.is_active !== 0
    )
    .map(a => ({
      ...a,
      trigger_config: typeof a.trigger_config === 'string'
        ? JSON.parse(a.trigger_config || '{}')
        : (a.trigger_config || {}),
      action_config: typeof a.action_config === 'string'
        ? JSON.parse(a.action_config || '{}')
        : (a.action_config || {})
    }));
}

/**
 * Log an automation execution result to the automation_logs_list table
 *
 * @param {number} logsTableId - The automation_logs_list table ID
 * @param {Object} logEntry - Log data
 */
async function logAutomationExecution(logsTableId, logEntry) {
  try {
    const now = new Date().toISOString();
    const logBaseId = `autolog_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const logData = {
      automation_id: logEntry.automationId,
      automation_name: logEntry.automationName,
      row_id: logEntry.rowId,
      status: logEntry.status,
      trigger_data: JSON.stringify(logEntry.triggerData || {}),
      result_data: JSON.stringify(logEntry.resultData || {}),
      error_message: logEntry.errorMessage || null,
      duration_ms: logEntry.durationMs,
      executed_at: now
    };

    await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [logsTableId, logBaseId, JSON.stringify(logData), now, now]
    );
  } catch (err) {
    apiLogger.error({ err, logEntry }, '[AutomationTrigger] Failed to write automation log');
  }
}

/**
 * Update automation run count and last_run timestamp
 *
 * @param {number} automationRowId - The automation row ID in table_rows
 * @param {Object} automationData - Current automation data
 */
async function updateAutomationRunStats(automationRowId, automationData) {
  try {
    const now = new Date().toISOString();
    automationData.run_count = (automationData.run_count || 0) + 1;
    automationData.last_run = now;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(automationData), now, automationRowId]
    );
  } catch (err) {
    apiLogger.error({ err, automationRowId }, '[AutomationTrigger] Failed to update automation run stats');
  }
}

/**
 * Execute the ai_enrich action: call SkillEnrichmentService and update the row
 *
 * @param {number} tableId - The table the row belongs to
 * @param {number} rowId - The row ID to enrich
 * @param {Object} rowData - The current row data
 * @returns {Promise<Object>} Result with success/error
 */
async function executeAiEnrich(tableId, rowId, rowData) {
  const result = await enrichSkill(rowData);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  // Merge enrichment into existing row data
  const enrichedData = {
    ...rowData,
    tags: result.enrichment.tags,
    risk_level: result.enrichment.risk_level,
    rating: result.enrichment.rating,
    category: result.enrichment.category,
    platform: result.enrichment.platform
  };

  // Update the row in the database
  const now = new Date().toISOString();
  await dbRun(
    'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(enrichedData), now, rowId]
  );

  return {
    success: true,
    enrichment: result.enrichment,
    durationMs: result.durationMs
  };
}

/**
 * Execute a webhook action (same pattern as automations.js)
 *
 * @param {Object} config - Action config with url, method, headers
 * @param {Object} rowData - Row data to send
 * @returns {Promise<Object>} Result
 */
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
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute an update_field action
 *
 * @param {number} tableId - Table ID
 * @param {number} rowId - Row ID
 * @param {Object} config - Action config with column_id and value
 * @returns {Promise<Object>} Result
 */
async function executeUpdateField(tableId, rowId, config) {
  try {
    const { column_id, value } = config;

    const row = await dbGet('SELECT id, data FROM table_rows WHERE id = ?', [rowId]);
    if (!row) {
      return { success: false, error: 'Row not found' };
    }

    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    data[column_id] = value;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), rowId]
    );

    return { success: true, updated: { [column_id]: value } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Evaluate conditions against row data
 * @param {Array} conditions - Array of { field, operator, value }
 * @param {Object} rowData - Row data to evaluate
 * @returns {{ pass: boolean, failedCondition?: string }}
 */
function evaluateConditions(conditions, rowData) {
  if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
    return { pass: true };
  }

  for (const cond of conditions) {
    const value = rowData[cond.field];
    const expected = cond.value;
    const strValue = String(value || '').toLowerCase();
    const strExpected = String(expected || '').toLowerCase();

    let passes = false;
    switch (cond.operator) {
      case 'equals':
        passes = strValue === strExpected;
        break;
      case 'not_equals':
        passes = strValue !== strExpected;
        break;
      case 'contains':
        passes = strValue.includes(strExpected);
        break;
      case 'not_contains':
        passes = !strValue.includes(strExpected);
        break;
      case 'is_empty':
        passes = !value || value === '' || value === null || value === undefined;
        break;
      case 'is_not_empty':
        passes = !!value && value !== '' && value !== null;
        break;
      case 'greater_than':
        passes = Number(value) > Number(expected);
        break;
      case 'less_than':
        passes = Number(value) < Number(expected);
        break;
      default:
        passes = true;
    }

    if (!passes) {
      return { pass: false, failedCondition: `${cond.field} ${cond.operator} ${expected} (actual: ${value})` };
    }
  }

  return { pass: true };
}

/**
 * Execute a create_row action — supports both flat and array field mapping formats.
 *
 * Flat format:   { target_table_id, field_mapping: { targetField: "sourceField" } }
 * Array format:  { targetTableId, fieldMappings: [{ sourceColumnId, targetColumnId, staticValue }], conditions: [...] }
 *
 * @param {Object} config - Action config
 * @param {Object} sourceRowData - Source row data
 * @param {number} [sourceRowId] - Optional source row ID for back-linking
 * @returns {Promise<Object>} Result
 */
export async function executeCreateRow(config, sourceRowData, sourceRowId) {
  try {
    // parseInt guards against JSONB type coercion — action_config may be stored as
    // a JSON string inside JSONB, causing targetTableId to arrive as a string
    const rawTargetId = config.targetTableId || config.target_table_id;
    const targetTableId = rawTargetId ? parseInt(rawTargetId, 10) : null;
    if (!targetTableId || isNaN(targetTableId)) {
      return { success: false, error: `No valid target table ID specified (got ${rawTargetId})` };
    }

    // Evaluate conditions first — skip row if conditions don't match
    const conditions = config.conditions || config.action_conditions;
    const condResult = evaluateConditions(conditions, sourceRowData);
    if (!condResult.pass) {
      return { success: true, skipped: true, reason: condResult.failedCondition };
    }

    // Build new row data from field mappings
    const newData = {};

    // Format 1: Array of { sourceColumnId, targetColumnId, staticValue }
    const fieldMappings = config.fieldMappings;
    if (Array.isArray(fieldMappings)) {
      for (const mapping of fieldMappings) {
        if (mapping.staticValue !== undefined) {
          newData[mapping.targetColumnId] = mapping.staticValue;
        } else if (mapping.sourceColumnId) {
          newData[mapping.targetColumnId] = sourceRowData[mapping.sourceColumnId];
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

    // Idempotent upsert (opt-in): when the action declares `upsertKey` and the
    // new row carries a non-empty value for it, update the existing target row
    // with the same key instead of inserting a duplicate. This makes re-runs
    // (e.g. blog → public mirror on every re-publish, or post-publish edits)
    // propagate into the existing row rather than spawning duplicates. Without
    // `upsertKey` the action keeps its original insert-only behaviour.
    const upsertKey = config.upsertKey || config.upsert_key;
    const upsertVal = upsertKey ? newData[upsertKey] : undefined;
    if (upsertKey && upsertVal !== undefined && upsertVal !== null && upsertVal !== '') {
      const existing = await dbGet(
        'SELECT id, data FROM table_rows WHERE table_id = ? AND data->>? = ? LIMIT 1',
        [targetTableId, upsertKey, String(upsertVal)]
      );
      if (existing) {
        const existingData = typeof existing.data === 'string'
          ? JSON.parse(existing.data || '{}')
          : (existing.data || {});
        const merged = { ...existingData, ...newData };
        await dbRun(
          'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(merged), now, existing.id]
        );
        return { success: true, updated_row_id: existing.id, upserted: true, data: merged };
      }
    }

    const baseId = 'AUTO_' + Math.random().toString(36).substr(2, 8).toUpperCase();

    const result = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [targetTableId, baseId, JSON.stringify(newData), now, now]
    );

    const createdRowId = result.lastID || result.lastInsertRowid;

    return { success: true, created_row_id: createdRowId, data: newData };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a notification action — supports Telegram and in-app
 *
 * @param {Object} config - Action config with notificationType, recipients, messageTemplate
 * @param {Object} rowData - Row data for template substitution
 * @returns {Promise<Object>} Result
 */
async function executeNotification(config, rowData) {
  try {
    const { notificationType, recipients, messageTemplate, subject } = config;

    // Build message from template (replace {{field}} with rowData values)
    let text = messageTemplate || JSON.stringify(rowData, null, 2);
    if (messageTemplate) {
      text = messageTemplate.replace(/\{\{(\w+)\}\}/g, (match, field) => {
        return rowData[field] !== undefined ? String(rowData[field]) : match;
      });
    }

    switch (notificationType) {
      case 'telegram': {
        // Send to each recipient (chat_id) or admin if none specified
        const chatIds = recipients && recipients.length > 0 ? recipients : [];
        if (chatIds.length === 0) {
          const res = await sendAdminAlert(text);
          return { success: res.success, type: 'telegram', target: 'admin' };
        }
        const results = [];
        for (const chatId of chatIds) {
          const res = await sendMessage(chatId, text);
          results.push({ chatId, success: res.success });
        }
        return { success: results.every(r => r.success), type: 'telegram', results };
      }

      case 'email':
        // TODO: Wire to SMTPService when needed
        return { success: true, type: 'email', message: 'Email notification not yet wired' };

      case 'slack':
        return { success: true, type: 'slack', message: 'Slack notification not yet wired' };

      case 'in_app':
      default:
        return { success: true, type: notificationType || 'in_app', message: 'In-app notification logged' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Run a single automation: condition gate + action dispatch + log + run-stats.
 * Shared between row_create and row_update trigger fans-out.
 */
async function executeAutomation(automation, tableId, rowId, rowData, tables) {
  const startTime = Date.now();
  let result;

  try {
    if (automation.action_type !== 'create_row') {
      const actionConditions = automation.action_config?.conditions || automation.action_config?.action_conditions;
      const condCheck = evaluateConditions(actionConditions, rowData);
      if (!condCheck.pass) {
        result = { success: true, skipped: true, reason: condCheck.failedCondition };
        const durationMs = Date.now() - startTime;
        await logAutomationExecution(tables.logsTableId, {
          automationId: automation.id, automationName: automation.name, rowId,
          status: 'success', triggerData: rowData, resultData: result, errorMessage: null, durationMs
        });
        apiLogger.info({ automationId: automation.id, automationName: automation.name, skipped: true, reason: condCheck.failedCondition },
          '[AutomationTrigger] Automation skipped (conditions not met)');
        return;
      }
    }

    switch (automation.action_type) {
      case 'ai_enrich':
        result = await executeAiEnrich(tableId, rowId, rowData);
        break;
      case 'webhook':
      case 'n8n':
        result = await executeWebhook(automation.action_config, rowData);
        break;
      case 'update_field':
        result = await executeUpdateField(tableId, rowId, automation.action_config);
        break;
      case 'create_row':
        result = await executeCreateRow(automation.action_config, rowData, rowId);
        break;
      case 'send_notification':
      case 'notification':
        result = await executeNotification(automation.action_config, rowData);
        break;
      case 'ticket_routing':
        result = await executeTicketRouting(automation.action_config, rowData, rowId);
        break;
      default:
        result = { success: false, error: 'Unknown action type: ' + automation.action_type };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  const durationMs = Date.now() - startTime;

  await logAutomationExecution(tables.logsTableId, {
    automationId: automation.id,
    automationName: automation.name,
    rowId,
    status: result.success ? 'success' : 'error',
    triggerData: rowData,
    resultData: result,
    errorMessage: result.error || null,
    durationMs
  });

  await updateAutomationRunStats(automation.id, automation);

  apiLogger.info(
    { automationId: automation.id, automationName: automation.name, success: result.success, durationMs },
    '[AutomationTrigger] Automation executed'
  );
}

/**
 * Fire all row_create automations for a given table and row.
 * Non-blocking — call without await.
 */
export async function fireRowCreateTriggers(tableId, rowId, rowData) {
  try {
    const tables = await findAutomationTables(tableId);
    if (!tables) return;

    const automations = await getActiveAutomations(tables.automationsTableId, tableId, 'row_create');
    if (automations.length === 0) return;

    apiLogger.info(
      { tableId, rowId, automationCount: automations.length },
      '[AutomationTrigger] Firing row_create triggers'
    );

    for (const automation of automations) {
      await executeAutomation(automation, tableId, rowId, rowData, tables);
    }
  } catch (err) {
    apiLogger.error({ err, tableId, rowId }, '[AutomationTrigger] Error firing row_create triggers');
  }
}

/**
 * Fire row_update automations for a given table and row.
 * Watch-field gating prevents action loops: an automation only fires when the
 * field named by trigger_config.watch_field actually changed (and, if
 * trigger_config.equals is set, when the new value matches it). An
 * `update_field` action that mutates a different column won't re-fire,
 * because the watched field stayed the same on the second pass.
 *
 * trigger_config (all optional):
 *   - watch_field {string}   — only fire when this field's value changed
 *   - equals      {any}      — only fire when newValue === equals
 *
 * Non-blocking — call without await.
 */
export async function fireRowUpdateTriggers(tableId, rowId, newData, oldData) {
  try {
    const tables = await findAutomationTables(tableId);
    if (!tables) return;

    const automations = await getActiveAutomations(tables.automationsTableId, tableId, 'row_update');
    if (automations.length === 0) return;

    const safeOld = oldData || {};
    const matched = automations.filter(a => {
      const cfg = a.trigger_config || {};
      const field = cfg.watch_field;
      if (!field) return true;
      const before = safeOld[field];
      const after = newData ? newData[field] : undefined;
      if (before === after) return false;
      if (Object.prototype.hasOwnProperty.call(cfg, 'equals')) {
        // Loose equality so JSONB number/string round-trips don't miss matches.
        // eslint-disable-next-line eqeqeq
        return after == cfg.equals;
      }
      return true;
    });

    if (matched.length === 0) return;

    apiLogger.info(
      { tableId, rowId, automationCount: matched.length },
      '[AutomationTrigger] Firing row_update triggers'
    );

    for (const automation of matched) {
      await executeAutomation(automation, tableId, rowId, newData, tables);
    }
  } catch (err) {
    apiLogger.error({ err, tableId, rowId }, '[AutomationTrigger] Error firing row_update triggers');
  }
}

export default { fireRowCreateTriggers, fireRowUpdateTriggers };
