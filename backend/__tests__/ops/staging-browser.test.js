// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { browserRequestSchema, browserReportSchema, BROWSER_SUITES } from '../../services/ops/stagingBrowserContract.js';

describe('staging browser closed contract', () => {
  it('accepts only registered inspection suites', () => {
    for (const suite_id of Object.keys(BROWSER_SUITES)) expect(browserRequestSchema.safeParse({ suite_id }).success).toBe(true);
    expect(browserRequestSchema.safeParse({ suite_id: 'shell' }).success).toBe(false);
  });
  it.each(['url','shell','image','mounts','args','env','grant','job_id','candidate_sha','worktree','timeout'])('rejects client-selected %s', key => {
    expect(browserRequestSchema.safeParse({ suite_id: 'computed-contrast-v1', [key]: 'untrusted' }).success).toBe(false);
  });
  it('does not publish raw secrets or arbitrary artifact paths', () => {
    expect(browserReportSchema.safeParse({ passed: true, headers: { authorization: 'secret' } }).success).toBe(false);
    expect(browserReportSchema.safeParse({ passed: true, artifacts: [{ path: '/etc/passwd' }] }).success).toBe(false);
  });
});
