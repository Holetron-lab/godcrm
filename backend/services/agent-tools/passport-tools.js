/**
 * Passport lifecycle tool handlers — ADR-164 Phase 2.
 *
 * Thin wrappers over the canonical agent-users service (issuePassport /
 * revokePassport). No resolution logic lives here — the service reuses the
 * canonical resolveAgentUser() so there is a single resolve path.
 *
 * ADR-165 WP-4: these tools are owner-only, enforced in `executeTool()` before
 * dispatch. The actor recorded here is derived from the call's *principal*,
 * not from `userId` — on a system transport `userId` is 1 by construction, so
 * stamping it would sign a machine act with the owner's name. Belt to D1's
 * braces: a system principal writes a null actor plus a label.
 */
import { issuePassport, revokePassport } from '../agent-users.js';
import { resolvePrincipal } from './principal.js';

/**
 * Actor for the audit stamp: a real user id only for a verified human owner,
 * otherwise null plus the principal's label.
 */
function auditActor(userId, context) {
  const principal = resolvePrincipal(context);
  if (principal.kind === 'human_owner') {
    return { actor: principal.userId ?? userId ?? null, actor_label: null };
  }
  return { actor: null, actor_label: principal.label || principal.kind };
}

export const passportToolHandlers = {
  // The audit_log entry is written by the service itself (D4), so every path —
  // this one and the owner HTTP route — records the act exactly once and a
  // future caller cannot forget it.
  async issue_passport({ handle, row_id, user_id, table_id }, userId, context) {
    return issuePassport({ handle, row_id, user_id, table_id, ...auditActor(userId, context) });
  },

  async revoke_passport({ handle, user_id }, userId, context) {
    return revokePassport({ handle, user_id, ...auditActor(userId, context) });
  },
};
