/**
 * Shared agent resolution helpers for CRUD controllers.
 * Resolves model and provider references from row IDs to full data.
 */

import { dbGet } from '../../../database/connection.js';
import { safeParseJSON } from './shared.js';

/**
 * Resolve a model reference (row ID or string) to model details.
 */
export async function resolveModel(modelRef) {
  if (typeof modelRef === 'number') {
    const modelRow = await dbGet(`
      SELECT tr.data FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE tr.id = ? AND (ut.name LIKE '%Models%' OR ut.name LIKE '%models%')
    `, [modelRef]);
    if (modelRow) {
      const modelData = safeParseJSON(modelRow.data, {});
      return {
        id: modelRef,
        name: modelData.name || modelData.model_id,
        model_id: modelData.model_id || modelData.api_id || 'gpt-4o'
      };
    }
  }
  return { id: null, name: modelRef, model_id: modelRef || 'gpt-4o' };
}

/**
 * Resolve a provider/operator reference (row ID or string) to provider details.
 */
export async function resolveProvider(providerRef) {
  if (typeof providerRef === 'number') {
    const providerRow = await dbGet(`
      SELECT tr.data FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE tr.id = ? AND (ut.name LIKE '%Operators%' OR ut.name LIKE '%Providers%')
    `, [providerRef]);
    if (providerRow) {
      const providerData = safeParseJSON(providerRow.data, {});
      return {
        id: providerRef,
        name: providerData.name,
        api_identifier: (providerData.provider || providerData.api_identifier || providerData.name || 'openai').toLowerCase()
      };
    }
  }
  return { id: null, name: providerRef, api_identifier: providerRef || 'openai' };
}

/**
 * Parse agent row data into a standardized agent object.
 */
export function parseAgentRow(row, data, extra = {}) {
  let tools = [];
  if (data.tools) {
    try {
      tools = typeof data.tools === 'string' ? safeParseJSON(data.tools, {}) : data.tools;
    } catch (e) {
      tools = [];
    }
  }

  let tags = [];
  if (data.tags) {
    try {
      tags = typeof data.tags === 'string' ? safeParseJSON(data.tags, []) : (Array.isArray(data.tags) ? data.tags : []);
    } catch (e) {
      tags = [];
    }
  }

  const isActive = data.is_active === true || data.is_active === 1 ||
    data.is_active === 'true' || data.is_active === '1' || data.status === 'active';

  return {
    id: row.id,
    name: data.name || data.agent_name || 'Unnamed Agent',
    description: data.description || '',
    system_prompt: data.system_prompt || '',
    icon: data.icon || data.avatar || '🤖',
    color: data.color || '#3B82F6',
    is_active: isActive,
    api_key_id: data.api_key_id || null,
    tools,
    tags,
    operator_id: data.operator_id,
    status: data.status || 'active',
    response_mode: data.response_mode || 'mention_only',
    // ADR-0057 — surface invocation_mode and main_instructions to clients so
    // the edit modal can show current state. Both default to null and are
    // tolerant of missing keys (legacy rows pre-ADR-0057).
    invocation_mode: data.invocation_mode || null,
    main_instructions: data.main_instructions ?? data.main_instruction ?? null,
    tables_config: data.tables_config || null,
    context_settings: data.context_settings || null,
    // ADR-0079: surface agent_slug + visibility so frontend agentVisibility filter
    // and the promo-unlock merge below in agentCrudController can both run.
    agent_slug: data.agent_slug || data.slug || null,
    visibility: data.visibility || 'default',
    ...extra
  };
}
