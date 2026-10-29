// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const db = vi.hoisted(() => ({ dbGet: vi.fn(), withTransactionAsync: vi.fn() }));
vi.mock('../../../database/connection.js', () => db);
vi.mock('../../audit/toolAudit.js', () => ({ auditToolCall: vi.fn() }));
const { csvToolHandlers } = await import('../csv-tools.js');
const call = (args, context = { agentId: 241656, spaceId: 7819 }) => csvToolHandlers.project_csv(args, 15, context);
const url = '/uploads/projects/8406/source.csv';
const source = { url, delimiter: ';', encoding: 'utf-8' };
const columns = [{ index: 1, name: 'Наименование' }, { index: 0, name: 'Код' }];
const hash = (b) => createHash('sha256').update(b).digest('hex');
let root, files, data, grant, project, trx;

beforeEach(async () => {
  vi.clearAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-csv-'));
  vi.stubEnv('UPLOAD_PATH', root);
  await fs.mkdir(path.join(root, 'projects/8406'), { recursive: true });
  data = '\uFEFFКод;Название;Пусто\r\n00123;"Серьга; ""А""\nВторая строка";\r\n00000;Кольцо;\r\n';
  await fs.writeFile(path.join(root, 'projects/8406/source.csv'), data);
  files = new Map([[url, { id: 'source', url, project_id: 8406, space_id: null, storage_provider_id: 'local' }]]);
  grant = { data: { slug: 'agent-vibe', space_id: '7819', status: 'active', tools: ['project_csv'] } };
  project = { id: 8406, space_id: 7819 };
  db.dbGet.mockImplementation(async (sql, params) => {
    if (sql.includes('table_rows')) return grant;
    if (sql.includes('projects')) return project;
    return files.get(params[0]);
  });
  trx = { run: vi.fn(async (_sql, p) => {
    files.set(p[6], { id: p[0], name: p[1], original_name: p[2], mime_type: p[3], size: p[4], path: p[5], url: p[6], space_id: p[7], project_id: p[8], uploaded_by: p[9], description: p[10], storage_provider_id: 'local', visibility: 'private' });
  }), get: vi.fn(async (_sql, p) => [...files.values()].find(f => f.id === p[0])) };
  db.withTransactionAsync.mockImplementation(fn => fn(trx));
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });

const create = () => ({ action: 'create', ...source, sha256: hash(data), columns, basename: 'altegio_common', version: 1, formula_policy: 'reject' });

describe('project_csv', () => {
  it('fully parses strings, quotes, multiline Cyrillic and empty cells; pages by record', async () => {
    const first = await call({ action: 'read', ...source, limit: 1 });
    expect(first).toMatchObject({ success: true, total_records: 2, parsed_complete: true, next_offset: 1, sha256: hash(data) });
    expect(first.records).toEqual([['00123', 'Серьга; "А"\nВторая строка', '']]);
    const last = await call({ action: 'read', ...source, offset: 1, sha256: first.sha256 });
    expect(last.records).toEqual([['00000', 'Кольцо', '']]);
    expect(last.next_offset).toBeNull();
  });
  it('creates private versioned CSV, rereads every cell and verifies again independently', async () => {
    const result = await call(create());
    expect(result).toMatchObject({ success: true, verified: true, total_records: 2, name: 'altegio_common_v001.csv' });
    expect(trx.run).toHaveBeenCalledOnce();
    const written = await fs.readFile(path.join(root, 'projects/8406/altegio_common_v001.csv'), 'utf8');
    expect(written).toContain('"00123"');
    const checked = await call({ action: 'verify', ...source, sha256: hash(data), columns, formula_policy: 'reject', target_url: result.url, target_sha256: result.sha256 });
    expect(checked).toMatchObject({ success: true, verified: true, total_records: 2 });
    expect(await fs.readFile(path.join(root, 'projects/8406/source.csv'), 'utf8')).toBe(data);
  });
  it('reads and verifies every record beyond 100 KB', async () => {
    data = 'Код;Название;Пусто\n' + Array.from({ length: 7000 }, (_, i) => `${String(i).padStart(6, '0')};Кириллица ${i};\n`).join('');
    await fs.writeFile(path.join(root, 'projects/8406/source.csv'), data);
    expect(Buffer.byteLength(data)).toBeGreaterThan(100 * 1024);
    const result = await call(create());
    expect(result).toMatchObject({ verified: true, total_records: 7000 });
    const page = await call({ action: 'read', ...source, offset: 6999, sha256: hash(data) });
    expect(page.records[0][0]).toBe('006999');
  });
  it.each([undefined, {}, { agentId: 1, spaceId: 7819 }, { agentId: 241656, spaceId: 11 }])('rejects missing/wrong runtime scope %j', async context => {
    await expect(csvToolHandlers.project_csv({ action: 'read', ...source }, 15, context)).rejects.toThrow('CSV_ACCESS_DENIED');
    expect(db.dbGet).not.toHaveBeenCalled();
  });
  it('requires live agent tool grant and project ownership', async () => {
    grant.data.tools = [];
    await expect(call({ action: 'read', ...source })).rejects.toThrow('CSV_ACCESS_DENIED');
    grant.data.tools = ['project_csv']; project.space_id = 11;
    await expect(call({ action: 'read', ...source })).rejects.toThrow('CSV_ACCESS_DENIED');
  });
  it.each(['/etc/passwd', '/uploads/projects/8407/source.csv', '/uploads/projects/8406/../source.csv', '/uploads/projects/8406/%2e%2e.csv', 'https://app.godcrm.ai/uploads/projects/8406/source.csv'])('rejects paths outside scope %s', async badUrl => {
    await expect(call({ action: 'read', ...source, url: badUrl })).rejects.toThrow();
  });
  it('requires matching file metadata, rejects cross-space and unregistered files', async () => {
    files.get(url).space_id = 11;
    await expect(call({ action: 'read', ...source })).rejects.toThrow('CSV_ACCESS_DENIED');
    files.clear();
    await expect(call({ action: 'read', ...source })).rejects.toThrow('CSV_ACCESS_DENIED');
  });
  it('rejects file symlinks and project directory symlinks', async () => {
    await fs.unlink(path.join(root, 'projects/8406/source.csv'));
    await fs.writeFile(path.join(root, 'outside.csv'), data);
    await fs.symlink(path.join(root, 'outside.csv'), path.join(root, 'projects/8406/source.csv'));
    await expect(call({ action: 'read', ...source })).rejects.toThrow();
    await fs.rm(path.join(root, 'projects/8406'), { recursive: true });
    await fs.symlink(root, path.join(root, 'projects/8406'));
    await expect(call(create())).rejects.toThrow();
  });
  it('rejects changed source, malformed CSV and out-of-range mapping', async () => {
    await expect(call({ ...create(), sha256: '0'.repeat(64) })).rejects.toThrow('CSV_SOURCE_CHANGED');
    await expect(call({ ...create(), columns: [{ index: 20, name: 'Bad' }] })).rejects.toThrow('CSV_COLUMN_OUT_OF_RANGE');
    await fs.writeFile(path.join(root, 'projects/8406/source.csv'), 'a;b\n"unterminated');
    await expect(call({ action: 'read', ...source })).rejects.toThrow();
    expect(trx.run).not.toHaveBeenCalled();
  });
  it('does not overwrite versions, including concurrent creators', async () => {
    const results = await Promise.allSettled([call(create()), call(create())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(trx.run).toHaveBeenCalledOnce();
    expect((await call({ ...create(), version: 2 })).name).toBe('altegio_common_v002.csv');
  });
  it('detects target tampering, even with a correct new target digest', async () => {
    const result = await call(create());
    const tampered = 'Наименование;Код\nПодмена;00123\nКольцо;00000\n';
    await fs.writeFile(path.join(root, 'projects/8406/altegio_common_v001.csv'), tampered);
    await expect(call({ action: 'verify', ...source, sha256: hash(data), columns, formula_policy: 'reject', target_url: result.url, target_sha256: hash(tampered) })).rejects.toThrow('CSV_VERIFY_MISMATCH');
  });
  it('fails closed on formulas or escapes only by explicit policy', async () => {
    data = 'Код;Название;Пусто\n001;=1+1;\n';
    await fs.writeFile(path.join(root, 'projects/8406/source.csv'), data);
    await expect(call(create())).rejects.toThrow('CSV_FORMULA_REQUIRES_POLICY');
    const result = await call({ ...create(), formula_policy: 'apostrophe' });
    expect(result.escaped_cells).toBe(1);
    expect(await fs.readFile(path.join(root, 'projects/8406/altegio_common_v001.csv'), 'utf8')).toContain("'=1+1");
  });
  it('fails without silent truncation on invalid UTF-8 or oversized files', async () => {
    await fs.writeFile(path.join(root, 'projects/8406/source.csv'), Buffer.from([0xff, 0xff]));
    await expect(call({ action: 'read', ...source })).rejects.toThrow();
    await fs.truncate(path.join(root, 'projects/8406/source.csv'), 20 * 1024 * 1024 + 1);
    await expect(call({ action: 'read', ...source })).rejects.toThrow('CSV_SIZE_LIMIT');
  });
  it('leaves no registered success on failed DB publication', async () => {
    db.withTransactionAsync.mockRejectedValue(new Error('DB unavailable'));
    await expect(call(create())).rejects.toThrow('DB unavailable');
    expect(files.size).toBe(1);
  });
  it('rejects amplified output before creating a file or registry entry', async () => {
    data = 'id;name\n001;' + 'a'.repeat(120000) + '\n';
    await fs.writeFile(path.join(root, 'projects/8406/source.csv'), data);
    await expect(call({ ...create(), columns: Array.from({ length: 200 }, (_, index) => ({ index: 1, name: `Copy ${index}` })) })).rejects.toThrow('CSV_SIZE_LIMIT');
    expect(await fs.readdir(path.join(root, 'projects/8406'))).toEqual(['source.csv']);
    expect(trx.run).not.toHaveBeenCalled();
  });
  it('requires a pinned digest for continuation and detects changes between pages', async () => {
    await expect(call({ action: 'read', ...source, offset: 1 })).rejects.toThrow('CSV_DIGEST_REQUIRED');
    const first = await call({ action: 'read', ...source, limit: 1 });
    await fs.appendFile(path.join(root, 'projects/8406/source.csv'), '2;Extra;\n');
    await expect(call({ action: 'read', ...source, offset: 1, sha256: first.sha256 })).rejects.toThrow('CSV_SOURCE_CHANGED');
  });
  it('rejects incorrect registry readback', async () => {
    trx.get.mockImplementation(async (_sql, p) => ({ ...[...files.values()].find(f => f.id === p[0]), visibility: 'public' }));
    await expect(call(create())).rejects.toThrow('CSV_REGISTRY_VERIFY_FAILED');
  });
  it.each(['windows-1251', 'utf-16le'])('supports explicit %s without lossy decoding', async encoding => {
    const bytes = encoding === 'windows-1251' ? Buffer.concat([Buffer.from('id;name\n001;'), Buffer.from('c1f3f1fb', 'hex'), Buffer.from('\n')]) : Buffer.from('\uFEFFid;name\n001;Бусы\n', 'utf16le');
    await fs.writeFile(path.join(root, 'projects/8406/source.csv'), bytes);
    const result = await call({ action: 'read', ...source, encoding });
    expect(result.records).toEqual([['001', 'Бусы']]);
  });
  it('returns bounded whole-record pages whose offsets cover the complete source', async () => {
    data = 'id;name\n' + Array.from({ length: 90 }, (_, i) => `${i};${'я'.repeat(1000)}\n`).join('');
    await fs.writeFile(path.join(root, 'projects/8406/source.csv'), data);
    const rows = []; let offset = 0;
    do {
      const page = await call({ action: 'read', ...source, offset, sha256: hash(data), limit: 1000 });
      expect(Buffer.byteLength(JSON.stringify(page.records))).toBeLessThan(49 * 1024);
      rows.push(...page.records); offset = page.next_offset;
    } while (offset !== null);
    expect(rows.map(r => r[0])).toEqual(Array.from({ length: 90 }, (_, i) => String(i)));
  });
  it('is advertised in MCP, remains outside public access, and dispatches through executor', async () => {
    const { buildToolList, SKIP_TOOLS } = await import('../../mcp/buildToolList.js');
    expect(buildToolList().find(t => t.name === 'project_csv').inputSchema.required).toEqual(['action', 'url', 'delimiter']);
    expect(SKIP_TOOLS.has('read_file')).toBe(true);
    const { executeTool } = await import('../executor.js');
    const result = await executeTool('project_csv', { action: 'read', ...source }, 1, { agentId: 241656, spaceId: 7819, source: 'mcp' });
    expect(result).toMatchObject({ success: true, total_records: 2 });
    expect(await executeTool('project_csv', { action: 'read', ...source }, 1, { source: 'mcp' })).toEqual({ error: 'CSV_ACCESS_DENIED' });
  });
});
