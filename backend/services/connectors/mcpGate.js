/**
 * Runtime gate for MCP-kind connectors.
 *
 * Two moments decide whether an agent turn may open an MCP launcher:
 *
 *  1. Spawn time — `buildMcpGateEnv()` runs in the CLI provider before every
 *     `claude -p` and, only when the connector is active AND the turn belongs
 *     to the pinned agent in the pinned space, mints a short-lived gate token
 *     into the child env. No token → the wrapper exposes zero tools.
 *  2. Every tool call — the wrapper presents that token to
 *     GET /api/v3/connectors/mcp-gate, which re-reads the row. Flipping the
 *     connector off therefore cuts sessions that are already open; the token
 *     alone never grants anything.
 *
 * Nothing here consults the request body for agent/space: the token claims
 * are set from the turn that was actually dispatched, and the allowed pair
 * comes from the catalogue type's server-side config.
 */

import jwt from 'jsonwebtoken';
import { dbAll } from '../../database/connection.js';
import { listConnectorTypes, getConnectorType } from './catalogue/index.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'mcp_gate' });

const TOKEN_TYP = 'mcp_gate';
const TOKEN_TTL = '6h'; // longer than any agent turn; the row is re-read per call anyway

export const GATE_URL_ENV = 'GODCRM_MCP_GATE_URL';
/** Env var carrying the gate token for one MCP connector type. */
export const GATE_TOKEN_ENV = (slug) => `GODCRM_MCP_GATE_TOKEN_${String(slug).toUpperCase()}`;

/**
 * Decide whether `agentId` in `spaceId` may use the MCP connector `row`.
 * Pure: takes the row and the type config, returns {allowed, reason}.
 */
export function evaluateMcpAccess({ row, agentId, spaceId }) {
  if (!row) return { allowed: false, reason: 'no_connector' };
  if (row.kind !== 'mcp') return { allowed: false, reason: 'not_mcp' };
  if (row.status !== 'active') return { allowed: false, reason: row.status || 'inactive' };
  const type = getConnectorType(row.type_slug);
  const cfg = type && typeof type.config === 'function' ? type.config() : null;
  if (!cfg || !cfg.configured) return { allowed: false, reason: 'not_configured' };
  if (Number(agentId) !== cfg.allowed_agent_id) return { allowed: false, reason: 'agent_not_allowed' };
  if (Number(spaceId) !== cfg.allowed_space_id || Number(row.space_id) !== cfg.allowed_space_id) {
    return { allowed: false, reason: 'space_not_allowed' };
  }
  return { allowed: true, reason: 'ok' };
}

export function signMcpGateToken({ connectorId, agentId, spaceId, jobId }) {
  return jwt.sign(
    {
      typ: TOKEN_TYP,
      connector_id: Number(connectorId),
      agent_id: Number(agentId),
      space_id: Number(spaceId),
      ...(jobId != null ? { job_id: String(jobId) } : {}),
    },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/** Throws on a bad signature, expiry, or a JWT that is not a gate token. */
export function verifyMcpGateToken(token) {
  const claims = jwt.verify(String(token), process.env.JWT_SECRET);
  if (!claims || claims.typ !== TOKEN_TYP || !Number.isFinite(Number(claims.connector_id))) {
    throw new Error('not an mcp_gate token');
  }
  return claims;
}

function gateUrl() {
  const port = process.env.PORT || 5000;
  return `http://127.0.0.1:${port}/api/v3/connectors/mcp-gate`;
}

/**
 * Env to merge into an agent child process. Empty when nothing is allowed —
 * and empty (with a warning) on any failure, so a gate problem can never
 * stop an agent turn from starting.
 *
 * @param {{agentId?:number|string, spaceId?:number|string, jobId?:number|string}} turn
 * @returns {Promise<Record<string,string>>}
 */
export async function buildMcpGateEnv({ agentId, spaceId, jobId } = {}) {
  if (agentId == null || spaceId == null || !process.env.JWT_SECRET) return {};
  const mcpSlugs = listConnectorTypes().filter((t) => t.auth_kind === 'mcp').map((t) => t.slug);
  if (!mcpSlugs.length) return {};
  try {
    const rows = await dbAll(
      `SELECT id, space_id, type_slug, kind, status
         FROM space_connectors
        WHERE space_id = ? AND kind = 'mcp' AND status = 'active' AND type_slug = ANY(?)`,
      [Number(spaceId), mcpSlugs]
    );
    const env = {};
    for (const row of rows) {
      const verdict = evaluateMcpAccess({ row, agentId, spaceId });
      if (!verdict.allowed) continue;
      env[GATE_TOKEN_ENV(row.type_slug)] = signMcpGateToken({ connectorId: row.id, agentId, spaceId, jobId });
    }
    if (Object.keys(env).length) env[GATE_URL_ENV] = gateUrl();
    return env;
  } catch (err) {
    log.warn({ err: err?.message, agentId, spaceId }, 'mcp gate env skipped');
    return {};
  }
}
