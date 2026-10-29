import express from 'express';
import { z } from 'zod';
import { dbGet, withTransactionAsync } from '../../database/connection.js';
import { getEffectiveRole } from '../../services/EffectiveRoleService.js';
import vault from '../../services/connectors/CredentialVault.js';
import { remoteMcpSchema, runRemoteMcp } from '../../services/connectors/remoteMcp.js';
import { isRemoteMcp } from '../../services/connectors/catalogue/remote_mcp.js';
import { success, created, badRequest, forbidden, notFound, error } from '../../utils/response.js';
import { apiLogger } from '../../utils/logger.js';

const router = express.Router();
const idSchema = z.coerce.number().int().positive().max(2147483647);
const toolsSchema = z.array(z.string().min(1).max(200)).max(100);
const createSchema = z.object({
  type_slug: z.string().refine(isRemoteMcp), display_name: z.string().trim().min(1).max(200),
  fields: remoteMcpSchema, allowed_tools: toolsSchema.default([]),
}).strict();
const patchSchema = z.object({
  enabled: z.boolean().optional(), allowed_tools: toolsSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const callSchema = z.object({ name: z.string().min(1).max(200), arguments: z.record(z.unknown()).default({}) }).strict();

function publicRow(row) {
  const { encrypted_payload, ...rest } = row;
  return { ...rest, has_payload: !!encrypted_payload?.v, enabled: row.status === 'active',
    mcp: { transport: 'streamable_http' } };
}

async function requireAdmin(req, res) {
  const parsed = idSchema.safeParse(req.params.spaceId);
  if (!parsed.success) { badRequest(res, 'Invalid spaceId'); return false; }
  const { effectiveRole } = await getEffectiveRole(req.user?.id, { spaceId: parsed.data });
  if (!['owner_owner', 'owner', 'admin'].includes(effectiveRole)) {
    forbidden(res, 'Space owner or admin required'); return false;
  }
  return true;
}

async function audit(trx, req, id, action, details = {}) {
  await trx.run(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES (?, ?, 'space_connector', ?, ?::jsonb)`,
  [req.user.id, action, String(id), JSON.stringify({ space_id: Number(req.params.spaceId), ...details })]);
}

router.post('/spaces/:spaceId/connectors', async (req, res, next) => {
  if (!isRemoteMcp(req.body?.type_slug)) return next();
  try {
    if (!await requireAdmin(req, res)) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, 'Invalid remote MCP settings');
    const { type_slug, display_name, fields, allowed_tools } = parsed.data;
    const encrypted = vault.encrypt(fields.bearer_token ? { bearer_token: fields.bearer_token } : {});
    const id = await withTransactionAsync(async (trx) => {
      const result = await trx.run(`INSERT INTO space_connectors
        (space_id, type_slug, kind, display_name, status, encrypted_payload, custom_definition, created_by)
        VALUES (?, ?, 'mcp', ?, 'active', ?::jsonb, ?::jsonb, ?) RETURNING id`,
      [Number(req.params.spaceId), type_slug, display_name, JSON.stringify(encrypted),
        JSON.stringify({ url: fields.url, allowed_tools }), req.user.id]);
      await audit(trx, req, result.lastInsertRowid, 'connector.create_remote_mcp');
      return result.lastInsertRowid;
    });
    return created(res, { connector: publicRow(await dbGet('SELECT * FROM space_connectors WHERE id = ?', [id])) });
  } catch {
    return error(res, 'REMOTE_MCP_SAVE_FAILED', 'Could not save MCP connector', 503);
  }
});

// Intercept only remote rows; the existing local Blender gate remains intact.
router.all('/spaces/:spaceId/connectors/:id/:action(*)?', async (req, res, next) => {
  try {
    const sid = idSchema.safeParse(req.params.spaceId);
    const cid = idSchema.safeParse(req.params.id);
    if (!sid.success || !cid.success) return next();
    const row = await dbGet('SELECT * FROM space_connectors WHERE id = ? AND space_id = ?', [cid.data, sid.data]);
    if (!row || !isRemoteMcp(row.type_slug)) return next();
    if (!await requireAdmin(req, res)) return;
    const action = req.params.action || '';
    const definition = typeof row.custom_definition === 'string' ? JSON.parse(row.custom_definition) : row.custom_definition;
    if (req.method === 'GET' && !action) return success(res, { connector: publicRow(row) });
    if (req.method === 'PATCH' && !action) {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid MCP update');
      if (row.status === 'revoked') return error(res, 'CONNECTOR_REVOKED', 'Connector revoked', 409);
      const enabled = parsed.data.enabled ?? null;
      const allowedTools = parsed.data.allowed_tools ? JSON.stringify(parsed.data.allowed_tools) : null;
      await withTransactionAsync(async (trx) => {
        await trx.run(`UPDATE space_connectors SET
          status = CASE WHEN ?::boolean IS NULL THEN status WHEN ?::boolean THEN 'active' ELSE 'disabled' END,
          custom_definition = CASE WHEN ?::jsonb IS NULL THEN custom_definition ELSE jsonb_set(custom_definition, '{allowed_tools}', ?::jsonb) END,
          updated_at = now() WHERE id = ? AND status <> 'revoked'`, [enabled, enabled, allowedTools, allowedTools, row.id]);
        await audit(trx, req, row.id, 'connector.update_remote_mcp');
      });
      return success(res, { connector: publicRow(await dbGet('SELECT * FROM space_connectors WHERE id = ?', [row.id])) });
    }
    if (req.method === 'DELETE' && !action) {
      await withTransactionAsync(async (trx) => {
        await trx.run("UPDATE space_connectors SET status = 'revoked', encrypted_payload = '{}'::jsonb, updated_at = now() WHERE id = ?", [row.id]);
        await audit(trx, req, row.id, 'connector.delete_remote_mcp');
      });
      return success(res, { id: row.id, status: 'revoked' });
    }
    if (!((req.method === 'POST' && ['test', 'tools/call'].includes(action)) || (req.method === 'GET' && action === 'tools'))) {
      return notFound(res, 'Remote MCP operation');
    }
    if (row.status !== 'active') return error(res, 'CONNECTOR_INACTIVE', 'Connector is not active', 409);
    let call;
    if (action === 'tools/call') {
      const parsed = callSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Invalid MCP tool call');
      if (!definition.allowed_tools?.includes(parsed.data.name)) return forbidden(res, 'Tool not approved for this connector');
      call = { name: parsed.data.name, args: parsed.data.arguments };
    }
    // Audit the attempt BEFORE side effects, never store arguments or results.
    await withTransactionAsync((trx) => audit(trx, req, row.id, `connector.remote_${action.replace('/', '_')}`, { tool: call?.name }));
    let result;
    let ok = false;
    try {
      const blob = typeof row.encrypted_payload === 'string' ? JSON.parse(row.encrypted_payload) : row.encrypted_payload;
      const credentials = vault.decrypt(blob);
      const settings = { url: definition.url, ...credentials };
      result = call ? await runRemoteMcp(settings, call) : await runRemoteMcp(settings);
      ok = true;
    } catch {
      apiLogger.warn({ connectorId: row.id }, 'Remote MCP operation failed');
    }
    await withTransactionAsync(async (trx) => {
      if (action === 'test') await trx.run(`UPDATE space_connectors SET last_checked_at = now(), last_error = ?, updated_at = now() WHERE id = ?`,
        [ok ? null : 'Remote MCP connection failed', row.id]);
      await audit(trx, req, row.id, 'connector.remote_result', { ok, tool: call?.name });
    });
    if (action === 'test') return success(res, {
      connector: publicRow(await dbGet('SELECT * FROM space_connectors WHERE id = ?', [row.id])),
      check: { ok, checked_at: new Date().toISOString(), ...(ok ? { tool_count: result.tools.length, server_info: result.server_info } : { error_code: 'remote', error: 'Remote MCP connection failed' }) },
    });
    if (!ok) return error(res, 'REMOTE_MCP_FAILED', 'Remote MCP operation failed', 502);
    return success(res, result);
  } catch {
    return error(res, 'REMOTE_MCP_FAILED', 'Remote MCP operation failed', 503);
  }
});

export default router;
