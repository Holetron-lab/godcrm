/**
 * ADR-204 Stage 2 — server-side media-kind resolution for `content` values.
 *
 * The contract (ADR-204 §Content adapter) is explicit: "Проверка источника
 * определяет media kind; расширение URL и старый ключ image не доказывают
 * MIME", and AC8 of ticket 254364: the server verifies admissible files on
 * every write/bind path, the payload `kind` never replaces that check.
 *
 * Resolution order per URL:
 *   1. `/uploads/...` — the `files` registry row for that url. Its MIME type
 *      (recorded by multer at upload time) is authoritative. A registered
 *      upload whose MIME is not image/video/audio is NOT media, whatever the
 *      caller claimed.
 *   2. Anything else (absolute http(s), data:, external-source relative path)
 *      — a conservative extension allow-list. This is the honest limit of
 *      what the server can know without fetching the resource, and fetching
 *      user-supplied URLs at write time is an SSRF surface we do not open.
 *   3. Neither → `null` (unverifiable). Callers must treat null as "not
 *      admissible", never default to image.
 */
import { dbGet } from '../../database/connection.js';

const EXTENSION_KINDS = Object.freeze({
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  avif: 'image', svg: 'image', bmp: 'image', heic: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
  mp3: 'audio', ogg: 'audio', oga: 'audio', wav: 'audio', m4a: 'audio',
  aac: 'audio', flac: 'audio', opus: 'audio',
});

/** @returns {'image'|'video'|'audio'|null} */
export function kindFromMime(mime) {
  if (typeof mime !== 'string') return null;
  const top = mime.split('/')[0].toLowerCase();
  return top === 'image' || top === 'video' || top === 'audio' ? top : null;
}

/** @returns {'image'|'video'|'audio'|null} */
export function kindFromExtension(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('data:')) return kindFromMime(url.slice(5).split(/[;,]/)[0]);
  const path = url.split(/[?#]/)[0];
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXTENSION_KINDS[ext] ?? null;
}

/**
 * Resolve the media kind of one stored address.
 * @param {string} url
 * @returns {Promise<'image'|'video'|'audio'|null>}
 */
export async function resolveMediaKind(url) {
  if (typeof url !== 'string' || !url) return null;
  if (url.startsWith('/uploads/')) {
    const file = await dbGet('SELECT mime_type FROM files WHERE url = ? LIMIT 1', [url]);
    if (file) return kindFromMime(file.mime_type);
  }
  return kindFromExtension(url);
}

/**
 * Verify a (shape-valid) `content` value against real files.
 * @param {Array<{url: string, kind: string}>|null} value
 * @param {(url: string) => Promise<string|null>} [resolve] injectable for tests
 * @returns {Promise<string[]>} problems; empty = admissible
 */
export async function verifyContentValue(value, resolve = resolveMediaKind) {
  if (!Array.isArray(value)) return [];
  const problems = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const actual = await resolve(item?.url);
    if (!actual) problems.push(`item ${i}: media type of "${item?.url}" cannot be verified`);
    else if (actual !== item.kind) problems.push(`item ${i}: declared ${item.kind} but the file is ${actual}`);
  }
  return problems;
}
