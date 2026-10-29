// Shared by REST and MCP uploaders: scope comes from the owning records.
import { z } from 'zod';
import { dbGet, safeJsonParse } from '../database/connection.js';
import { checkTableWriteAccess } from '../routes/v3/tables/helpers.js';
import { checkUserSpaceAccess } from './space/access.js';

const id = z.union([z.number(), z.string().regex(/^[1-9]\d*$/).transform(Number)])
  .pipe(z.number().int().positive().safe()).nullish();
const schema = z.object({ spaceId: id, projectId: id, tableId: id, rowId: id, columnId: id });

export async function resolveUploadScope(input, user) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid upload scope IDs', status: 400 };
  const scope = parsed.data;
  const invalid = { error: 'Upload scope does not match existing records', status: 400 };
  for (const [key, sql] of [
    ['columnId', 'SELECT table_id FROM table_columns WHERE id = ?'],
    ['rowId', 'SELECT table_id FROM table_rows WHERE id = ?'],
  ]) {
    if (!scope[key]) continue;
    const record = await dbGet(sql, [scope[key]]);
    if (!record?.table_id || (scope.tableId && scope.tableId !== Number(record.table_id))) return invalid;
    scope.tableId = Number(record.table_id);
  }
  if (scope.tableId) {
    const table = await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [scope.tableId]);
    if (!table?.project_id || (scope.projectId && scope.projectId !== Number(table.project_id))) return invalid;
    scope.projectId = Number(table.project_id);
  }
  if (scope.projectId) {
    const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [scope.projectId]);
    if (!project?.space_id || (scope.spaceId && scope.spaceId !== Number(project.space_id))) return invalid;
    scope.spaceId = Number(project.space_id);
    const access = await checkTableWriteAccess(user, scope);
    if (!access.allowed) return { error: access.error, status: access.status || 403 };
  }
  if (scope.spaceId) {
    const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [scope.spaceId]);
    if (!space) return invalid;
    if (!user?.id || !(await checkUserSpaceAccess(user.id, user.role, space, safeJsonParse(space.access_control, null)))) {
      return { error: 'Access denied to upload space', status: 403 };
    }
  }
  return scope;
}
