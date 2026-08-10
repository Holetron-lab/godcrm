/**
 * ADR-165 WP-1 — Unified capability gate (pure decision layer).
 *
 * The per-agent tool allowlist used to be advisory on every path except the
 * Claude Code CLI hook: it only shaped the tool list sent to the LLM, never
 * verified the *invoked* tool. Under ADR-117 transitive delegation the LLM is
 * the adversary on every path, so a prompt-injected agent could call any tool.
 *
 * This module is the decision half of the relocated enforcement point that now
 * lives inside `executeTool()` (the universal choke point for all non-CLI
 * paths). Kept pure — no DB, no imports — so it is unit-testable in isolation
 * without pulling the executor's handler graph.
 *
 * Source of truth: callers thread the SAME resolved `allowedTools` list they
 * built for the LLM into the execution `context`. So "what the model was
 * offered" and "what the gate permits" can never drift.
 */

/**
 * Resolve the set of permitted tool names from an execution context.
 *
 * @param {Object|null|undefined} context - executeTool() context.
 * @returns {Set<string>|null} Set of allowed tool names, or `null` when no
 *   agent scope is present (system caller: MCP userId=1, human owner) — which
 *   the gate treats as unrestricted.
 */
export function resolveAllowlistNames(context) {
  const list = context?.allowedTools;
  if (!Array.isArray(list) || list.length === 0) return null;
  const names = new Set();
  for (const tool of list) {
    // Accept OpenAI-shape ({ function: { name } }) and flat ({ name }) defs.
    const name = tool?.function?.name || tool?.name;
    if (name) names.add(name);
  }
  return names.size ? names : null;
}

/**
 * Evaluate whether a tool call is permitted under the agent's capability scope.
 *
 * @param {string} toolName
 * @param {Object|null|undefined} context - carries `allowedTools` when scoped.
 * @param {boolean} enforce - true = hard block on violation; false = warn-only
 *   (violation flagged for telemetry but still permitted). First soak cycle
 *   runs warn-only, mirroring ADR-164's `deprecated_slug_resolve` WARN pattern.
 * @returns {{ permitted: boolean, violation: boolean }}
 */
export function evaluateToolGate(toolName, context, enforce) {
  const allowedNames = resolveAllowlistNames(context);
  // No agent scope → system caller → unrestricted.
  if (!allowedNames) return { permitted: true, violation: false };
  if (allowedNames.has(toolName)) return { permitted: true, violation: false };
  // Out of allowlist: always a violation for telemetry; blocked only in enforce.
  return { permitted: !enforce, violation: true };
}
