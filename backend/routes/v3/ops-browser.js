import express from 'express';
import { verifyOpsGateToken } from '../../services/ops/opsGate.js';
import { OpsDenied } from '../../services/ops/opsBroker.js';
import { browserPreflight, browserPreflightSummary, runBrowserSuite, readBrowserArtifact } from '../../services/ops/stagingBrowserBroker.js';
import { apiLogger } from '../../utils/logger.js';

export const browserGateRouter = express.Router();
for (const operation of ['preflight', 'run', 'artifact']) {
  browserGateRouter.post(`/browser/${operation}`, async (req, res) => {
    let claims;
    try { claims = verifyOpsGateToken((req.get('authorization') || '').replace(/^Bearer /, '')); }
    catch { return res.status(401).json({ success: false, error: { decision: 'DENY', reason: 'invalid_gate_token' } }); }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    try {
      const input = { claims, body: req.body, signal: controller.signal };
      const data = operation === 'artifact' ? await readBrowserArtifact(input) : operation === 'run' ? await runBrowserSuite(input) : browserPreflightSummary(await browserPreflight(input));
      return res.json({ success: true, data });
    } catch (err) {
      const known = err instanceof OpsDenied;
      const status = known ? err.status : 503;
      const reason = known ? err.reason : 'browser_backend_unavailable';
      apiLogger.warn({ module: 'staging_browser', reason, job_id: claims.dispatch_job_id }, 'browser request refused');
      return res.status(status).json({ success: false, error: { decision: status >= 500 ? 'BLOCKED' : 'DENY', reason } });
    } finally { res.removeListener('close', cancel); }
  });
}
