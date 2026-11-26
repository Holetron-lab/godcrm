// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../database/connection.js', () => ({
  dbGet: vi.fn(),
  safeJsonParse: (value, fallback) => {
    if (value == null) return fallback;
    return typeof value === 'string' ? JSON.parse(value) : value;
  },
  withTransactionAsync: vi.fn(),
}));

vi.mock('../../resolveBinding.js', () => ({
  resolveBinding: vi.fn().mockResolvedValue({ project_id: 7, registry_table_id: 2197, titleCol: 'name' }),
}));

const { finalizeDocumentImport } = await import('../finalizeDocumentImport.js');

describe('idempotent document import finalization', () => {
  it('locks the job, finalizes once and returns stored ids on repeat', async () => {
    let storedResponse = null;
    const trx = {
      get: vi.fn((sql) => {
        expect(sql).toContain('FOR UPDATE');
        if (storedResponse) return { id: 'job-1', status: 'completed', result_metadata: { finalization: storedResponse } };
        return {
          id: 'job-1', widget_id: 218, requested_by: 42, source_name: 'a.pdf', status: 'converted',
          language: 'auto', result_markdown: '# Заголовок\n\nТекст', import_request: { status: 'draft' },
          result_metadata: { title: 'Русский документ', source: { url: '/uploads/spaces/11/source.pdf' }, assets: [], warnings: [] },
        };
      }),
      run: vi.fn((sql, params) => {
        if (sql.includes("status = 'completed'")) storedResponse = JSON.parse(params[1]).finalization;
        return { changes: 1 };
      }),
    };
    const transaction = vi.fn((callback) => callback(trx));
    const createDocument = vi.fn().mockResolvedValue({ document_id: 123, registry_table_id: 2197, table_id: 456, atom_count: 2, slug: 'doc' });
    const writeSnapshot = vi.fn();
    const job = { id: 'job-1', widget_id: 218 };

    const first = await finalizeDocumentImport(job, { transaction, createDocument, writeSnapshot });
    const second = await finalizeDocumentImport(job, { transaction, createDocument, writeSnapshot });

    expect(first).toMatchObject({ document_id: 123, registry_table_id: 2197, table_id: 456, status: 'completed' });
    expect(second).toEqual(first);
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument.mock.calls[0][0].language).toBe('ru');
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveProperty('markdown');
  });
});
