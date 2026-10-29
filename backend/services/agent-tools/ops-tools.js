/**
 * Ops profile tools — thin authenticated client of the ops broker.
 *
 * Handles: ops_grant_info, ops_run_check, ops_staging_grant_info, ops_staging_preflight
 *
 * The gate token and URL come from the process env the CLI provider set at
 * spawn (services/ops/opsGate.js). No token → nothing is allowed; the tool
 * never derives identity from its arguments or from AGENT_ID.
 */

import { browserToolHandlers } from './browser-tools.js';
import { OPS_TOKEN_ENV, OPS_URL_ENV } from '../ops/opsGate.js';
import { aiLogger } from '../../utils/logger.js';

const log = aiLogger.child({ module: 'ops_tools' });
const REQUEST_KEYS = ['action', 'job_id', 'candidate_sha', 'suite_id'];
const STAGING_REQUEST_KEYS = ['action', 'job_id', 'candidate_sha'];

async function callBroker(method, pathname, body) {
  const token = process.env[OPS_TOKEN_ENV];
  const base = process.env[OPS_URL_ENV];
  if (!token || !base) return { error: 'ops_denied', reason: 'no_gate_token' };
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(17 * 60 * 1000),
    });
  } catch (err) {
    log.warn({ err: err?.message }, 'ops broker unreachable');
    return { error: 'ops_denied', reason: 'broker_unreachable' };
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    return { error: 'ops_denied', reason: json?.error?.reason || json?.error?.code || `http_${res.status}` };
  }
  return json.data;
}

export const opsToolHandlers = {
  ...browserToolHandlers,
  async ops_grant_info() {
    return callBroker('GET', '/grant');
  },

  async ops_run_check(args = {}) {
    // Strict shape here too: the schema is advisory for some clients, and an
    // extra field must never travel to the broker.
    const extra = Object.keys(args).filter((k) => !REQUEST_KEYS.includes(k));
    if (extra.length) return { error: 'ops_denied', reason: 'unexpected_field' };
    const body = {};
    for (const key of REQUEST_KEYS) if (args[key] !== undefined) body[key] = args[key];
    return callBroker('POST', '/run', body);
  },

  async ops_staging_grant_info() {
    return callBroker('GET', '/staging/grant');
  },

  async ops_staging_preflight(args = {}) {
    // Exactly {action, job_id, candidate_sha}; no suite, no target, no command.
    const extra = Object.keys(args).filter((k) => !STAGING_REQUEST_KEYS.includes(k));
    if (extra.length) return { error: 'ops_denied', reason: 'unexpected_field' };
    const body = {};
    for (const key of STAGING_REQUEST_KEYS) if (args[key] !== undefined) body[key] = args[key];
    return callBroker('POST', '/staging/preflight', body);
  },
};

export default opsToolHandlers;
