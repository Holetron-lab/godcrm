/**
 * Per-agent CLI run timeout (Bug 1552/228714, Fleet Audit WP-6, ADR-203 D4).
 *
 * Until now every claude-code / codex / copilot run was killed after a
 * hard-coded 30 minutes (cli-providers.js). The agent row (table 1784) now
 * carries `run_timeout_min`; when it is empty the fallback depends on how
 * the run was started:
 *   - `command` (<</slug>> one-shot sub-agent)  → 10 min (D4 default)
 *   - anything else (@mention, ticket worker,
 *     auto-respond, recovery)                   → 30 min (unchanged)
 *
 * A single 10-minute default for every run would cut long @mention turns
 * that run for 40+ minutes today, so the D4 default applies only to the
 * path the bug is about. Set the column to change either.
 */
export const LEGACY_RUN_TIMEOUT_MIN = 30;
export const COMMAND_RUN_TIMEOUT_MIN = 10;

export function resolveRunTimeoutMin(agentConfig, invocationType = null) {
  const configured = Number(agentConfig?.run_timeout_min);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return invocationType === 'command' ? COMMAND_RUN_TIMEOUT_MIN : LEGACY_RUN_TIMEOUT_MIN;
}

export function resolveRunTimeoutMs(agentConfig, invocationType = null) {
  return resolveRunTimeoutMin(agentConfig, invocationType) * 60 * 1000;
}
