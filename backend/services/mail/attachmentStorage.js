import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { withTransactionAsync } from '../../database/connection.js';

const id = z.coerce.number().int().positive().safe();
const schema = z.object({
  spaceId: id, connectorId: id, messageId: z.string().min(1),
  projectId: id.nullish(), userId: id.nullish(),
  attachments: z.array(z.object({
    filename: z.string().min(1).max(500),
    contentType: z.string().max(100).default('application/octet-stream'),
    content: z.instanceof(Buffer),
  })).max(100),
}).refine((v) => v.attachments.reduce((n, a) => n + a.content.length, 0) <= 100 * 1024 * 1024,
  'Mail attachments exceed 100 MB');

// One storage path for inbound, outbound and draft attachments. Stable IDs make
// concurrent/repeated sync idempotent. Files are private to the mail space.
export async function storeMailAttachments(input) {
  const { spaceId, connectorId, messageId, projectId, userId, attachments } = schema.parse(input);
  if (!attachments.length) return [];
  const base = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
  const dir = path.join(base, 'spaces', String(spaceId));
  await mkdir(dir, { recursive: true });
  return withTransactionAsync(async (tx) => {
    // Some installations have no UNIQUE(files.id). Serialize this message's
    // writers across processes before checking/inserting any attachment.
    await tx.run('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))',
      [JSON.stringify(['mail-attachments', spaceId, connectorId, messageId])]);
    const result = [];
    for (const [index, a] of attachments.entries()) {
      const digest = createHash('sha256').update(JSON.stringify([spaceId, connectorId, messageId, index, a.filename])).update(a.content).digest('hex');
      const fileId = `mail_${digest}`;
      const ext = path.extname(a.filename).toLowerCase();
      const name = fileId + (/^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '.bin');
      const filePath = path.join(dir, name);
      const tmp = `${filePath}.${randomUUID()}.tmp`;
      // Atomic publication: another downloader never sees a partial file.
      try {
        await writeFile(tmp, a.content, { mode: 0o600, flag: 'wx' });
        await rename(tmp, filePath);
      } finally {
        await rm(tmp, { force: true });
      }
      const url = `/uploads/spaces/${spaceId}/${name}`;
      const existing = await tx.run(`UPDATE files SET project_id = COALESCE(project_id, ?)
        WHERE id = ? AND space_id = ?`, [projectId ?? null, fileId, spaceId]);
      if (!existing.changes) await tx.run(`INSERT INTO files
        (id, name, original_name, mime_type, size, path, url, storage_provider_id,
         space_id, project_id, uploaded_by, metadata, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, ?::jsonb, 'private', now(), now())`,
      [fileId, name, a.filename, a.contentType, a.content.length, filePath, url,
        spaceId, projectId ?? null, userId ?? null, JSON.stringify({ source: 'mail', message_id: messageId, index })]);
      result.push({ filename: a.filename, contentType: a.contentType, size: a.content.length, fileId, url });
    }
    return result;
  });
}
