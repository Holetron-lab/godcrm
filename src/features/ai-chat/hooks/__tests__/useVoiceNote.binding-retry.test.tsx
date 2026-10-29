import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { useVoiceNote } from '../useVoiceNote';
import { useConversationSpace } from '../../components/AIChatPanel/hooks/useConversationSpace';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['local audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}
let space: number | null;
const microphone = vi.fn();
const onSent = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); space = null; Recorder.instances = [];
  vi.stubGlobal('MediaRecorder', Recorder);
  microphone.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: microphone } });
  vi.mocked(apiClient.get).mockImplementation(async () => ({ data: { id: 44, created_by: 1, type: 'chat', space_id: space } }));
  vi.mocked(apiClient.patch).mockImplementation(async () => { space = 22; return { success: true }; });
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { text: 'transcript' } });
  vi.mocked(filesApi.upload).mockResolvedValue({ id: 'voice1', name: 'voice.webm', originalName: 'voice.webm', mimeType: 'audio/webm', size: 11, url: '/uploads/voice1' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(initialId: number | null = 44) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => {
    const [id, setId] = useState(initialId);
    const binding = useConversationSpace({ conversationId: id, partnerKey: 'group:1', userId: 1,
      createConversation: async () => 44, onCreated: setId });
    const voice = useVoiceNote({ scopeKey: binding.scopeKey,
      resolveTarget: binding.resolveTarget, assertTargetActive: binding.assertActive, onSent });
    return { binding, voice, setId };
  }, { wrapper: ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><LanguageProvider>{children}</LanguageProvider></QueryClientProvider> });
}
async function stop(result: ReturnType<typeof setup>['result']) {
  await act(() => result.current.voice.startRecording());
  act(() => result.current.voice.stopRecording());
  await waitFor(() => expect(result.current.binding.dialogOpen).toBe(true));
}
it('uses the persisted Space after confirmation for transcription and file upload', async () => {
  const { result } = setup();
  await stop(result);
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(filesApi.upload).not.toHaveBeenCalled();
  await act(() => result.current.binding.save(22));
  await waitFor(() => expect(onSent).toHaveBeenCalledWith(44));
  expect(apiClient.post).toHaveBeenCalledWith('/ai/transcribe', expect.objectContaining({ space_id: 22, audio: expect.any(String) }));
  expect(filesApi.upload).toHaveBeenCalledWith([expect.any(File)], { spaceId: 22 });
  expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations/44/voice-notes', expect.objectContaining({ text: 'transcript' }));
  expect(microphone).toHaveBeenCalledOnce();
});
it('retains queued segments on cancel, then resumes once on explicit retry without recording again', async () => {
  const { result } = setup();
  await act(() => result.current.voice.startRecording());
  act(() => Recorder.instances[1].stop());
  await waitFor(() => expect(result.current.binding.dialogOpen).toBe(true));
  act(() => result.current.binding.cancel());
  await waitFor(() => expect(result.current.voice.transcriptionBlocked).toBe(true));
  act(() => result.current.voice.stopRecording());
  await waitFor(() => expect(result.current.voice.sendError).toBeTruthy());
  const file = result.current.voice.pendingFile;
  expect(file?.size).toBeGreaterThan(0);
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(result.current.binding.dialogOpen).toBe(false);
  let retry!: Promise<void>;
  act(() => { retry = result.current.voice.retry(); void result.current.voice.retry(); });
  await waitFor(() => expect(result.current.binding.dialogOpen).toBe(true));
  await act(() => result.current.binding.save(22));
  await act(() => retry);
  expect(filesApi.upload).toHaveBeenCalledExactlyOnceWith([file], { spaceId: 22 });
  expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations/44/voice-notes', expect.objectContaining({ text: 'transcript transcript' }));
  expect(apiClient.post).toHaveBeenCalledTimes(3);
  expect(microphone).toHaveBeenCalledOnce();
});
it.each(['403', '409', 'offline'])('retains audio and emits no bytes on binding %s, then retries save', async failure => {
  vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error(failure));
  const { result } = setup();
  await stop(result);
  const file = result.current.voice.pendingFile;
  await act(() => result.current.binding.save(22));
  expect(result.current.binding.error).toBe(failure);
  expect(result.current.voice.pendingFile).toBe(file);
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(filesApi.upload).not.toHaveBeenCalled();
  await act(() => result.current.binding.save(22));
  await waitFor(() => expect(onSent).toHaveBeenCalledWith(44));
  expect(microphone).toHaveBeenCalledOnce();
});
it('blocks stale transcription and retry after navigating away during selection', async () => {
  const { result } = setup();
  await stop(result);
  const file = result.current.voice.pendingFile;
  act(() => result.current.setId(45));
  await waitFor(() => expect(result.current.voice.sendError).toBeTruthy());
  await act(() => result.current.voice.retry());
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(filesApi.upload).not.toHaveBeenCalled();
  expect(result.current.voice.pendingFile).toBe(file);
});
it('continues the same recording when a draft gets its persisted conversation id', async () => {
  space = 22;
  const { result } = setup(null);
  await act(() => result.current.voice.startRecording());
  act(() => Recorder.instances[1].stop());
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/ai/transcribe', expect.objectContaining({ space_id: 22 })));
  expect(result.current.voice.isRecording).toBe(true);
  act(() => result.current.voice.stopRecording());
  await waitFor(() => expect(onSent).toHaveBeenCalledWith(44));
  expect(microphone).toHaveBeenCalledOnce();
});
it('retains earlier text and retries only the blocked segment after a metadata outage', async () => {
  space = 22;
  const { result } = setup();
  await act(() => result.current.voice.startRecording());
  act(() => Recorder.instances[1].stop());
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());
  // Wait for the first response before denying the next segment's Space lookup.
  await act(async () => {});
  vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline'));
  act(() => result.current.voice.stopRecording());
  await waitFor(() => expect(result.current.voice.sendError).toBeTruthy());
  expect(filesApi.upload).not.toHaveBeenCalled();
  expect(result.current.voice.pendingFile?.size).toBeGreaterThan(0);
  await act(() => result.current.voice.retry());
  expect(apiClient.post).toHaveBeenCalledTimes(3);
  expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations/44/voice-notes', expect.objectContaining({ text: 'transcript transcript' }));
  expect(microphone).toHaveBeenCalledOnce();
});
it('ignores a late transcription response after navigating to another chat', async () => {
  space = 22;
  let finish!: () => void;
  vi.mocked(apiClient.post).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ success: true, data: { text: 'old transcript' } }); }));
  const { result } = setup();
  await act(() => result.current.voice.startRecording());
  act(() => result.current.voice.stopRecording());
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());
  act(() => result.current.setId(45));
  await act(async () => finish());
  await act(() => result.current.voice.retry());
  expect(filesApi.upload).not.toHaveBeenCalled();
  expect(apiClient.post).toHaveBeenCalledOnce();
  expect(onSent).not.toHaveBeenCalled();
  expect(result.current.voice.pendingFile?.size).toBeGreaterThan(0);
});
