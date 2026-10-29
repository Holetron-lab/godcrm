// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';

const { access } = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('../helpers.js', () => ({ checkTableWriteAccess: access }));
import router from '../tableExcelPreviewController.js';

let user;
const app = express();
app.use((req, res, next) => { req.user = user; next(); });
app.use('/api/v3', router);
const file = readFileSync(new URL('../../../../services/__tests__/fixtures/excel/poi-values.xlsx', import.meta.url));
const preview = () => request(app).post('/api/v3/projects/11/tables/excel-preview');

beforeEach(() => {
  user = { id: 1 };
  access.mockReset().mockResolvedValue({ allowed: true });
});

describe('Excel preview HTTP contract', () => {
  it('returns sheets, then the explicitly selected sheet, without persistence', async () => {
    const list = await preview().attach('file', file, 'values.xlsx');
    expect(list.status).toBe(200);
    expect(list.body.data.sheet).toBeNull();
    expect(list.body.data.sheets).toHaveLength(2);
    const selected = await preview().field('sheetIndex', '1').attach('file', file, 'values.xlsx');
    expect(selected.status).toBe(200);
    expect(selected.body.data.sheet.rows[0][0]).toBe('Only on the second sheet');
    expect(access).toHaveBeenCalledWith(user, { projectId: 11 });
  });

  it('denies unauthenticated users, foreign projects and read-only space members before upload parsing', async () => {
    user = undefined;
    expect((await preview()).status).toBe(401);
    user = { id: 1, projectId: 22, role: 'admin' };
    expect((await preview()).status).toBe(403);
    expect(access).not.toHaveBeenCalled();
    user = { id: 1 };
    access.mockResolvedValue({ allowed: false, error: 'Denied' });
    expect((await preview()).status).toBe(403);
  });

  it('rejects missing files, invalid project ids, invalid sheet selection and extra fields', async () => {
    expect((await preview()).status).toBe(400);
    expect((await request(app).post('/api/v3/projects/no/tables/excel-preview')).status).toBe(400);
    for (const sheetIndex of ['-1', '1.1', '', 'NaN']) {
      expect((await preview().field('sheetIndex', sheetIndex).attach('file', file, 'values.xlsx')).status).toBe(400);
    }
    expect((await preview().field('path', '/etc/passwd').attach('file', file, 'values.xlsx')).status).toBe(400);
    expect((await preview().field('sheetIndex', '9').attach('file', file, 'values.xlsx')).body.error.code).toBe('SHEET_NOT_FOUND');
  });

  it('returns safe file errors and enforces upload limits', async () => {
    const bad = await preview().attach('file', Buffer.from('hello'), 'renamed.xlsx');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('FORMAT_MISMATCH');
    const large = await preview().attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'large.xlsx');
    expect(large.status).toBe(413);
    expect(large.body.error.code).toBe('FILE_LIMIT');
    expect((await preview().attach('file', file, 'a.xlsx').attach('file', file, 'b.xlsx')).status).toBe(400);
  });
});
