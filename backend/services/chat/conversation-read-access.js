import { z } from 'zod';
import { dbGet, safeJsonParse } from '../../database/connection.js';
import { getEffectiveRole, ACCESS_LEVEL_VALUES } from '../EffectiveRoleService.js';
import { checkUserAccessViaTableV2, getUserAccessData, canAccessSpace, canAccessProject, canAccessTable, getEffectiveProjectRole } from '../space/access.js';

const idSchema = z.coerce.number().int().positive().safe();

// Read-only: never enroll the caller or treat a forwarded payload as authority.
export async function canReadConversation(user, conversationId, conversation = null) {
  const uid = idSchema.safeParse(user?.id ?? user?.userId);
  const cid = idSchema.safeParse(conversationId);
  if (!uid.success || !cid.success) return false;
  const userId = uid.data;
  const participant = await dbGet(
    'SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
    [cid.data, userId]
  );
  if (participant) return true;

  const conv = conversation ?? await dbGet(
    'SELECT space_id, bound_table_id, bound_row_id, settings FROM conversations WHERE id = $1', [cid.data]
  );
  if (!conv || !idSchema.safeParse(conv.bound_table_id).success || !idSchema.safeParse(conv.bound_row_id).success) return false;
  // Historical imports keep their existing participant-only policy.
  if (safeJsonParse(conv.settings, {})?.historical_import?.key) return false;

  const scope = await dbGet(
    `SELECT t.project_id, p.space_id, p.type AS project_type, s.owner_id, s.access_control
       FROM table_rows r JOIN universal_tables t ON t.id = r.table_id
       JOIN projects p ON p.id = t.project_id JOIN spaces s ON s.id = p.space_id
      WHERE r.table_id = $1 AND r.id = $2`,
    [conv.bound_table_id, conv.bound_row_id]
  );
  if (!scope || Number(scope.space_id) !== Number(conv.space_id)) return false;
  if (user?.projectId && Number(user.projectId) !== Number(scope.project_id)) return false;

  const { effectiveRole, source } = await getEffectiveRole(userId, {
    spaceId: scope.space_id, projectId: scope.project_id, tableId: conv.bound_table_id,
  });
  if (effectiveRole === 'denied' && source !== 'none') return false;
  let role = effectiveRole;
  const accessControl = safeJsonParse(scope.access_control, {});
  if (Number(scope.owner_id) !== userId && accessControl?.enabled) {
    const mapped = await checkUserAccessViaTableV2(userId, accessControl);
    if (mapped.accessLevel === 'denied') return false;
    if (source === 'none' || source === 'open_default') role = mapped.accessLevel;
    const granular = await getUserAccessData(userId, accessControl);
    if (granular && (!canAccessSpace({ ...granular, role }, scope.space_id)
      || !canAccessProject({ ...granular, role }, scope.project_id)
      || !canAccessTable({ ...granular, role }, conv.bound_table_id))) return false;
  }
  role = getEffectiveProjectRole({ role }, { type: scope.project_type });
  return (ACCESS_LEVEL_VALUES[role] ?? 0) >= ACCESS_LEVEL_VALUES.editor;
}
