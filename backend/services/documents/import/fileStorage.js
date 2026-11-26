import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dbGet, dbRun } from '../../../database/connection.js';

const UPLOAD_BASE = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
const EXTENSIONS = new Set(['.pdf', '.docx', '.md', '.markdown', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp']);

export async function readLocalFile(file, maxBytes) {
  if (!file || file.storage_provider_id !== 'local') throw new Error('DOCUMENT_FILE_ACCESS_DENIED');
  const root = await fs.realpath(UPLOAD_BASE);
  const filename = path.join(root, file.url.slice('/uploads/'.length));
  if (await fs.realpath(filename) !== filename || !filename.startsWith(root + path.sep)) {
    throw new Error('DOCUMENT_FILE_PATH_DENIED');
  }
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) throw new Error('DOCUMENT_FILE_SIZE_LIMIT');
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const part = await handle.read(bytes, size, bytes.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size !== stat.size) throw new Error('DOCUMENT_FILE_CHANGED');
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}

export async function savePrivateFile({ bytes, name, mimeType, spaceId, projectId = null, userId }) {
  const id = `file_${Date.now()}_${randomBytes(8).toString('hex')}`;
  const extension = EXTENSIONS.has(path.extname(name).toLowerCase()) ? path.extname(name).toLowerCase() : '';
  const storedName = `${id}${extension}`;
  const root = await fs.realpath(UPLOAD_BASE);
  const directory = path.join(root, 'spaces', String(spaceId));
  await fs.mkdir(directory, { recursive: true });
  if (await fs.realpath(directory) !== directory || !directory.startsWith(root + path.sep)) {
    throw new Error('DOCUMENT_FILE_PATH_DENIED');
  }
  const filePath = path.join(directory, storedName);
  const url = `/uploads/spaces/${spaceId}/${storedName}`;
  const handle = await fs.open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  try {
    await dbRun(`INSERT INTO files
      (id, name, original_name, mime_type, size, path, url, storage_provider_id, space_id, project_id, uploaded_by, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, 'private', NOW(), NOW())`,
    [id, storedName, path.basename(name).slice(0, 500), mimeType, bytes.length, filePath, url, spaceId, projectId, userId]);
  } catch (error) {
    await fs.rm(filePath, { force: true });
    throw error;
  }
  return { id, name: storedName, original_name: path.basename(name), mime_type: mimeType, size: bytes.length, path: filePath, url, storage_provider_id: 'local', space_id: spaceId, project_id: projectId };
}

export async function readFileById(id, maxBytes) {
  const file = await dbGet('SELECT id, url, space_id, mime_type, original_name, storage_provider_id FROM files WHERE id = ?', [id]);
  if (!file) throw new Error('DOCUMENT_SOURCE_NOT_FOUND');
  const bytes = await readLocalFile(file, maxBytes);
  return { file, bytes };
}
