import { randomUUID } from 'node:crypto';
import { dbGet, dbRun, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { resolveBinding } from '../resolveBinding.js';
import { DoclingClient, conversionWarnings } from './DoclingClient.js';
import { decodeText, MARKDOWN_LIMIT, SOURCE_LIMIT, validateSource } from './sourceValidation.js';
import { savePrivateFile, readFileById } from './fileStorage.js';
import { materializeEmbeddedImages } from './assets.js';

const SAFE_ERROR = /^[A-Z][A-Z0-9_]{2,80}$/;

function jobErrorCode(error) {
  return SAFE_ERROR.test(error?.message || '') ? error.message : 'DOCUMENT_CONVERSION_FAILED';
}

function resultTitle(markdown, sourceName) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 500) || sourceName.replace(/\.[^.]+$/, '').slice(0, 500) || 'Imported document';
}

export class DocumentConversionService {
  constructor({ doclingClient = new DoclingClient(), saveFile = savePrivateFile } = {}) {
    this.docling = doclingClient;
    this.saveFile = saveFile;
    this.activeJobs = new Set();
  }

  async createJob({ bytes, name, widgetId, language = 'auto', requestedBy, conversationId = null, importRequest = {} }) {
    if (process.env.DOCLING_IMPORT_ENABLED === 'false') throw new Error('DOCLING_IMPORT_DISABLED');
    if (!['auto', 'en', 'ru'].includes(language)) throw new Error('DOCUMENT_LANGUAGE_INVALID');
    if (JSON.stringify(importRequest).length > 4096) throw new Error('DOCUMENT_IMPORT_REQUEST_INVALID');
    const binding = await resolveBinding(widgetId);
    if (!binding.project_id) throw new Error('DOCUMENT_PROJECT_REQUIRED');
    const project = await dbGet('SELECT id, space_id FROM projects WHERE id = ?', [binding.project_id]);
    if (!project) throw new Error('DOCUMENT_PROJECT_NOT_FOUND');
    const active = await dbGet(`SELECT COUNT(*)::int AS count FROM document_conversion_jobs
      WHERE requested_by = ? AND status IN ('queued', 'processing', 'finalizing')`, [requestedBy]);
    if ((active?.count || 0) >= 2) throw new Error('DOCUMENT_ACTIVE_JOB_LIMIT');
    const source = await validateSource(bytes, name);
    const file = await this.saveFile({
      bytes,
      name,
      mimeType: source.mimeType,
      spaceId: project.space_id,
      projectId: project.id,
      userId: requestedBy,
    });
    const id = randomUUID();
    await dbRun(`INSERT INTO document_conversion_jobs
      (id, space_id, project_id, widget_id, requested_by, conversation_id, source_file_id, source_name, source_format, language, import_request, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, 'queued', NOW() + INTERVAL '24 hours')`,
    [id, project.space_id, project.id, widgetId, requestedBy, conversationId, file.id, name, source.format, language, JSON.stringify(importRequest)]);
    return { id, status: 'queued', space_id: project.space_id, project_id: project.id, widget_id: widgetId, requested_by: requestedBy };
  }

  schedule(id) {
    if (this.activeJobs.has(id)) return;
    setImmediate(() => {
      this.processJob(id).catch((error) => {
        apiLogger.error({ conversion_id: id, error_code: jobErrorCode(error) }, 'Document conversion scheduling failed');
      });
    });
  }

  async getJob(id) {
    const job = await dbGet('SELECT * FROM document_conversion_jobs WHERE id = ?', [id]);
    if (job?.status === 'converted' && job.result_markdown && new Date(job.expires_at).getTime() <= Date.now()) {
      await dbRun("UPDATE document_conversion_jobs SET status = 'failed', error_code = 'DOCUMENT_CONVERSION_EXPIRED', result_markdown = NULL, updated_at = NOW() WHERE id = ?", [id]);
      return { ...job, status: 'failed', error_code: 'DOCUMENT_CONVERSION_EXPIRED', result_markdown: null };
    }
    return job;
  }

  async failJob(id, code) {
    await dbRun(`UPDATE document_conversion_jobs SET status = 'failed', error_code = ?, result_markdown = NULL, updated_at = NOW(), completed_at = NOW() WHERE id = ?`, [code, id]);
  }

  async processJob(id) {
    if (this.activeJobs.has(id)) return;
    this.activeJobs.add(id);
    try {
      let job = await this.getJob(id);
      if (job?.status === 'queued') {
        const claimed = await dbRun("UPDATE document_conversion_jobs SET status = 'processing', updated_at = NOW() WHERE id = ? AND status = 'queued'", [id]);
        if (!claimed.changes) return;
        job = { ...job, status: 'processing' };
      }
      if (job?.status !== 'processing') return;
      if (Date.now() - new Date(job.created_at).getTime() > 600_000) {
        await this.failJob(id, 'DOCUMENT_CONVERSION_TIMEOUT');
        return;
      }
      const { file, bytes } = await readFileById(job.source_file_id, SOURCE_LIMIT);
      if (['md', 'txt'].includes(job.source_format)) {
        const markdown = decodeText(bytes);
        if (!markdown.trim()) throw new Error('DOCUMENT_TEXT_EMPTY');
        if (markdown.length > MARKDOWN_LIMIT) throw new Error('DOCUMENT_MARKDOWN_LIMIT');
        await this.persistResult(job, { markdown, warnings: [], assets: [], sourceFile: file });
        return;
      }

      let taskId = job.docling_task_id;
      if (!taskId) {
        const task = await this.docling.submit({
          bytes,
          name: job.source_name,
          mimeType: file.mime_type,
          format: job.source_format,
          language: job.language,
        });
        taskId = task.task_id;
        await dbRun('UPDATE document_conversion_jobs SET docling_task_id = ?, updated_at = NOW() WHERE id = ? AND docling_task_id IS NULL', [taskId, id]);
      }
      const task = await this.docling.poll(taskId);
      if (['pending', 'started'].includes(task.task_status)) return;
      if (task.task_status !== 'success') {
        await this.failJob(id, 'DOCLING_CONVERSION_FAILED');
        return;
      }
      const result = await this.docling.result(taskId);
      const markdown = result.document.md_content;
      if (!['success', 'partial_success'].includes(result.status) || typeof markdown !== 'string' || !markdown.trim()) {
        throw new Error('DOCLING_RESULT_INVALID');
      }
      if (markdown.length > MARKDOWN_LIMIT && !markdown.includes('data:image/')) throw new Error('DOCUMENT_MARKDOWN_LIMIT');
      const materialized = await materializeEmbeddedImages(markdown, {
        spaceId: job.space_id,
        projectId: job.project_id,
        userId: job.requested_by,
      }, this.saveFile);
      await this.persistResult(job, {
        markdown: materialized.markdown,
        warnings: conversionWarnings(result.errors),
        assets: materialized.assets,
        sourceFile: file,
      });
    } catch (error) {
      const code = jobErrorCode(error);
      apiLogger.warn({ conversion_id: id, error_code: code }, 'Document conversion failed');
      await this.failJob(id, code);
    } finally {
      this.activeJobs.delete(id);
    }
  }

  async persistResult(job, { markdown, warnings, assets, sourceFile }) {
    const metadata = {
      title: resultTitle(markdown, job.source_name),
      warnings,
      assets,
      source: { file_id: sourceFile.id, url: sourceFile.url },
    };
    await dbRun(`UPDATE document_conversion_jobs SET status = 'converted', result_markdown = ?, result_metadata = ?::jsonb,
      error_code = NULL, updated_at = NOW(), completed_at = NOW() WHERE id = ? AND status = 'processing'`,
    [markdown, JSON.stringify(metadata), job.id]);
  }

  toPublicJob(job, { includeMarkdown = false } = {}) {
    const metadata = safeJsonParse(job.result_metadata, {}) || {};
    const result = {
      conversion_id: job.id,
      status: job.status,
      ...(job.error_code ? { error: { code: job.error_code, message: 'Document conversion failed.' } } : {}),
    };
    if (includeMarkdown && ['converted', 'finalizing', 'completed'].includes(job.status)) {
      Object.assign(result, {
        title: metadata.title,
        markdown: job.result_markdown,
        warnings: metadata.warnings || [],
        assets: metadata.assets || [],
        source: metadata.source,
      });
    }
    return result;
  }

}
