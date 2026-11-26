// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const readFileById = vi.fn();

vi.mock('../../../../database/connection.js', () => ({
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  safeJsonParse: (value, fallback) => {
    if (value == null) return fallback;
    return typeof value === 'string' ? JSON.parse(value) : value;
  },
}));

vi.mock('../../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../fileStorage.js', () => ({
  readFileById: (...args) => readFileById(...args),
  savePrivateFile: vi.fn(),
}));

const { DocumentConversionService } = await import('../DocumentConversionService.js');

const sourceFile = { id: 'file_source', url: '/uploads/spaces/11/file_source.pdf', mime_type: 'application/pdf' };

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset().mockResolvedValue({ changes: 1 });
  readFileById.mockReset().mockResolvedValue({ file: sourceFile, bytes: Buffer.from('%PDF-1.7') });
});

describe('DocumentConversionService processing', () => {
  it('persists direct UTF-8 text without Docling', async () => {
    const docling = { submit: vi.fn(), poll: vi.fn(), result: vi.fn() };
    const service = new DocumentConversionService({ doclingClient: docling });
    dbGet.mockResolvedValue({ id: 'job-1', status: 'queued', source_format: 'txt', source_name: 'a.txt' });
    readFileById.mockResolvedValue({ file: { ...sourceFile, mime_type: 'text/plain' }, bytes: Buffer.from('# Text') });

    await service.processJob('job-1');

    expect(docling.submit).not.toHaveBeenCalled();
    expect(dbRun.mock.calls.at(-1)[0]).toContain("status = 'converted'");
    expect(dbRun.mock.calls.at(-1)[1][0]).toBe('# Text');
  });

  it('resumes a persisted Docling task and fetches its result once', async () => {
    const docling = {
      submit: vi.fn(),
      poll: vi.fn().mockResolvedValue({ task_id: 'task-1', task_status: 'success' }),
      result: vi.fn().mockResolvedValue({ status: 'success', document: { md_content: '# Converted' }, errors: [] }),
    };
    const service = new DocumentConversionService({ doclingClient: docling });
    const job = {
      id: 'job-1', status: 'processing', docling_task_id: 'task-1', source_format: 'pdf', source_name: 'a.pdf',
      created_at: new Date().toISOString(), space_id: 11, project_id: 7, requested_by: 42,
    };
    dbGet.mockResolvedValueOnce(job).mockResolvedValue({ ...job, status: 'converted' });

    await service.processJob('job-1');
    await service.processJob('job-1');

    expect(docling.submit).not.toHaveBeenCalled();
    expect(docling.result).toHaveBeenCalledTimes(1);
    expect(dbRun.mock.calls.at(-1)[1][0]).toBe('# Converted');
  });

  it('fails closed on malformed successful output', async () => {
    const docling = {
      submit: vi.fn(),
      poll: vi.fn().mockResolvedValue({ task_id: 'task-1', task_status: 'success' }),
      result: vi.fn().mockResolvedValue({ status: 'success', document: { md_content: '' }, errors: [] }),
    };
    const service = new DocumentConversionService({ doclingClient: docling });
    dbGet.mockResolvedValue({
      id: 'job-1', status: 'processing', docling_task_id: 'task-1', source_format: 'pdf', source_name: 'a.pdf',
      created_at: new Date().toISOString(), space_id: 11, project_id: 7, requested_by: 42,
    });

    await service.processJob('job-1');

    expect(dbRun.mock.calls.at(-1)[1][0]).toBe('DOCLING_RESULT_INVALID');
    expect(dbRun.mock.calls.at(-1)[0]).toContain("status = 'failed'");
  });
});
