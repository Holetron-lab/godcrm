/**
 * Public form routes — the link the FormBuilder hands out for a 'custom' form.
 *
 *   GET  /api/v3/public/forms/:tableId          form config + columns
 *   POST /api/v3/public/forms/:tableId/submit   { data } → new row
 *
 * Mounted by public.js under /api/v3/public (abuse guard + rate limit come
 * from there; no global authenticate). Auth is optional here: access follows
 * the space-visibility scale — internal (table member), open (any signed-in
 * user), external (anyone with the link).
 * See services/forms/publicFormSubmission.js for the rules.
 */

import express from 'express';
import { z } from 'zod';
import { dbGet } from '../../database/connection.js';
import { authenticate } from '../../middleware/auth.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, notFound, forbidden } from '../../utils/response.js';
import {
  buildSubmissionData, clientFacingColumns, insertFormRow, loadPublishedForm, loadTableColumns,
  projectFormColumn, projectFormConfig, resolveFormAccess, userCanReadTable,
} from '../../services/forms/publicFormSubmission.js';

const router = express.Router();

/** Run `authenticate` but swallow its 401 — anonymous callers continue. */
function optionalAuthenticate(req, res, next) {
  const silent = { status: () => ({ json: () => next() }) };
  return authenticate(req, silent, next);
}

const submitSchema = z.object({ data: z.record(z.string(), z.unknown()).default({}) });

/**
 * Shared gate: resolve table + published form, enforce access.
 * Replies itself on failure and returns null.
 */
async function loadGatedForm(req, res) {
  const tableId = Number(req.params.tableId);
  if (!Number.isInteger(tableId) || tableId <= 0) { notFound(res, 'Form'); return null; }

  const table = await dbGet(
    `SELECT t.id, t.name, t.display_name, t.icon, t.project_id, t.data_source_id, t.is_system, p.space_id
       FROM universal_tables t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ? AND t.deleted_at IS NULL`,
    [tableId]
  );
  const form = table && !table.is_system && !table.data_source_id ? await loadPublishedForm(tableId) : null;
  if (!form) { notFound(res, 'Form'); return null; }

  const access = resolveFormAccess(form.config);
  if (access !== 'external' && !req.user?.id) {
    error(res, 'AUTH_REQUIRED', 'Sign in to open this form', 401);
    return null;
  }
  if (access === 'internal' && !(await userCanReadTable(req.user, table))) {
    forbidden(res, 'You do not have access to this form');
    return null;
  }
  return { table, form };
}

router.get('/:tableId', optionalAuthenticate, async (req, res) => {
  try {
    const gated = await loadGatedForm(req, res);
    if (!gated) return;
    const { table, form } = gated;
    const columns = clientFacingColumns(await loadTableColumns(table.id), form.config).map(projectFormColumn);
    success(res, {
      table: { id: table.id, name: table.display_name || table.name, icon: table.icon },
      config: projectFormConfig(form.config),
      columns,
      viewer: { authenticated: !!req.user?.id },
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/forms/:tableId error');
    error(res, 'PUBLIC_FORM_ERROR', err.message, 500);
  }
});

router.post('/:tableId/submit', optionalAuthenticate, async (req, res) => {
  try {
    const parsed = submitSchema.safeParse(req.body || {});
    if (!parsed.success) return error(res, 'VALIDATION_ERROR', 'Body must be { data: object }', 400);

    const gated = await loadGatedForm(req, res);
    if (!gated) return;
    const { table, form } = gated;

    const columns = await loadTableColumns(table.id);
    const userId = req.user?.id ?? null;
    const { data, missing } = buildSubmissionData({ config: form.config, columns, input: parsed.data.data, userId });
    if (missing.length > 0) {
      return error(res, 'REQUIRED_FIELD_MISSING', `Required: ${missing.join(', ')}`, 400, { fields: missing });
    }

    const row = await insertFormRow(table.id, data, userId);
    created(res, { id: row.id, base_id: row.base_id }, 'Form submitted');
  } catch (err) {
    if (err.status === 400) return error(res, 'VALIDATION_ERROR', err.message, 400);
    apiLogger.error({ err }, 'POST /public/forms/:tableId/submit error');
    error(res, 'PUBLIC_FORM_SUBMIT_ERROR', err.message, 500);
  }
});

export default router;
