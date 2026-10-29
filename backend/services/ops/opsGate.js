/**
 * Ops-profile gate token (diagnostics / local-qa, Constitution v4.3 profiles).
 *
 * Same shape as the MCP connector gate (services/connectors/mcpGate.js):
 *
 *  1. Spawn time — `buildOpsGateEnv()` runs in the CLI provider before every
 *     agent child and, only when the agent currently holds a live grant, mints
 *     a short-lived token into the child env. The token carries the identity
 *     the server dispatched (agent, space); the agent cannot choose it, and
 *     AGENT_ID alone is not trusted because a shell child can set any env.
 *  2. Every tool call — the `ops_run_check` tool presents that token to
 *     POST /api/v3/ops/run, which re-reads the grant and the agent row.
 *     Revoking the grant therefore cuts a session that is already open; the
 *     token alone never grants anything.
 */

import jwt from 'jsonwebtoken';
import { dbGet } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'ops_gate' });

const TOKEN_TYP = 'ops_gate';
const TOKEN_TTL = '6h'; // longer than any turn; the grant is re-read per call anyway

export const OPS_TOKEN_ENV = 'GODCRM_OPS_GATE_TOKEN';
export const OPS_URL_ENV = 'GODCRM_OPS_GATE_URL';

export function signOpsGateToken({ agentId, spaceId, jobId }) {
  return jwt.sign(
    {
      typ: TOKEN_TYP,
      agent_id: Number(agentId),
      space_id: Number(spaceId),
      ...(jobId != null ? { dispatch_job_id: String(jobId) } : {}),
    },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/** Throws on a bad signature, expiry, or a JWT that is not an ops gate token. */
export function verifyOpsGateToken(token) {
  const claims = jwt.verify(String(token), process.env.JWT_SECRET);
  if (!claims || claims.typ !== TOKEN_TYP
    || !Number.isInteger(claims.agent_id) || !Number.isInteger(claims.space_id)) {
    throw new Error('not an ops_gate token');
  }
  return claims;
}

export function opsGateUrl() {
  const port = process.env.PORT || 5000;
  return `http://127.0.0.1:${port}/api/v3/ops`;
}

/**
 * Env to merge into an agent child process. Empty when the agent holds no
 * live grant in this space — and empty (with a warning) on any failure, so a
 * gate problem can never stop an agent turn from starting.
 */
export async function buildOpsGateEnv({ agentId, spaceId, jobId } = {}) {
  if (agentId == null || spaceId == null || !process.env.JWT_SECRET) return {};
  try {
    // A live grant of either kind mints the token; the token itself grants
    // nothing — every call re-reads the grant it names (ops or staging).
    let live = await dbGet(
      `SELECT 1 AS ok FROM ops_grants
        WHERE agent_id = ? AND space_id = ? AND revoked_at IS NULL AND expires_at > now()
       UNION ALL
       SELECT 1 FROM ops_staging_grants
        WHERE agent_id = ? AND space_id = ? AND revoked_at IS NULL AND expires_at > now()
       LIMIT 1`,
      [Number(agentId), Number(spaceId), Number(agentId), Number(spaceId)]
    );
    // Browser grants are separate; a missing optional migration must not affect
    // existing diagnostics/local QA token issuance. No grants are issued here.
    if (!live && jobId != null) {
      try {
        live = await dbGet(`SELECT 1 AS ok FROM ops_browser_grants
          WHERE agent_id = ? AND space_id = ? AND job_id = ?
            AND revoked_at IS NULL AND expires_at > now() LIMIT 1`,
        [Number(agentId), Number(spaceId), String(jobId)]);
      } catch { /* Browser channel is not installed: fail closed. */ }
    }
    if (!live) return {};
    return {
      [OPS_TOKEN_ENV]: signOpsGateToken({ agentId, spaceId, jobId }),
      [OPS_URL_ENV]: opsGateUrl(),
    };
  } catch (err) {
    log.warn({ err: err?.message, agentId, spaceId }, 'ops gate env skipped');
    return {};
  }
}
