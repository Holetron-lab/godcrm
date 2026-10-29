import { browserRequestSchema, browserArtifactRequestSchema } from '../ops/stagingBrowserContract.js';
import { OPS_TOKEN_ENV, OPS_URL_ENV } from '../ops/opsGate.js';

async function browserTool(operation, args) {
  const request = (operation === 'artifact' ? browserArtifactRequestSchema : browserRequestSchema).safeParse(args);
  if (!request.success) return { decision: 'DENY', reason: 'invalid_browser_request' };
  const token = process.env[OPS_TOKEN_ENV];
  const base = process.env[OPS_URL_ENV];
  if (!token || !base) return { decision: 'DENY', reason: 'no_gate_token' };
  try {
    const response = await fetch(`${base}/browser/${operation}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(request.data), signal: AbortSignal.timeout(330000),
    });
    const result = await response.json();
    return response.ok && result.success ? result.data : result.error;
  } catch { return { decision: 'BLOCKED', reason: 'broker_unavailable' }; }
}
export const browserToolHandlers = {
  ops_browser_artifact: args => browserTool('artifact', args),
  ops_browser_preflight: args => browserTool('preflight', args),
  ops_browser_run: args => browserTool('run', args),
};
