import express from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { checkTableWriteAccess } from './helpers.js';
import { previewExcel, EXCEL_LIMITS } from '../../../services/excel-preview.js';
import { success, error, unauthorized, forbidden, badRequest } from '../../../utils/response.js';
import { apiLogger } from '../../../utils/logger.js';

const router = express.Router();
const projectSchema = z.coerce.number().int().positive().safe();
const selectionSchema = z.object({
  sheetIndex: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe()).optional(),
}).strict();
const upload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: EXCEL_LIMITS.fileBytes, files: 1, fields: 1, parts: 2, fieldSize: 32,
} }).single('file');
const limiter = rateLimit({ windowMs: 60000, limit: 20, keyGenerator: req => String(req.user.id),
  handler: (_req, res) => error(res, 'PREVIEW_BUSY', 'Слишком много запросов предпросмотра. Повторите позже.', 429),
});
let pending = 0;

// Multipart file + optional sheetIndex. Preview is stateless: no table, rows,
// attachments or temporary files are created, including on cancellation/retry.
router.post('/projects/:projectId/tables/excel-preview', async (req, res, next) => {
  try {
    if (!req.user?.id) return unauthorized(res);
    const project = projectSchema.safeParse(req.params.projectId);
    if (!project.success) return badRequest(res, 'Некорректный проект.');
    if (req.user.projectId && Number(req.user.projectId) !== project.data) return forbidden(res);
    const access = await checkTableWriteAccess(req.user, { projectId: project.data });
    if (!access.allowed) return forbidden(res, access.error);
    next();
  } catch (err) { next(err); }
}, limiter, (req, res) => {
  // Reserve before buffering uploads, not only before spawning parsers.
  if (pending >= 2) return error(res, 'PREVIEW_BUSY', 'Импорт занят. Повторите позже.', 429);
  pending++;
  res.once('close', () => { pending--; });
  upload(req, res, async uploadError => {
    if (uploadError) return error(res,
      uploadError.code === 'LIMIT_FILE_SIZE' ? 'FILE_LIMIT' : 'INVALID_INPUT',
      uploadError.code === 'LIMIT_FILE_SIZE' ? 'Максимальный размер файла — 10 МиБ.' : 'Передайте один Excel-файл и номер листа.',
      uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
    const selection = selectionSchema.safeParse(req.body || {});
    if (!selection.success || !req.file) return badRequest(res, 'Передайте один Excel-файл и корректный номер листа.');
    try {
      return success(res, await previewExcel(req.file.buffer, req.file.originalname, selection.data.sheetIndex));
    } catch (err) {
      apiLogger.warn({ code: err.code || 'PREVIEW_FAILED' }, 'Excel preview failed');
      return error(res, err.code || 'PREVIEW_FAILED', err.code ? err.message : 'Не удалось прочитать Excel-файл.',
        err.code === 'PREVIEW_BUSY' ? 429 : err.code === 'PREVIEW_TIMEOUT' ? 422 : 400);
    }
  });
});

export default router;
