/**
 * API v3: Module installation — ADR-200 W2 + W3, ADR-207 W1.1–W1.4 bindings and permissions.
 *
 *   POST /api/v3/modules/install          { blueprint, space_id, project_id, dry_run, bindings, existingWidgets }
 *   POST /api/v3/modules/:key/upgrade     { blueprint, space_id, dry_run }
 *   POST /api/v3/modules/:key/uninstall   { space_id, purge }
 *
 * Install requires member for data/surface components and admin for agents, automations or
 * services; upgrade and uninstall remain owner-only. All three verbs go through ModuleInstaller —
 * the route parses, authorizes and maps errors, and owns no install logic of its own.
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
import { z } from 'zod';
import { dbGet } from '../../database/connection.js';
import { exportProjectBlueprint, exportSpaceBlueprint } from '../../services/ModuleExportService.js';
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
  INSTALL_BINDINGS_CONFLICT: 409,
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
    forbidden(res, 'Upgrading or removing a module requires the space owner role');
    return true;
  }
  return false;
}

async function denyUnlessInstaller(req, res, spaceId) {
  const userId = req.user?.id;
  if (!userId) {
    forbidden(res, 'Authentication required');
    return true;
  }
  const adminRequired = ['agents', 'automations', 'services'].some(
    section => Array.isArray(req.body.blueprint?.[section]) && req.body.blueprint[section].length > 0,
  );
  const requiredRole = adminRequired ? 'admin' : 'editor';
  if (!await hasPermission(userId, requiredRole, { spaceId })) {
    forbidden(res, adminRequired
      ? 'Installing agents, automations or services requires the space owner or admin role'
      : 'Installing a module requires the space member role');
    return true;
  }
  return false;
}

const exportId = z.coerce.number().int().positive().max(2147483647);
const exportFields = {
  key: z.string().regex(/^[a-z][a-z0-9_-]*$/).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
  required_table_ids: z.array(exportId).max(25).optional(),
  seed_table_ids: z.array(exportId).max(25).optional(),
};
const projectExportSchema = z.object({ project_id: exportId, ...exportFields }).strict();
const spaceExportSchema = z.object({ space_id: exportId, ...exportFields }).strict();

function exportOptions(body) {
  return {
    key: body.key,
    version: body.version,
    title: body.title,
    description: body.description,
    icon: body.icon,
    requiredTableIds: body.required_table_ids || [],
    seedTableIds: body.seed_table_ids || [],
  };
}

function parseExport(schema, body, res) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    badRequest(res, 'Invalid module export request', 'MODULE_EXPORT_REQUEST_INVALID');
    return null;
  }
  return parsed.data;
}

async function denyUnlessExportOwner(req, res, spaceId) {
  if (!req.user?.id) {
    forbidden(res, 'Authentication required');
    return true;
  }
  if (!await hasPermission(req.user.id, 'owner', { spaceId })) {
    forbidden(res, 'Exporting a module fingerprint requires the space owner role');
    return true;
  }
  return false;
}

function failExport(res, err, context) {
  const status = ['PROJECT_NOT_FOUND', 'SPACE_NOT_FOUND'].includes(err.code) ? 404 : 422;
  if (err.code) return error(res, err.code, err.message, status);
  apiLogger.error({ err, ...context }, '[modules] export operation failed');
  return error(res, 'MODULE_EXPORT_FAILED', 'Module export failed', 500);
}

router.post('/export/project', async (req, res) => {
  const body = parseExport(projectExportSchema, req.body, res);
  if (!body) return;
  try {
    const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [body.project_id]);
    if (!project) return error(res, 'PROJECT_NOT_FOUND', 'Project not found', 404);
    if (await denyUnlessExportOwner(req, res, project.space_id)) return;
    const blueprint = await exportProjectBlueprint(body.project_id, exportOptions(body));
    return success(res, { blueprint });
  } catch (err) {
    return failExport(res, err, { projectId: body.project_id });
  }
});

router.post('/export/space', async (req, res) => {
  const body = parseExport(spaceExportSchema, req.body, res);
  if (!body) return;
  try {
    const space = await dbGet('SELECT id FROM spaces WHERE id = ?', [body.space_id]);
    if (!space) return error(res, 'SPACE_NOT_FOUND', 'Space not found', 404);
    if (await denyUnlessExportOwner(req, res, body.space_id)) return;
    const blueprint = await exportSpaceBlueprint(body.space_id, exportOptions(body));
    return success(res, { blueprint });
  } catch (err) {
    return failExport(res, err, { spaceId: body.space_id });
  }
});

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
    if (await denyUnlessInstaller(req, res, spaceId)) return;

    const result = await installModule({
      blueprint: req.body.blueprint,
      spaceId,
      projectId,
      userId: req.user?.id ?? null,
      dryRun: req.body.dry_run === true,
      bindings: req.body.bindings ?? null,
      existingWidgets: req.body.existingWidgets ?? {},
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
