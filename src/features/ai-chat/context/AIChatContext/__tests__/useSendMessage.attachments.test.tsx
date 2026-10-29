import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { useSendMessage } from '../useSendMessage';
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: '1' } }) } }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const file = new File(['draft'], 'draft.txt');
it.each(['offline', 'missing-url', 'unbound'])('fallback fails closed for %s, before optimistic message or send', async mode => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { space_id: mode === 'unbound' ? null : 12 } });
  if (mode === 'offline') vi.mocked(filesApi.upload).mockRejectedValue(new Error('offline'));
  else vi.mocked(filesApi.upload).mockResolvedValue({ id: 'file1', name: file.name, originalName: file.name, mimeType: '', size: file.size, url: '' });
  const options: Parameters<typeof useSendMessage>[0] = {
    currentAgent: { id: 7, name: 'Agent', description: '', model: '', system_prompt: '', provider: '', is_active: true },
    spaceId: 99, messages: [], agentMode: false, labId: null,
    setMessages: vi.fn(), setIsLoading: vi.fn(), setIsStreaming: vi.fn(), setError: vi.fn(),
    setIsAgentProcessing: vi.fn(), setCurrentConversationId: vi.fn(), currentConversationIdRef: { current: 44 }, loadConversations: vi.fn(),
  };
  const { result } = renderHook(() => useSendMessage(options), { wrapper: LanguageProvider });
  await act(async () => { await expect(result.current('draft', [file])).rejects.toThrow(); });
  expect(options.setMessages).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
  if (mode !== 'unbound') expect(filesApi.upload).toHaveBeenCalledWith([file], { spaceId: 12 });
});
