/**
 * Ops profiles — diagnostics / local-qa (Constitution v4.3 profiles).
 *
 * The agent names ONLY the action, its job id, the committed candidate SHA and
 * (local-qa) a registered suite id. Identity, grant, repo, image and executor
 * are server-owned; the broker refuses any extra field before running anything.
 * Diagnostics return filtered checks; QA returns exit code and log hash only —
 * raw logs go to the space owner via the API, never to the agent.
 */

export const OPS_TOOLS = [
  { type: 'function', function: {
    name: 'ops_browser_artifact',
    description: 'Read one sanitized staging-browser artifact belonging to this live job/grant. Only bounded typed inspection data and fixed-action trace timings; no raw traces, paths, headers, DOM or clipboard contents.',
    parameters: { type: 'object', additionalProperties: false,
      properties: { run_id: { type: 'string', format: 'uuid' }, artifact_id: { type: 'string', format: 'uuid' } },
      required: ['run_id', 'artifact_id'],
    },
  } },
  ...['ops_browser_preflight', 'ops_browser_run'].map(name => ({
    type: 'function',
    function: {
      name,
      description: name === 'ops_browser_preflight'
        ? 'Check authenticated staging-browser capability without launching a browser. Server resolves job, identity, worktree, SHA, grant and pins. Returns ALLOW or DENY/BLOCKED; ALLOW does not grant future execution.'
        : 'Run one registered read-only staging inspection suite under the current job grant. Deadline 180s (server maximum 300s), cleanup <=10s. Returns sanitized aggregates and artifact descriptors; no arbitrary URL, script, credentials or paths.',
      parameters: { type: 'object', additionalProperties: false,
        properties: { suite_id: { type: 'string', enum: ['computed-contrast-v1', 'axe-v1', 'trace-metrics-v1', 'clipboard-v1'] } },
        required: ['suite_id'],
      },
    },
  })),
  {
    type: 'function',
    function: {
      name: 'ops_grant_info',
      description:
        'Show the ops-profile grants (diagnostics / local-qa) currently issued to YOU: job_id, profile, allowed actions, registered suite ids, the pinned candidate_sha and expiry. Call this first — ops_run_check needs the exact job_id and candidate_sha from here. Empty when no grant is live.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ops_run_check',
      description:
        'Run ONE granted ops-profile operation through the trusted broker. diagnostics: host.identity, disk.status, runtime.status, ring0.health, ring0.release, staging.health, staging.release (read-only; inspect `checks`, exit_code 0 only means the probe ran; release sha256 is the served asset, not a git SHA). local-qa: node-test, vitest, build, browser-test on the committed candidate snapshot inside an isolated container — pass the registered suite_id. Denied (no grant, revoked, expired, wrong sha/action/suite, extra fields) returns {error:"ops_denied", reason}.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Granted action name, e.g. "host.identity" or "node-test".' },
          job_id: { type: 'string', description: 'Job id of your grant (from ops_grant_info).' },
          candidate_sha: { type: 'string', description: 'The 40-hex committed SHA pinned in your grant.' },
          suite_id: { type: 'string', description: 'local-qa only: a registered suite id from ops_grant_info.' },
        },
        required: ['action', 'job_id', 'candidate_sha'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ops_staging_grant_info',
      description:
        'Show the staging-channel grants currently issued to YOU (sysadmin only): job_id, the single allowed action, fixed target (dev72 / dev.godcrm.ai / godcrm_test), pinned candidate_sha, executor digest and expiry. Call this first — ops_staging_preflight needs the exact job_id and candidate_sha from here. Empty when no grant is live.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ops_staging_preflight',
      description:
        'Run the ONE granted staging action, staging.preflight, through the independent staging executor: read-only verification of host identities, exact source SHA/status, installed executor, config digests, current/next godcrm_test, jobs/reservations/leases, refresh/cron writer state, staging runtime generation and health. Returns a durable run_id plus sanitized `checks`; exit_code 0 means every check passed, it never authorizes a release. No deploy/restart/repair action exists. Denied (no grant, revoked, expired, wrong sha/action/job, extra fields, lease held) returns {error:"ops_denied", reason}.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Must be "staging.preflight".' },
          job_id: { type: 'string', description: 'Job id of your staging grant (from ops_staging_grant_info).' },
          candidate_sha: { type: 'string', description: 'The 40-hex committed candidate SHA pinned in your grant.' },
        },
        required: ['action', 'job_id', 'candidate_sha'],
        additionalProperties: false,
      },
    },
  },
];

export default OPS_TOOLS;
