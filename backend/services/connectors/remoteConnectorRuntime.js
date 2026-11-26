import { dbAll, dbGet } from '../../database/connection.js';
import { isRemoteMcp } from './catalogue/remote_mcp.js';
import { runRemoteMcp } from './remoteMcp.js';

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function vaultSecretRef(key) {
  return `vault:${key}`;
}

function secretKey(ref) {
  const match = /^vault:([A-Z][A-Z0-9_]*)$/.exec(String(ref || ''));
  return match?.[1] ?? null;
}

export async function resolveRemoteConnectorSettings(row) {
  const definition = parseJson(row.custom_definition, {}) || {};
  if (definition.secret_refs && typeof definition.secret_refs === 'object') {
    const refs = Object.values(definition.secret_refs);
    if (refs.length > 1) throw new Error('Remote MCP connector has unsupported secret bindings');
    const { default: secretsVault } = await import('../secrets/SecretsVault.js');
    const settings = { url: definition.url };
    const ref = secretKey(refs[0]);
    if (ref) {
      const bearerToken = await secretsVault.getSecret(ref, { spaceId: row.space_id });
      if (!bearerToken) throw new Error('Remote MCP connector secret is unavailable');
      settings.bearer_token = bearerToken;
    }
    return settings;
  }

  const { default: credentialVault } = await import('./CredentialVault.js');
  const blob = parseJson(row.encrypted_payload, {}) || {};
  const credentials = blob.v ? credentialVault.decrypt(blob) : {};
  return { url: definition.url, ...credentials };
}

function toolDefinition(row, name) {
  return {
    type: 'function',
    function: {
      name,
      description: `Remote MCP tool "${name}" approved for this space connector.`,
      parameters: { type: 'object', properties: {} },
    },
    x_connector_id: row.id,
    x_space_id: row.space_id,
  };
}

export async function resolveRemoteConnectorTools(spaceId, allowedNames = []) {
  if (!spaceId || !Array.isArray(allowedNames) || allowedNames.length === 0) return [];
  const requested = new Set(allowedNames.filter((name) => typeof name === 'string'));
  if (!requested.size) return [];
  const rows = await dbAll(
    `SELECT id, space_id, type_slug, kind, status, custom_definition
       FROM space_connectors WHERE space_id = ? AND kind = 'mcp' AND status = 'active'`,
    [spaceId],
  );
  const matches = new Map();
  for (const row of rows) {
    if (!isRemoteMcp(row.type_slug)) continue;
    const definition = parseJson(row.custom_definition, {}) || {};
    for (const name of definition.allowed_tools || []) {
      if (!requested.has(name)) continue;
      const candidates = matches.get(name) || [];
      candidates.push(row);
      matches.set(name, candidates);
    }
  }
  return [...matches.entries()]
    .filter(([, candidates]) => candidates.length === 1)
    .map(([name, candidates]) => toolDefinition(candidates[0], name));
}

export async function executeRemoteConnectorTool(toolName, args, context = {}) {
  if (!Array.isArray(context.allowedTools) || context.allowedTools.length === 0) {
    return { error: `Unknown tool: ${toolName}` };
  }
  const spaceId = Number(context.spaceId ?? context.space_id);
  const candidates = context.allowedTools.filter((tool) => (
    tool?.function?.name === toolName && tool.x_connector_id && tool.x_space_id
      && Number(tool.x_space_id) === spaceId
  ));
  if (candidates.length !== 1) {
    return { error: 'tool_not_permitted', tool: toolName, message: `Tool ${toolName} is not bound to one approved connector.` };
  }
  const binding = candidates[0];
  const row = await dbGet('SELECT * FROM space_connectors WHERE id = ? AND space_id = ?', [binding.x_connector_id, binding.x_space_id]);
  const definition = parseJson(row?.custom_definition, {}) || {};
  if (!row || row.kind !== 'mcp' || row.status !== 'active' || !isRemoteMcp(row.type_slug)
    || !definition.allowed_tools?.includes(toolName)) {
    return { error: 'tool_not_permitted', tool: toolName, message: `Tool ${toolName} is not approved for this connector.` };
  }
  try {
    const settings = await resolveRemoteConnectorSettings(row);
    return await runRemoteMcp(settings, { name: toolName, args });
  } catch {
    return { error: 'REMOTE_MCP_FAILED', tool: toolName, message: 'Remote MCP operation failed' };
  }
}
