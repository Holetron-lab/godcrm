// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createJob = vi.fn();
const schedule = vi.fn();
const getJob = vi.fn();
const resolveDocumentImportScope = vi.fn();
const requireDocumentEditor = vi.fn();
const readConversationAttachment = vi.fn();
const assertJobScope = vi.fn();
const finalizeDocumentImport = vi.fn();

vi.mock('../instance.js', () => ({
  documentConversionService: {
    createJob: (...args) => createJob(...args),
    schedule: (...args) => schedule(...args),
    getJob: (...args) => getJob(...args),
  },
}));
vi.mock('../attachmentScope.js', () => ({
  resolveDocumentImportScope: (...args) => resolveDocumentImportScope(...args),
  requireDocumentEditor: (...args) => requireDocumentEditor(...args),
  readConversationAttachment: (...args) => readConversationAttachment(...args),
  assertJobScope: (...args) => assertJobScope(...args),
}));
vi.mock('../../resolveBinding.js', () => ({
  resolveBinding: vi.fn().mockResolvedValue({ project_id: 7, registry_table_id: 2197 }),
}));
vi.mock('../finalizeDocumentImport.js', () => ({
  finalizeDocumentImport: (...args) => finalizeDocumentImport(...args),
}));

const { importDocumentFile, checkDocumentImport } = await import('../documentImportTools.js');
const context = { conversationId: 3891, spaceId: 11, triggerMessageId: 100 };

beforeEach(() => {
  createJob.mockReset().mockResolvedValue({ id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10', status: 'queued' });
  schedule.mockReset();
  getJob.mockReset();
  resolveDocumentImportScope.mockReset().mockResolvedValue({ conversationId: 3891, spaceId: 11, userId: 1 });
  requireDocumentEditor.mockReset().mockResolvedValue(undefined);
  readConversationAttachment.mockReset().mockResolvedValue({ bytes: Buffer.from('%PDF-'), name: 'a.pdf' });
  assertJobScope.mockReset().mockResolvedValue(undefined);
  finalizeDocumentImport.mockReset().mockResolvedValue({ success: true, status: 'completed', document_id: 123, registry_table_id: 2197 });
});

describe('document import MCP handlers', () => {
  it('starts only from the resolved conversation attachment and returns no Markdown', async () => {
    const result = await importDocumentFile({ widget_id: 218, file_url: '/uploads/spaces/11/a.pdf' }, context);

    expect(result).toMatchObject({ success: true, async: true, status: 'queued' });
    expect(result).not.toHaveProperty('markdown');
    expect(readConversationAttachment).toHaveBeenCalledWith('/uploads/spaces/11/a.pdf', { conversationId: 3891, spaceId: 11, userId: 1 });
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: 1, conversationId: 3891 }));
    expect(schedule).toHaveBeenCalledWith('6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10');
  });

  it('finalizes a converted job without exposing Markdown', async () => {
    getJob.mockResolvedValue({ id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10', status: 'converted', project_id: 7, result_markdown: '# Secret' });
    const result = await checkDocumentImport({ import_id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10' }, context);

    expect(finalizeDocumentImport).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('markdown');
    expect(result.document_id).toBe(123);
  });

  it('fails closed when the runtime scope rejects the job', async () => {
    getJob.mockResolvedValue({ id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10', status: 'converted', project_id: 7 });
    assertJobScope.mockRejectedValue(new Error('DOCUMENT_IMPORT_ACCESS_DENIED'));

    await expect(checkDocumentImport({ import_id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10' }, context)).resolves.toEqual({ error: 'DOCUMENT_IMPORT_ACCESS_DENIED' });
    expect(finalizeDocumentImport).not.toHaveBeenCalled();
  });
});
