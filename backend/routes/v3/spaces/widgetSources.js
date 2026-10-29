/**
 * Spaces widget-source routes — the two lists behind the "Add widget" picker.
 * GET /:id/widgets-available  → widgets from every project the caller can see
 * GET /:id/tables-available   → show_in_nav tables from those same projects
 *
 * These lived in routes/v3/modules.js until 858a5a11 unmounted that router
 * together with the Plan-B provisioner; the picker kept calling them and got
 * 404. Restored here with the same access rule as GET /spaces/:id: the space
 * must be visible to the caller, and sources are limited to the projects the
 * caller is allowed to see (owner / sysadmin see all).
 */

import { getSpaceById, checkUserSpaceAccess } from '../../../services/SpaceService.js';
import { getProjectsBySpace, getProjectsBySpaceForUser } from '../../../services/ProjectService.js';
import { getWidgetsBySpace, getTablesBySpace } from '../../../services/ModuleService.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, notFound, badRequest } from '../../../utils/response.js';

/**
 * Resolve the space and the set of project ids the caller may see.
 * Writes the 400/403/404 response itself and returns null in that case.
 */
async function resolveVisibleProjects(req, res) {
  const spaceId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(spaceId) || spaceId <= 0) {
    badRequest(res, 'Invalid space id');
    return null;
  }

  const space = await getSpaceById(spaceId);
  if (!space) {
    notFound(res, 'Space');
    return null;
  }

  const allowed = await checkUserSpaceAccess(req.user.id, req.user.role, space, space.access_control);
  if (!allowed) {
    error(res, 'FORBIDDEN', 'You are not authorized to access this space', 403);
    return null;
  }

  const isOwner = space.owner_id === req.user.id;
  const isSysAdmin = req.user.role === 'admin' || req.user.role === 'owner';
  const projects = (isOwner || isSysAdmin)
    ? await getProjectsBySpace(spaceId)
    : await getProjectsBySpaceForUser(spaceId, req.user.id, space.access_control, space.owner_id);

  return { spaceId, projectIds: new Set(projects.map((p) => p.id)) };
}

export default function registerWidgetSourcesRoutes(router) {
  router.get('/:id/widgets-available', async (req, res) => {
    try {
      const scope = await resolveVisibleProjects(req, res);
      if (!scope) return;
      const widgets = await getWidgetsBySpace(scope.spaceId);
      success(res, widgets.filter((w) => scope.projectIds.has(w.project_id)));
    } catch (err) {
      apiLogger.error({ err }, 'Error fetching space widgets');
      error(res, 'FETCH_ERROR', err.message, 500);
    }
  });

  router.get('/:id/tables-available', async (req, res) => {
    try {
      const scope = await resolveVisibleProjects(req, res);
      if (!scope) return;
      const tables = await getTablesBySpace(scope.spaceId);
      success(res, tables.filter((t) => scope.projectIds.has(t.project_id)));
    } catch (err) {
      apiLogger.error({ err }, 'Error fetching space tables');
      error(res, 'FETCH_ERROR', err.message, 500);
    }
  });
}
