/** ProjectVB CSV capability: explicit scope, complete parse, lossless projection. */
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { dbGet, withTransactionAsync } from '../../database/connection.js';
import { aiLogger } from '../../utils/logger.js';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGE_BYTES = 48 * 1024;
const csvUrl = z.string().max(255).regex(/^\/uploads\/(?:projects\/8406|spaces\/7819)\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.csv$/).refine(s => !s.includes('..'));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const common = {
  url: csvUrl,
  delimiter: z.enum([',', ';', '\t']),
  encoding: z.enum(['utf-8', 'windows-1251', 'utf-16le']).default('utf-8'),
};
const projection = {
  ...common,
  sha256: digest,
  columns: z.array(z.object({ index: z.number().int().min(0).max(255), name: z.string().min(1).max(256) }).strict()).min(1).max(256),
  formula_policy: z.enum(['reject', 'apostrophe']),
};
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), ...common, sha256: digest.optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(1000).default(100) }).strict(),
  z.object({ action: z.literal('create'), ...projection, basename: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/), version: z.number().int().min(1).max(999999) }).strict(),
  z.object({ action: z.literal('verify'), ...projection, target_url: csvUrl, target_sha256: digest }).strict(),
]);
const agentGrant = z.object({ slug: z.literal('agent-vibe'), space_id: z.union([z.literal(7819), z.literal('7819')]), status: z.literal('active'), tools: z.array(z.string()) });

async function authorizeCsv(context, userId) {
  if (Number(context?.agentId) !== 241656 || Number(context?.spaceId) !== 7819 || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('CSV_ACCESS_DENIED');
  const row = await dbGet('SELECT data FROM table_rows WHERE table_id = ? AND id = ?', [100887, 241656]);
  let data;
  try { data = typeof row?.data === 'string' ? JSON.parse(row.data) : row?.data; } catch { throw new Error('CSV_ACCESS_DENIED'); }
  const grant = agentGrant.safeParse(data);
  if (!grant.success || !grant.data.tools.includes('project_csv')) throw new Error('CSV_ACCESS_DENIED');
  const project = await dbGet('SELECT id, space_id FROM projects WHERE id = ?', [8406]);
  if (Number(project?.id) !== 8406 || Number(project?.space_id) !== 7819) throw new Error('CSV_ACCESS_DENIED');
}

async function csvPath(url) {
  const root = await fs.realpath(process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads');
  const filename = path.join(root, url.slice('/uploads/'.length));
  // The configured root may be a deployment symlink; everything below it must
  // be the real scoped directory. No mkdir from untrusted tool arguments.
  if (await fs.realpath(path.dirname(filename)) !== path.dirname(filename)) throw new Error('CSV_ACCESS_DENIED');
  return filename;
}

function decodeCsv(bytes, delimiter, encoding) {
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    let count = 0;
    const records = parse(text, {
      bom: true, delimiter, cast: false, skip_empty_lines: false,
      max_record_size: 1024 * 1024,
      on_record(record) {
        if (++count > 100001 || record.length > 256) throw new Error('limit');
        return record;
      },
    });
    if (!records.length) throw new Error('empty');
    return records;
  } catch {
    // Parser errors can contain customer cells; never return/log their text.
    throw new Error('CSV_INVALID: check encoding, delimiter, quotes, rectangular rows; limits 100000 records/256 columns/1 MiB record');
  }
}

async function readCsv(url, delimiter, encoding, expectedSha, registered = true) {
  if (registered) {
    const file = await dbGet('SELECT id, url, space_id, project_id, storage_provider_id FROM files WHERE url = ?', [url]);
    // Legacy project-only uploads have NULL space_id; the project's current
    // space was independently checked above. A conflicting non-null scope fails.
    if (!file || file.url !== url || Number(file.project_id) !== 8406 || (file.space_id != null && Number(file.space_id) !== 7819) || file.storage_provider_id !== 'local') throw new Error('CSV_ACCESS_DENIED');
  }
  const filename = await csvPath(url);
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('CSV_ACCESS_DENIED');
    if (stat.size > MAX_BYTES) throw new Error('CSV_SIZE_LIMIT: 20 MiB, no data read partially');
    // Bound reads even if another writer grows the file after stat().
    const chunks = []; let size = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_BYTES + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_BYTES) throw new Error('CSV_SIZE_LIMIT: 20 MiB');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    bytes = Buffer.concat(chunks);
  } finally { await handle.close(); }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha && expectedSha !== sha256) throw new Error('CSV_SOURCE_CHANGED');
  return { records: decodeCsv(bytes, delimiter, encoding), sha256, size: bytes.length };
}

function projectCsv(records, columns, policy) {
  if (columns.some(c => c.index >= records[0].length)) throw new Error('CSV_COLUMN_OUT_OF_RANGE');
  if (new Set(columns.map(c => c.name)).size !== columns.length) throw new Error('CSV_DUPLICATE_HEADER');
  let escaped = 0;
  const projected = [columns.map(c => c.name), ...records.slice(1).map(row => columns.map(c => row[c.index]))];
  const safe = projected.map(row => row.map(cell => {
    if (!/^[\s\uFEFF]*[=+@-]/u.test(cell) && !/^[\t\r\n]/.test(cell)) return cell;
    if (policy !== 'apostrophe') throw new Error('CSV_FORMULA_REQUIRES_POLICY');
    escaped++;
    return `'${cell}`;
  }));
  return { records: safe, escaped_cells: escaped };
}

export const csvToolHandlers = {
  async project_csv(args, userId, context) {
    const parsed = input.safeParse(args);
    if (!parsed.success) throw new Error('CSV_INVALID_ARGUMENTS');
    const a = parsed.data;
    if (a.action === 'read' && a.offset > 0 && !a.sha256) throw new Error('CSV_DIGEST_REQUIRED');
    await authorizeCsv(context, userId);
    const source = await readCsv(a.url, a.delimiter, a.encoding, a.sha256);
    const total = source.records.length - 1;
    if (a.action === 'read') {
      if (a.offset > total) throw new Error('CSV_OFFSET_OUT_OF_RANGE');
      const records = [];
      let pageBytes = Buffer.byteLength(JSON.stringify(source.records[0]));
      if (pageBytes > MAX_PAGE_BYTES) throw new Error('CSV_HEADER_EXCEEDS_PAGE_LIMIT');
      for (const record of source.records.slice(a.offset + 1, a.offset + 1 + a.limit)) {
        const size = Buffer.byteLength(JSON.stringify(record));
        if (pageBytes + size > MAX_PAGE_BYTES) {
          if (!records.length) throw new Error('CSV_RECORD_EXCEEDS_PAGE_LIMIT: use server-side create/verify');
          break;
        }
        records.push(record); pageBytes += size;
      }
      return { success: true, url: a.url, sha256: source.sha256, size: source.size, headers: source.records[0], records, total_records: total, parsed_complete: true, offset: a.offset, next_offset: a.offset + records.length < total ? a.offset + records.length : null };
    }
    const expected = projectCsv(source.records, a.columns, a.formula_policy);
    if (a.action === 'verify') {
      const target = await readCsv(a.target_url, a.delimiter, 'utf-8', a.target_sha256);
      if (!isDeepStrictEqual(expected.records, target.records)) throw new Error('CSV_VERIFY_MISMATCH');
      return { success: true, verified: true, total_records: total, sha256: target.sha256, source_sha256: source.sha256, escaped_cells: expected.escaped_cells };
    }
    // RFC 4180: quote every cell, double embedded quotes, terminate with CRLF.
    // Count before serializing: repeated projections can amplify a small input.
    let outputBytes = 3; // UTF-8 BOM
    for (const row of expected.records) {
      outputBytes += row.length - 1 + 2; // one-byte delimiters and CRLF
      for (const cell of row) {
        outputBytes += Buffer.byteLength(cell) + 2 + (cell.match(/"/g)?.length || 0);
        if (outputBytes > MAX_BYTES) throw new Error('CSV_SIZE_LIMIT: output exceeds 20 MiB');
      }
    }
    const content = '\uFEFF' + expected.records.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(a.delimiter)).join('\r\n') + '\r\n';
    const name = `${a.basename}_v${String(a.version).padStart(3, '0')}.csv`;
    const url = `/uploads/projects/8406/${name}`;
    if (await dbGet('SELECT id FROM files WHERE url = ?', [url])) throw new Error('CSV_VERSION_EXISTS');
    const filename = await csvPath(url);
    // Exclusive creation reserves the version across processes. Never overwrite.
    let handle;
    try { handle = await fs.open(filename, 'wx', 0o600); } catch (err) {
      if (err.code === 'EEXIST') throw new Error('CSV_VERSION_EXISTS');
      throw err;
    }
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    const target = await readCsv(url, a.delimiter, 'utf-8', undefined, false);
    if (!isDeepStrictEqual(expected.records, target.records)) throw new Error('CSV_VERIFY_MISMATCH');
    const id = `file_${randomUUID()}`;
    const metadata = { id, name, original_name: name, mime_type: 'text/csv', size: target.size, path: filename, url, space_id: 7819, project_id: 8406, uploaded_by: userId, storage_provider_id: 'local', visibility: 'private', description: JSON.stringify({ source: a.url, source_sha256: source.sha256, sha256: target.sha256, columns: a.columns, formula_policy: a.formula_policy, records: total }) };
    // Publication is atomic in the registry. On an ambiguous DB failure keep
    // the reserved file (never unlink a potentially committed file); retrying
    // the same version fails closed and requires inspection by the operator.
    await withTransactionAsync(async trx => {
      await trx.run(`INSERT INTO files (id, name, original_name, mime_type, size, path, url, space_id, project_id, uploaded_by, storage_provider_id, visibility, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 'private', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, name, name, 'text/csv', target.size, filename, url, 7819, 8406, userId, metadata.description]);
      const registered = await trx.get('SELECT id, name, original_name, mime_type, size, path, url, space_id, project_id, uploaded_by, storage_provider_id, visibility, description FROM files WHERE id = ?', [id]);
      if (!isDeepStrictEqual(registered, metadata)) throw new Error('CSV_REGISTRY_VERIFY_FAILED');
    });
    aiLogger.info({ fileId: id, projectId: 8406, records: total, sha256: target.sha256 }, 'Project CSV created and verified');
    return { success: true, verified: true, file_id: id, url, name, size: target.size, sha256: target.sha256, source_sha256: source.sha256, total_records: total, escaped_cells: expected.escaped_cells };
  },
};
