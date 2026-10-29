/** Seedance uses only the conversation's vault key, including status checks. */
import { z } from 'zod';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dbGet, withTransactionAsync } from '../../database/connection.js';
import vault from '../secrets/SecretsVault.js';
import { aiLogger } from '../../utils/logger.js';

const MODEL = 'bytedance/seedance-2.0';
const API = 'https://api.replicate.com/v1';
const UPLOAD_BASE = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
const localUrl = z.string().max(512).regex(/^\/uploads\/[A-Za-z0-9_./-]+$/).refine(s => !s.includes('..'));
const predictionId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const predictionSchema = z.object({ id: predictionId, status: z.enum(['starting', 'processing', 'succeeded', 'failed', 'canceled']), model: z.string().optional(), output: z.unknown().optional() });
const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  reference_images: z.array(localUrl).max(3).default([]),
  reference_video: localUrl.optional(),
  duration: z.number().int().min(4).max(15).default(6),
  resolution: z.enum(['480p', '720p']).default('720p'),
  aspect_ratio: z.enum(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']).default('9:16'),
  generate_audio: z.boolean().default(false),
  seed: z.number().int().optional(),
}).strict();
const scopeSchema = z.object({ spaceId: z.coerce.number().int().positive().optional(), conversationId: z.coerce.number().int().positive() });

async function videoScope(context) {
  if (context?.source === 'mcp') {
    const bound = z.object({ jobId: z.number().int().positive(), agentId: z.number().int().positive(), spaceId: z.number().int().positive() }).parse(context);
    const job = await dbGet(`SELECT j.conversation_id FROM agent_jobs j JOIN conversations c ON c.id = j.conversation_id
      WHERE j.id = ? AND j.agent_row_id = ? AND c.space_id = ? AND j.status = 'processing'`,
    [bound.jobId, bound.agentId, bound.spaceId]);
    if (!job) throw new Error('VIDEO_ACTIVE_JOB_REQUIRED');
    context = { ...context, conversationId: job.conversation_id };
  }
  const scope = scopeSchema.parse({ spaceId: context?.spaceId ?? context?.space_id, conversationId: context?.conversationId ?? context?.conversation_id });
  const conversation = await dbGet('SELECT id, space_id FROM conversations WHERE id = ?', [scope.conversationId]);
  const spaceId = z.coerce.number().int().positive().parse(conversation?.space_id);
  // The agent loop may supply conversationId without a spaceId. Derive it
  // from the conversation, never from model-controlled tool arguments.
  if (scope.spaceId !== undefined && spaceId !== scope.spaceId) throw new Error('VIDEO_SPACE_MISMATCH');
  if (spaceId === 11) throw new Error('VIDEO_SPACE_REQUIRED');
  return { ...scope, spaceId };
}

async function spaceKey(spaceId) {
  const key = await vault.getSecret('replicate_api_key', { spaceId });
  if (!key) throw new Error('Сохраните replicate_api_key в Secrets пространства этой беседы. Общий ключ CRM для видео не используется.');
  return key;
}

async function readAttachment(url, type, scope) {
  const file = await dbGet('SELECT id, url, space_id, mime_type, storage_provider_id FROM files WHERE url = ?', [url]);
  if (!file || Number(file.space_id) !== scope.spaceId || file.storage_provider_id !== 'local' ||
      !(type === 'image' ? ['image/png', 'image/jpeg', 'image/webp'] : ['video/mp4']).includes(file.mime_type)) throw new Error('VIDEO_ATTACHMENT_ACCESS_DENIED');
  const attached = await dbGet(`SELECT id FROM messages WHERE conversation_id = ? AND COALESCE(is_deleted, 0) = 0
    AND attachments::jsonb @> ?::jsonb LIMIT 1`, [scope.conversationId, JSON.stringify([{ url }])]);
  if (!attached) throw new Error('VIDEO_ATTACHMENT_NOT_IN_CONVERSATION');
  const root = await fs.realpath(UPLOAD_BASE);
  const filename = path.join(root, url.slice('/uploads/'.length));
  if (await fs.realpath(filename) !== filename || !filename.startsWith(root + path.sep)) throw new Error('VIDEO_ATTACHMENT_PATH_DENIED');
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    const limit = (type === 'image' ? 10 : 50) * 1024 * 1024;
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) throw new Error('VIDEO_ATTACHMENT_SIZE_LIMIT');
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const part = await handle.read(bytes, size, bytes.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size !== stat.size) throw new Error('VIDEO_ATTACHMENT_CHANGED');
    return { bytes: bytes.subarray(0, size), mime: file.mime_type, name: path.basename(filename) };
  } finally { await handle.close(); }
}

export async function generateVideo(args, userId, context) {
  let submitting = false;
  let providerError;
  try {
    const input = inputSchema.parse(args);
    const scope = await videoScope(context);
    const key = await spaceKey(scope.spaceId);
    // Validate every attachment before transmitting any of them.
    const images = [];
    for (const url of input.reference_images) images.push(await readAttachment(url, 'image', scope));
    const video = input.reference_video ? await readAttachment(input.reference_video, 'video', scope) : null;
    const signal = AbortSignal.timeout(45000);
    const urls = [];
    for (const file of [...images, ...(video ? [video] : [])]) {
      const form = new FormData();
      form.append('content', new Blob([file.bytes], { type: file.mime }), file.name);
      const response = await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal, redirect: 'error' });
      if (!response.ok) throw new Error(`VIDEO_UPLOAD_HTTP_${response.status}`);
      const uploaded = z.object({ urls: z.object({ get: z.string().url().refine(s => s.startsWith('https://')) }) }).parse(await response.json());
      urls.push(uploaded.urls.get);
    }
    const { reference_video, ...payload } = input;
    payload.reference_images = urls.slice(0, images.length);
    payload.reference_videos = video ? urls.slice(images.length) : [];
    submitting = true;
    // No retries: a lost POST response is ambiguous and may already be billed.
    const response = await fetch(`${API}/models/${MODEL}/predictions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: payload }), signal, redirect: 'error',
    });
    if (!response.ok) {
      submitting = response.status >= 500;
      providerError = { stage: 'create', http_status: response.status };
      const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).safeParse(response.headers.get('x-request-id'));
      if (requestId.success && !requestId.data.includes(key) && !/r8_/i.test(requestId.data)) providerError.request_id = requestId.data;
      try {
        // Provider responses are untrusted. Bound reads; never retain raw bodies/headers.
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 8192) break;
          chunks.push(chunk);
        }
        if (size <= 8192) {
          const body = z.object({ detail: z.string().catch(''), title: z.string().catch('') })
            .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          const detail = (body.detail || body.title)
            .replaceAll(key, '[redacted]')
            .replace(/https?:\/\/[^\s<>"']+/gi, '[url]')
            .replace(/\b(?:Bearer|Token)\s+[^\s,;"']+/gi, '[redacted]')
            .replace(/\br8_[a-zA-Z0-9_-]+/gi, '[redacted]')
            .replace(/\b(?:authorization|api[_-]?key|token|secret|password)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[redacted]')
            .replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 512);
          if (detail) providerError.detail = detail;
        }
      } catch { /* Missing/malformed diagnostics must never mask the HTTP failure. */ }
      throw new Error(`VIDEO_CREATE_HTTP_${response.status}`);
    }
    const prediction = predictionSchema.parse(await response.json());
    aiLogger.info({ prediction_id: prediction.id, space_id: scope.spaceId }, 'Seedance prediction submitted');
    return { success: !['failed', 'canceled'].includes(prediction.status), async: true, prediction_id: prediction.id, kind: 'video', status: prediction.status, space_id: scope.spaceId,
      message: 'Проверяйте результат через replicate_check_prediction с kind="video" в этой беседе. Повторный запуск создаёт новое платное видео.' };
  } catch (error) {
    aiLogger.warn({ stage: providerError ? 'create' : submitting ? 'submission' : 'preparation', error_type: error.name, ...(providerError ? { provider_error: providerError } : {}) }, 'Seedance request failed');
    return { error: error instanceof z.ZodError ? 'VIDEO_INVALID_INPUT_OR_RESPONSE' : /^(VIDEO_|Сохраните)/.test(error.message) ? error.message : 'VIDEO_REQUEST_FAILED',
      ...(providerError ? { provider_error: providerError } : {}),
      ...(submitting ? { submission_unknown: true, message: 'Ответ на отправку задания потерян. Не повторяйте генерацию: сначала проверьте историю Replicate.' } : {}) };
  }
}

export async function checkVideo(args, userId, context) {
  try {
    const input = z.object({ prediction_id: predictionId, kind: z.literal('video'), space_id: z.number().int().positive().optional() }).strict().parse(args);
    const scope = await videoScope(context);
    if (input.space_id !== undefined && input.space_id !== scope.spaceId) throw new Error('VIDEO_SPACE_MISMATCH');
    const key = await spaceKey(scope.spaceId);
    const response = await fetch(`${API}/predictions/${input.prediction_id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`VIDEO_STATUS_HTTP_${response.status}`);
    const prediction = predictionSchema.parse(await response.json());
    if (prediction.id !== input.prediction_id || prediction.model !== MODEL) throw new Error('VIDEO_PREDICTION_MISMATCH');
    const result = { prediction_id: prediction.id, kind: 'video', status: prediction.status, space_id: scope.spaceId };
    if (['failed', 'canceled'].includes(prediction.status)) return { ...result, success: false, error: `Prediction ${prediction.status}` };
    if (prediction.status !== 'succeeded') return { ...result, success: true, async: true };
    const output = z.string().url().refine(s => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'replicate.delivery' || u.hostname.endsWith('.replicate.delivery')); }).parse(prediction.output);
    const fileId = `replicate_${scope.spaceId}_${prediction.id}`;
    const name = `${fileId}.mp4`;
    const relativeUrl = `/uploads/spaces/${scope.spaceId}/${name}`;
    let saved = await dbGet('SELECT id, url, size, mime_type FROM files WHERE id = ? AND space_id = ?', [fileId, scope.spaceId]);
    if (!saved) {
      const root = await fs.realpath(UPLOAD_BASE);
      const dir = path.join(root, 'spaces', String(scope.spaceId));
      await fs.mkdir(dir, { recursive: true });
      if (await fs.realpath(dir) !== dir) throw new Error('VIDEO_OUTPUT_PATH_DENIED');
      const filePath = path.join(dir, name);
      const tempPath = `${filePath}.${randomUUID()}.tmp`;
      let size = 0;
      try {
        const download = await fetch(output, { signal: AbortSignal.timeout(45000), redirect: 'error' });
        if (!download.ok || !download.body) throw new Error('VIDEO_DOWNLOAD_FAILED');
        const handle = await fs.open(tempPath, 'wx', 0o600);
        try {
          for await (const chunk of download.body) {
            size += chunk.length;
            if (size > 200 * 1024 * 1024) throw new Error('VIDEO_OUTPUT_SIZE_LIMIT');
            await handle.writeFile(chunk);
          }
        } finally { await handle.close(); }
        if (!size) throw new Error('VIDEO_EMPTY_OUTPUT');
        await fs.rename(tempPath, filePath);
      } finally { await fs.rm(tempPath, { force: true }); }
      await withTransactionAsync(trx => trx.run(`INSERT INTO files
        (id, name, original_name, mime_type, size, path, url, storage_provider_id, space_id, uploaded_by, visibility, created_at, updated_at)
        VALUES (?, ?, ?, 'video/mp4', ?, ?, ?, 'local', ?, ?, 'private', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING`, [fileId, name, name, size, filePath, relativeUrl, scope.spaceId, userId]));
      saved = { id: fileId, url: relativeUrl, size, mime_type: 'video/mp4' };
    }
    return { ...result, success: true, video: { file_id: saved.id, url: saved.url, relative_url: saved.url, size: saved.size, mime_type: saved.mime_type } };
  } catch (error) {
    aiLogger.warn({ error_type: error.name }, 'Seedance status check failed');
    return { error: error instanceof z.ZodError ? 'VIDEO_INVALID_INPUT_OR_RESPONSE' : /^(VIDEO_|Сохраните)/.test(error.message) ? error.message : 'VIDEO_STATUS_FAILED' };
  }
}
