/**
 * Passport authority — who may issue / revoke an agent passport.
 *
 * Owner rule (conversation 3692, 2026-09-30), replacing the ADR-165 WP-4
 * "owner of space 11" gate: the SAME human must hold BOTH
 *
 *   1. a global admin role  — `users.role` ∈ owner | admin, read from the DB
 *      (not the JWT claim, which may predate a role change), and
 *   2. admin-level access in the agent's RESIDENCE space — space owner, or the
 *      space's access-control table maps them to owner/admin, or an explicit
 *      `user_access_permissions` grant of owner/admin for that space.
 *
 * Neither half alone is sufficient. The "access control off → global admin
 * is space admin" fallback that space listing uses is deliberately NOT a
 * source here: it is not the explicit membership the owner asked for.
 *
 * The residence is always derived server-side from the stored chain
 * users.managed_by_agent_row_id → table_rows → universal_tables → projects.space_id
 * (or from a bare agent row id); a client-supplied space is only accepted for
 * the roster-level question "may I manage passports in space X at all".
 *
 * Fail-closed throughout: unknown actor, agent/tool principal, missing
 * residence, missing space → not allowed, with a machine-readable reason the
 * UI renders and the route maps onto 403 / 404.
 */
import { dbGet, safeJsonParse } from '../database/connection.js';
import { checkUserAccessViaTableV2 } from './space/access.js';

const GLOBAL_ADMIN_ROLES = new Set(['owner', 'admin']);
const SPACE_ADMIN_LEVELS = new Set(['owner', 'admin']);

/** @typedef {'ok'|'not_authenticated'|'agent_principal'|'residence_not_found'|'global_role_required'|'space_admin_required'} PassportAuthorityReason */

const RESIDENCE_SQL = `
  SELECT tr.id AS agent_row_id, p.space_id
    FROM table_rows tr
    JOIN universal_tables ut ON ut.id = tr.table_id
    JOIN projects p ON p.id = ut.project_id`;

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function locateResidence({ userId, rowId, spaceId }) {
  if (rowId) {
    return dbGet(`${RESIDENCE_SQL} WHERE tr.id = $1`, [rowId]);
  }
  if (userId) {
    return dbGet(
      `${RESIDENCE_SQL} JOIN users u ON u.managed_by_agent_row_id = tr.id
        WHERE u.id = $1 AND u.user_type = 'agent'`,
      [userId]
    );
  }
  if (spaceId) {
    const space = await dbGet('SELECT id FROM spaces WHERE id = $1', [spaceId]);
    return space ? { agent_row_id: null, space_id: space.id } : null;
  }
  return null;
}

/**
 * Which explicit source (if any) makes the actor an admin of the space.
 * @returns {Promise<'owner'|'access_table'|'explicit_grant'|null>}
 */
async function spaceAdminSource(actorId, spaceId) {
  const space = await dbGet('SELECT id, owner_id, access_control FROM spaces WHERE id = $1', [spaceId]);
  if (!space) return null;
  if (Number(space.owner_id) === actorId) return 'owner';

  const accessControl = typeof space.access_control === 'string'
    ? safeJsonParse(space.access_control, null)
    : space.access_control;
  if (accessControl?.enabled) {
    const viaTable = await checkUserAccessViaTableV2(actorId, accessControl);
    if (viaTable.accessLevel === 'denied') return null;
    if (viaTable.allowed && SPACE_ADMIN_LEVELS.has(viaTable.accessLevel)) return 'access_table';
  }

  const grant = await dbGet(
    `SELECT access_level FROM user_access_permissions
      WHERE user_id = $1 AND space_id = $2 AND access_level IN ('owner', 'admin')
      LIMIT 1`,
    [actorId, spaceId]
  );
  return grant ? 'explicit_grant' : null;
}

/**
 * Decide whether `actorUserId` may issue/revoke the passport of the agent
 * identified by `userId` (agent user row) or `rowId` (agent row), or manage
 * passports in `spaceId` at all. Exactly one target is used, in that order.
 *
 * @returns {Promise<{
 *   allowed: boolean,
 *   reason: PassportAuthorityReason,
 *   actor: { user_id: number|null, role: string|null, global_admin: boolean },
 *   space: { id: number|null, admin: boolean, via: 'owner'|'access_table'|'explicit_grant'|null },
 *   agent_row_id: number|null,
 * }>}
 */
export async function resolvePassportAuthority({ actorUserId, userId, rowId, spaceId } = {}) {
  const result = {
    allowed: false,
    reason: 'not_authenticated',
    actor: { user_id: null, role: null, global_admin: false },
    space: { id: null, admin: false, via: null },
    agent_row_id: null,
  };

  const actorId = positiveInt(actorUserId);
  const actor = actorId ? await dbGet('SELECT id, role, user_type FROM users WHERE id = $1', [actorId]) : null;
  if (!actor) return result;
  result.actor = { user_id: actor.id, role: actor.role ?? null, global_admin: GLOBAL_ADMIN_ROLES.has(actor.role) };
  if (actor.user_type === 'agent') return { ...result, reason: 'agent_principal' };

  const residence = await locateResidence({
    userId: positiveInt(userId), rowId: positiveInt(rowId), spaceId: positiveInt(spaceId),
  });
  if (!residence?.space_id) return { ...result, reason: 'residence_not_found' };
  result.agent_row_id = residence.agent_row_id ?? null;

  const via = await spaceAdminSource(actor.id, residence.space_id);
  result.space = { id: residence.space_id, admin: via !== null, via };

  if (!result.actor.global_admin) return { ...result, reason: 'global_role_required' };
  if (!via) return { ...result, reason: 'space_admin_required' };
  return { ...result, allowed: true, reason: 'ok' };
}
