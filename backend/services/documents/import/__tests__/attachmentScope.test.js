// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGet = vi.fn();
const readLocalFile = vi.fn();
const getEffectiveRole = vi.fn();

vi.mock('../../../../database/connection.js', () => ({ dbGet: (...args) => dbGet(...args) }));
vi.mock('../fileStorage.js', () => ({ readLocalFile: (...args) => readLocalFile(...args) }));
vi.mock('../../../EffectiveRoleService.js', () => ({
  getEffectiveRole: (...args) => getEffectiveRole(...args),
  ACCESS_LEVEL_VALUES: { viewer: 1, editor: 2, admin: 3 },
}));

const { readConversationAttachment, resolveDocumentImportScope, requireDocumentEditor } = await import('../attachmentScope.js');

beforeEach(() => {
  dbGet.mockReset();
  readLocalFile.mockReset();
  getEffectiveRole.mockReset();
});

describe('document attachment scope', () => {
  it('rejects another space before reading the file', async () => {
    dbGet.mockResolvedValue({ id: 'file-1', url: '/uploads/spaces/12/file.pdf', space_id: 12, storage_provider_id: 'local' });
    await expect(readConversationAttachment('/uploads/spaces/12/file.pdf', { spaceId: 11, conversationId: 3891 })).rejects.toThrow('DOCUMENT_ATTACHMENT_ACCESS_DENIED');
    expect(readLocalFile).not.toHaveBeenCalled();
  });

  it('requires a non-deleted attachment in the current conversation', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 'file-1', url: '/uploads/spaces/11/file.pdf', space_id: 11, storage_provider_id: 'local' })
      .mockResolvedValueOnce(null);
    await expect(readConversationAttachment('/uploads/spaces/11/file.pdf', { spaceId: 11, conversationId: 3891 })).rejects.toThrow('DOCUMENT_ATTACHMENT_NOT_IN_CONVERSATION');
    expect(readLocalFile).not.toHaveBeenCalled();
  });

  it('uses the live MCP job and its initiating human', async () => {
    dbGet
      .mockResolvedValueOnce({ conversation_id: 3891, trigger_user_id: 20, created_by: 1, space_id: 11 })
      .mockResolvedValueOnce({ id: 20, role: 'agent' })
      .mockResolvedValueOnce({ id: 1, role: 'owner' });
    await expect(resolveDocumentImportScope({ source: 'mcp', jobId: 10, agentId: 20, spaceId: 11 })).resolves.toEqual({ conversationId: 3891, spaceId: 11, userId: 1 });
  });

  it('denies viewers and allows editors', async () => {
    getEffectiveRole.mockResolvedValueOnce({ effectiveRole: 'viewer' }).mockResolvedValueOnce({ effectiveRole: 'editor' });
    await expect(requireDocumentEditor(42, 7)).rejects.toThrow('DOCUMENT_EDITOR_REQUIRED');
    await expect(requireDocumentEditor(42, 7)).resolves.toBeUndefined();
  });
});
