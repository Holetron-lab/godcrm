import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { dbGet } from '../../../database/connection.js';
import { success, badRequest, forbidden, notFound, error } from '../../../utils/response.js';
import { requireEditorAccess } from './_helpers.js';
import { resolveBinding } from '../../../services/documents/resolveBinding.js';
import { documentConversionService } from '../../../services/documents/import/instance.js';
import { fetchRemoteDocument } from '../../../services/documents/import/safeRemoteSource.js';
import { SOURCE_LIMIT } from '../../../services/documents/import/sourceValidation.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: SOURCE_LIMIT, files: 1 } });
const conversionId = z.string().uuid();
const language = z.enum(['auto', 'en', 'ru']).default('auto');
const widgetId = z.coerce.number().int().positive();

function sourceNameForUrl(source) {
  if (/\.[A-Za-z0-9]+$/.test(source.name)) return source.name;
  const extensions = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/markdown': '.md',
    'text/plain': '.txt',
  };
  return `${source.name}${extensions[source.contentType] || ''}`;
}

function conversionError(res, err) {
  const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(err?.message || '') ? err.message : 'DOCUMENT_CONVERSION_REQUEST_FAILED';
  const status = code === 'DOCLING_IMPORT_DISABLED' ? 503 : code === 'DOCUMENT_ACTIVE_JOB_LIMIT' ? 429 : 400;
  return error(res, code, 'Document conversion request could not be completed.', status);
}

router.post('/documents/conversions', upload.single('file'), async (req, res) => {
  try {
    const widget_id = widgetId.parse(req.body.widget_id);
    const lang = language.parse(req.body.language);
    if (Boolean(req.file) === Boolean(req.body.source_url)) return badRequest(res, 'Exactly one source is required.', 'DOCUMENT_SOURCE_REQUIRED');
    const binding = await resolveBinding(widget_id);
    if (!binding.project_id || !(await requireEditorAccess(req, res, binding.project_id))) return;
    const source = req.file
      ? { bytes: req.file.buffer, name: req.file.originalname }
      : sourceNameForUrl(await fetchRemoteDocument(z.string().max(2048).parse(req.body.source_url)));
    const job = await documentConversionService.createJob({
      bytes: source.bytes,
      name: source.name,
      widgetId: widget_id,
      language: lang,
      requestedBy: req.user.id,
    });
    documentConversionService.schedule(job.id);
    return success(res, { conversion_id: job.id, status: job.status }, 202);
  } catch (err) {
    return conversionError(res, err);
  }
});

router.get('/documents/conversions/:conversionId', async (req, res) => {
  try {
    const id = conversionId.parse(req.params.conversionId);
    const job = await documentConversionService.getJob(id);
    if (!job) return notFound(res, 'Document conversion');
    if (Number(job.requested_by) !== Number(req.user?.id)) return forbidden(res, 'You do not own this conversion.');
    if (!(await requireEditorAccess(req, res, job.project_id))) return;
    const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [job.project_id]);
    if (!project || Number(project.space_id) !== Number(job.space_id)) return forbidden(res, 'Conversion space mismatch.');
    if (['queued', 'processing'].includes(job.status)) documentConversionService.schedule(job.id);
    return success(res, documentConversionService.toPublicJob(job, { includeMarkdown: true }));
  } catch (err) {
    return conversionError(res, err);
  }
});

export default router;
