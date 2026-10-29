/**
 * API v3: Module installation — ADR-200 W2 + W3.
 *
 *   POST /api/v3/modules/install          { blueprint, space_id, project_id, dry_run }
 *   POST /api/v3/modules/:key/upgrade     { blueprint, space_id, dry_run }
 *   POST /api/v3/modules/:key/uninstall   { space_id, purge }
 *
 * This is the HTTP caller `provisionModuleTables` never had. All three verbs are
 * owner-only (ADR-200 §Security: "installation requires the space owner role") and all
 * three go through ModuleInstaller — the route parses, authorizes and maps errors, and
 * owns no install logic of its own.
 *
 * Deviation from the ADR's sketch, deliberate: `upgrade` and `uninstall` also take
 * `space_id`. An installation is identified by (module_key, space_id), so `:key` alone
 * does not name one.
 *
 * The file is `module-install.js`, not `modules.js`, because `routes/v3/modules.js` is the
 * (long-deleted) ADR-065 sidebar-module CRUD router whose test still imports that exact
 * path — recreating the name would resurrect a dead suite against unrelated endpoints.
 */

import express from 'express';
import {
  installModule,
  upgradeModule,
  uninstallModule,
  BlueprintError,
} from '../../services/ModuleInstaller.js';
import { hasPermission } from '../../services/EffectiveRoleService.js';
import { success, error, badRequest, forbidden } from '../../utils/response.js';
import { apiLogger } from '../../utils/logger.js';

const router = express.Router();

// Blueprint-level refusals are client errors with a stable code — never a 500, and never a
// bare "something went wrong": whoever wrote the blueprint has to be able to fix it.
const STATUS_BY_CODE = {
  BLUEPRINT_INVALID: 422,
  BLUEPRINT_SECTION_UNSUPPORTED: 422,
  BLUEPRINT_TOO_LARGE: 422,
  BLUEPRINT_KEY_MISMATCH: 422,
  BLUEPRINT_RESERVED_KEY: 422,
  BLUEPRINT_UNKNOWN_TABLE_REF: 422,
  BLUEPRINT_RAW_TABLE_BINDING: 422,
  PRESET_NOT_FOUND: 422,
  PROJECT_NOT_IN_SPACE: 400,
  PROJECT_NOT_FOUND: 404,
  SPACE_NOT_FOUND: 404,
  NOT_INSTALLED: 404,
  ALREADY_INSTALLED: 409,
  VERSION_DOWNGRADE: 409,
  VERSION_NOT_BUMPED: 409,
};

function fail(res, err, context) {
  if (err instanceof BlueprintError) {
    return error(res, err.code, err.message, STATUS_BY_CODE[err.code] || 422, err.details);
  }
  apiLogger.error({ err, ...context }, '[modules] install operation failed');
  return error(res, 'MODULE_OPERATION_FAILED', err.message);
}

function parseSpaceId(body) {
  const raw = body?.space_id;
  const spaceId = Number.parseInt(raw, 10);
  return Number.isInteger(spaceId) && spaceId > 0 ? spaceId : null;
}

/** Owner of the space, or nothing. Modules write schema — this is not an editor action. */
async function denyUnlessSpaceOwner(req, res, spaceId) {
  const userId = req.user?.id;
  if (!userId) {
    forbidden(res, 'Authentication required');
    return true;
  }
  const allowed = await hasPermission(userId, 'owner', { spaceId });
  if (!allowed) {
    forbidden(res, 'Installing, upgrading or removing a module requires the space owner role');
    return true;
  }
  return false;
}

/**
 * POST /api/v3/modules/install
 * `dry_run: true` returns the same diff the real install would produce and writes nothing.
 */
router.post('/install', async (req, res) => {
  const spaceId = parseSpaceId(req.body);
  const projectId = Number.parseInt(req.body?.project_id, 10);

  if (!spaceId) return badRequest(res, 'space_id is required');
  if (!Number.isInteger(projectId) || projectId <= 0) return badRequest(res, 'project_id is required');
  if (!req.body?.blueprint) return badRequest(res, 'blueprint is required');

  try {
    if (await denyUnlessSpaceOwner(req, res, spaceId)) return;

    const result = await installModule({
      blueprint: req.body.blueprint,
      spaceId,
      projectId,
      userId: req.user?.id ?? null,
      dryRun: req.body.dry_run === true,
    });
    return success(res, result);
  } catch (err) {
    return fail(res, err, { spaceId, projectId });
  }
});

/**
 * POST /api/v3/modules/:key/upgrade
 * Add-only reconciliation onto an existing installation.
 */
router.post('/:key/upgrade', async (req, res) => {
  const spaceId = parseSpaceId(req.body);
  if (!spaceId) return badRequest(res, 'space_id is required');
  if (!req.body?.blueprint) return badRequest(res, 'blueprint is required');

  try {
    if (await denyUnlessSpaceOwner(req, res, spaceId)) return;

    const result = await upgradeModule({
      moduleKey: req.params.key,
      blueprint: req.body.blueprint,
      spaceId,
      userId: req.user?.id ?? null,
      dryRun: req.body.dry_run === true,
    });
    return success(res, result);
  } catch (err) {
    return fail(res, err, { spaceId, moduleKey: req.params.key });
  }
});

/**
 * POST /api/v3/modules/:key/uninstall
 * Without `purge`, tables and rows stay — only the installation is retired.
 */
router.post('/:key/uninstall', async (req, res) => {
  const spaceId = parseSpaceId(req.body);
  if (!spaceId) return badRequest(res, 'space_id is required');

  try {
    if (await denyUnlessSpaceOwner(req, res, spaceId)) return;

    const result = await uninstallModule({
      moduleKey: req.params.key,
      spaceId,
      purge: req.body?.purge === true,
      userId: req.user?.id ?? null,
    });
    return success(res, result);
  } catch (err) {
    return fail(res, err, { spaceId, moduleKey: req.params.key });
  }
});

export default router;
