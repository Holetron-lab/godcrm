import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { useVoiceNote } from '../useVoiceNote';
import { useConversationSpace } from '../../components/AIChatPanel/hooks/useConversationSpace';
const capture = vi.hoisted(() => ({ onRecorded: undefined as ((file: File) => void) | undefined, start: vi.fn() }));
vi.mock('../useVoiceMessage', () => ({ useVoiceMessage: (options: { onRecorded: (file: File) => void }) => {
  capture.onRecorded = options.onRecorded;
  return { retryTranscription: async () => true, isRecording: false, isProcessing: false, startRecording: capture.start, cancelRecording: vi.fn() };
} }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
const file = new File(['voice'], 'note.webm', { type: 'audio/webm' });
const uploaded = { id: 'voice1', name: file.name, originalName: file.name, mimeType: file.type, size: file.size, url: '/uploads/voice1' };
let space: number | null;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); space = null;
  vi.mocked(apiClient.get).mockImplementation(async () => ({ data: { id: 44, created_by: 1, type: 'chat', space_id: space } }));
  vi.mocked(apiClient.patch).mockImplementation(async () => { space = 11; return { success: true }; });
  vi.mocked(apiClient.post).mockResolvedValue({ success: true });
  vi.mocked(filesApi.upload).mockResolvedValue(uploaded);
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(({ id }) => {
    const binding = useConversationSpace({ conversationId: id, partnerKey: 'group:1', userId: 1, createConversation: async () => 44, onCreated: vi.fn() });
    const voice = useVoiceNote({ scopeKey: String(id), resolveTarget: async () => ({ conversationId: await binding.ensureConversation(), spaceId: await binding.ensureSpace() }), assertTargetActive: binding.assertActive, onSent: vi.fn() });
    return { binding, voice };
  }, { initialProps: { id: 44 }, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><LanguageProvider>{children}</LanguageProvider></QueryClientProvider> });
}
it('preserves cancelled voice bytes and resumes only on explicit retry', async () => {
  const { result } = setup();
  await act(() => result.current.voice.startRecording());
  act(() => capture.onRecorded?.(file));
  await waitFor(() => expect(result.current.binding.dialogOpen).toBe(true));
  act(() => result.current.binding.cancel());
  await waitFor(() => expect(result.current.voice.sendError).toBeTruthy());
  expect(result.current.voice.pendingFile).toBe(file);
  expect(filesApi.upload).not.toHaveBeenCalled();
  let retry!: Promise<void>;
  act(() => { retry = result.current.voice.retry(); });
  await waitFor(() => expect(result.current.binding.dialogOpen).toBe(true));
  await act(() => result.current.binding.save(11));
  await act(() => retry);
  expect(filesApi.upload).toHaveBeenCalledExactlyOnceWith([file], { spaceId: 11 });
  expect(apiClient.post).toHaveBeenCalledOnce();
  expect(capture.start).toHaveBeenCalledOnce();
});
it('retains voice and suppresses send when switching during upload', async () => {
  space = 11;
  let finish!: () => void;
  vi.mocked(filesApi.upload).mockImplementation(() => new Promise(resolve => { finish = () => resolve(uploaded); }));
  const { result, rerender } = setup();
  await act(() => result.current.voice.startRecording());
  act(() => capture.onRecorded?.(file));
  await waitFor(() => expect(filesApi.upload).toHaveBeenCalledOnce());
  rerender({ id: 45 });
  await act(async () => finish());
  await waitFor(() => expect(result.current.voice.sendError).toBeTruthy());
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(result.current.voice.pendingFile).toBe(file);
});
it('resolves a changed Space for a new upload attempt after upload failure', async () => {
  space = 11;
  vi.mocked(filesApi.upload).mockRejectedValueOnce(new Error('offline'));
  const { result } = setup();
  await act(() => result.current.voice.startRecording());
  act(() => capture.onRecorded?.(file));
  await waitFor(() => expect(result.current.voice.sendError).toBeTruthy());
  space = 12;
  await act(() => result.current.voice.retry());
  expect(filesApi.upload).toHaveBeenLastCalledWith([file], { spaceId: 12 });
});
