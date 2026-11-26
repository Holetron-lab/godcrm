import { z } from 'zod';

const taskSchema = z.object({
  task_id: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
  task_status: z.enum(['pending', 'started', 'success', 'failure']),
}).passthrough();

const resultSchema = z.object({
  document: z.object({ md_content: z.string().nullable().optional() }).passthrough(),
  status: z.enum(['success', 'partial_success', 'skipped', 'failure']),
  errors: z.array(z.unknown()).max(100).optional().default([]),
}).passthrough();

async function readJson(response, limit) {
  if (!response.body) throw new Error('DOCLING_RESPONSE_INVALID');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('DOCLING_RESPONSE_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    throw new Error('DOCLING_RESPONSE_INVALID');
  }
}

export class DoclingClient {
  constructor({ baseUrl = process.env.DOCLING_SERVE_URL, apiKey = process.env.DOCLING_SERVE_API_KEY, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl?.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async request(path, { method = 'GET', body, timeout = 15_000, responseLimit = 1_000_000 } = {}) {
    if (!this.baseUrl || !this.apiKey) throw new Error('DOCLING_IMPORT_DISABLED');
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'X-Api-Key': this.apiKey },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new Error('DOCLING_REQUEST_FAILED');
    }
    if (!response.ok) throw new Error(`DOCLING_HTTP_${response.status}`);
    return readJson(response, responseLimit);
  }

  async submit({ bytes, name, mimeType, format, language }) {
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: mimeType }), name);
    form.append('from_formats', format);
    form.append('to_formats', 'md');
    form.append('pipeline', 'standard');
    form.append('do_ocr', 'true');
    form.append('force_ocr', 'false');
    form.append('image_export_mode', 'embedded');
    form.append('table_mode', 'accurate');
    form.append('max_num_pages', '200');
    form.append('document_timeout', '600');
    for (const lang of language === 'auto' ? ['en', 'ru'] : [language]) form.append('ocr_lang', lang);
    const payload = await this.request('/v1/convert/file/async', { method: 'POST', body: form, timeout: 30_000 });
    return taskSchema.parse(payload);
  }

  async poll(taskId) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(taskId)) throw new Error('DOCLING_TASK_INVALID');
    const payload = await this.request(`/v1/status/poll/${encodeURIComponent(taskId)}`);
    const task = taskSchema.parse(payload);
    if (task.task_id !== taskId) throw new Error('DOCLING_TASK_MISMATCH');
    return task;
  }

  async result(taskId) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(taskId)) throw new Error('DOCLING_TASK_INVALID');
    const payload = await this.request(`/v1/result/${encodeURIComponent(taskId)}`, {
      timeout: 60_000,
      responseLimit: 150 * 1024 * 1024,
    });
    return resultSchema.parse(payload);
  }
}

export function conversionWarnings(errors) {
  return errors.slice(0, 20).map(() => 'Docling reported a conversion warning.');
}
