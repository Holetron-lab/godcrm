/**
 * Passport lifecycle tool handlers — ADR-164 Phase 2.
 *
 * Thin wrappers over the canonical agent-users service (issuePassport /
 * revokePassport). No resolution logic lives here — the service reuses the
 * canonical resolveAgentUser() so there is a single resolve path. The calling
 * user id (`userId`) is recorded as the actor performing the act.
 *
 * ponytail: authorization gating (owner-only naturalization) is intentionally
 * not enforced here — passport issue/revoke should become owner-gated like the
 * Secrets tab (ADR-0040 pattern) in a follow-up; today any agent with tool
 * access can call these. Flagged for the debt ledger, not implemented in P2.
 */
import { issuePassport, revokePassport } from '../agent-users.js';

export const passportToolHandlers = {
  async issue_passport({ handle, row_id, user_id, table_id }, userId) {
    return issuePassport({ handle, row_id, user_id, table_id, actor: userId ?? null });
  },

  async revoke_passport({ handle, user_id }, userId) {
    return revokePassport({ handle, user_id, actor: userId ?? null });
  },
};
