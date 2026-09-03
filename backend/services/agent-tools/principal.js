/**
 * ADR-165 WP-4 — who is the principal of a tool call (pure decision layer).
 *
 * WP-1's capability gate answers *what may this agent do*. This module answers
 * the question underneath it: *on whose authority is this call made*. The two
 * are different layers — the WP-4 defect was a confused deputy in the
 * transport, where privilege came from the channel (`mcp-server.js` passing
 * `userId = 1`) instead of from the subject.
 *
 * Kept pure — no DB, no imports — so both consumers (`executor.js` for the
 * OWNER_ONLY decision, `passport-tools.js` for truthful attribution) read the
 * same predicate and it cannot fork.
 */

/**
 * Resolve the principal behind an execution context.
 *
 * Precedence: an explicitly declared `context.principal` wins; an agent scope
 * (`context.agentId`) marks an agent caller; anything else is `unknown` —
 * deliberately NOT treated as the owner (that assumption was the bug).
 *
 * @param {Object|null|undefined} context - executeTool() context.
 * @returns {{ kind: 'human_owner'|'agent'|'system'|'unknown', label: string|null, userId: number|null }}
 */
export function resolvePrincipal(context) {
  const declared = context?.principal;
  if (declared && typeof declared === 'object' && declared.kind) {
    return {
      kind: declared.kind,
      label: declared.label ?? null,
      userId: declared.userId ?? null,
    };
  }
  if (context?.agentId != null) {
    return { kind: 'agent', label: context.agentName ?? null, userId: null };
  }
  return { kind: 'unknown', label: null, userId: null };
}

/**
 * True only for a verified human-owner principal.
 *
 * An agent scope, the MCP transport, or an undeclared principal all fail —
 * absence of a claim is never read as ownership.
 *
 * @param {Object|null|undefined} context
 * @returns {boolean}
 */
export function isOwnerPrincipal(context) {
  if (context?.agentId != null) return false;
  if (context?.source === 'mcp') return false;
  return resolvePrincipal(context).kind === 'human_owner';
}
