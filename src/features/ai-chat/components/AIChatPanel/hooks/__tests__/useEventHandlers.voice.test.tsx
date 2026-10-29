import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useEventHandlers } from '../useEventHandlers';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
const file = new File(['voice'], 'voice.webm', { type: 'audio/webm' });
function params() {
  return {
    inputValue: 'edited transcript', attachments: [file], mentionedUsers: [], messageBoundRows: [], boundRows: [],
    chatPartner: { type: 'group', id: 44, name: 'Chat' }, currentAgent: null,
    userConversationId: 44, currentConversationId: null, effectiveSpaceId: 99, currentSpaceId: 99,
    agentMode: 'ask', thinkingEnabled: false, availableSlashAgents: [], availableMentionUsers: [],
    setInputValue: vi.fn(), setAttachments: vi.fn(), setMentionedUsers: vi.fn(), setMessageBoundRows: vi.fn(),
    setLocalError: vi.fn(), setDragOver: vi.fn(), setUserConversationId: vi.fn(),
    sendUserMessageMutation: { mutateAsync: vi.fn().mockResolvedValue({ id: 1 }) },
    sendMessage: vi.fn(), selectAgent: vi.fn(), setChatMode: vi.fn(), setChatPartner: vi.fn(),
    setChatParticipants: vi.fn(), setBoundRows: vi.fn(), setShowBoundRowsBar: vi.fn(), setActivePanel: vi.fn(),
    setVectorSearchResults: vi.fn(),
  } satisfies Parameters<typeof useEventHandlers>[0];
}
beforeEach(() => {
  localStorage.setItem('god-crm-language', 'ru');
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue({ data: { space_id: 11 } });
  vi.mocked(filesApi.upload).mockResolvedValue({ id: 'file1', name: 'voice.webm', originalName: 'voice.webm', mimeType: 'audio/webm', size: 5, url: '/uploads/voice.webm' });
});
it('does not send or clear the draft when uploading fails', async () => {
  vi.mocked(filesApi.upload).mockRejectedValueOnce(new Error('Upload failed'));
  const p = params(); const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  expect(p.sendUserMessageMutation.mutateAsync).not.toHaveBeenCalled();
  expect(p.setAttachments).not.toHaveBeenCalled(); expect(p.setInputValue).not.toHaveBeenCalled();
  expect(p.setLocalError).toHaveBeenLastCalledWith('Upload failed');
});
it('uploads to the conversation space and reuses the upload after a failed send', async () => {
  const p = params(); p.sendUserMessageMutation.mutateAsync.mockRejectedValueOnce(new Error('Send failed'));
  const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  expect(p.setAttachments).not.toHaveBeenCalled();
  await act(() => result.current.handleSubmit());
  expect(filesApi.upload).toHaveBeenCalledTimes(1);
  expect(filesApi.upload).toHaveBeenCalledWith([file], { spaceId: 11 });
  expect(p.sendUserMessageMutation.mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'edited transcript', attachments: [expect.objectContaining({ url: '/uploads/voice.webm' })] }));
  expect(p.setAttachments).toHaveBeenCalledOnce();
});
it('blocks keyboard submission during recording or final transcription', async () => {
  const p = { ...params(), voiceBusy: true }; const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  expect(filesApi.upload).not.toHaveBeenCalled(); expect(p.sendUserMessageMutation.mutateAsync).not.toHaveBeenCalled();
});
it('allows sending only audio without transcript', async () => {
  const p = { ...params(), inputValue: '' }; const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  expect(p.sendUserMessageMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ content: '', attachments: [expect.objectContaining({ type: 'audio/webm' })] }));
});

it('preserves forwarded audio and the forward queue on failure, then clears only sent entries', async () => {
  const audio = { id: 'original', name: 'original.webm', type: 'audio/webm', size: 5, url: '/uploads/original.webm' };
  const original = { id: '12', role: 'user' as const, content: '', timestamp: new Date(), attachments: [audio] };
  const setForwardMessages = vi.fn();
  const p = { ...params(), inputValue: 'comment', attachments: [], forwardMessages: [original], setForwardMessages };
  p.sendUserMessageMutation.mutateAsync.mockRejectedValueOnce(new Error('Send failed'));
  const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  expect(setForwardMessages).not.toHaveBeenCalled();
  await act(() => result.current.handleSubmit());
  expect(p.sendUserMessageMutation.mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ attachments: [audio], content: expect.stringContaining('comment') }));
  expect(filesApi.upload).not.toHaveBeenCalled();
  const clear = setForwardMessages.mock.calls[0][0];
  const later = { ...original, id: '13' };
  expect(clear([original, later])).toEqual([later]);
});

it.each([true, false])('forwards audio through the agent send path (optimistic: %s)', async optimistic => {
  const audio = { id: 'original', name: 'original.webm', type: 'audio/webm', size: 5, url: '/uploads/original.webm' };
  const aiSendMessage = vi.fn().mockResolvedValue(undefined);
  const p = {
    ...params(), inputValue: '', attachments: [],
    chatPartner: { type: 'agent', id: 7, name: 'Agent' }, currentConversationId: 44,
    currentAgent: { id: 7, name: 'Agent', description: '', model: '', system_prompt: '', provider: '', is_active: true },
    forwardMessages: [{ id: '12', role: 'user' as const, content: '', timestamp: new Date(), attachments: [audio] }],
    aiSendMessage: optimistic ? aiSendMessage : undefined,
  };
  const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  if (optimistic) expect(aiSendMessage).toHaveBeenCalledWith(expect.objectContaining({ attachments: [audio] }));
  else expect(p.sendMessage.mock.calls[0][7]).toEqual([audio]);
  expect(filesApi.upload).not.toHaveBeenCalled();
});
