import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { useVoiceNote } from '../useVoiceNote';

const capture = vi.hoisted(() => ({
  options: {} as { onResult?: (text: string) => void; onRecorded?: (file: File) => void },
  isRecording: false, isProcessing: false,
  startRecording: vi.fn(), cancelRecording: vi.fn(),
}));
vi.mock('../useVoiceMessage', () => ({ useVoiceMessage: (options: typeof capture.options) => {
  capture.options = options;
  return { ...capture, retryTranscription: async () => true, error: null, duration: 1, recordingStream: null, stopRecording: vi.fn() };
} }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
const file = Object.assign(new File(['audio'], 'voice.webm', { type: 'audio/webm' }), { duration: 3 });
const target = vi.fn();
const onSent = vi.fn();
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><LanguageProvider>{children}</LanguageProvider></QueryClientProvider>;
  return renderHook(({ scopeKey }) => useVoiceNote({ scopeKey, resolveTarget: target, onSent }), { wrapper, initialProps: { scopeKey: 'chat:1' } });
}
beforeEach(() => {
  vi.clearAllMocks();
  capture.isRecording = false; capture.isProcessing = false;
  target.mockResolvedValue({ conversationId: 1, spaceId: 11 });
  vi.mocked(filesApi.upload).mockResolvedValue({ id: 'audio-1', name: file.name, originalName: file.name, mimeType: file.type, size: file.size, url: '/uploads/audio-1' });
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { id: 123 } });
});
describe('system voice notes', () => {
  it('waits for the final transcription segment before sending the audio', async () => {
    const { result, rerender } = setup();
    await act(() => result.current.startRecording());
    capture.isProcessing = true;
    act(() => { capture.options.onResult?.('First'); capture.options.onRecorded?.(file); });
    rerender({ scopeKey: 'chat:1' });
    expect(filesApi.upload).not.toHaveBeenCalled();
    act(() => capture.options.onResult?.('Last'));
    capture.isProcessing = false;
    rerender({ scopeKey: 'chat:1' });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());
    expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations/1/voice-notes', { client_id: expect.any(String), file_id: 'audio-1', text: 'First Last', duration: 3 });
    expect(onSent).toHaveBeenCalledWith(1);
  });
  it('reuses the uploaded file and idempotency key after an ambiguous failure', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Network error'));
    const { result } = setup();
    await act(() => result.current.startRecording());
    act(() => capture.options.onRecorded?.(file));
    await waitFor(() => expect(result.current.sendError).toBeTruthy());
    const first = vi.mocked(apiClient.post).mock.calls[0];
    await act(() => Promise.all([result.current.retry(), result.current.retry()]));
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiClient.post).mock.calls[1]).toEqual(first);
    expect(filesApi.upload).toHaveBeenCalledOnce();
    expect(result.current.pendingFile).toBeNull();
  });
  it('retains the recording if upload fails and blocks overwriting it', async () => {
    vi.mocked(filesApi.upload).mockRejectedValueOnce(new Error('Upload unavailable'));
    const { result } = setup();
    await act(() => result.current.startRecording());
    act(() => capture.options.onRecorded?.(file));
    await waitFor(() => expect(result.current.sendError).toBeTruthy());
    await act(() => result.current.startRecording());
    expect(capture.startRecording).toHaveBeenCalledOnce();
    expect(result.current.pendingFile).toBe(file);
    expect(apiClient.post).not.toHaveBeenCalled();
    await act(() => result.current.retry());
    expect(apiClient.post).toHaveBeenCalledOnce();
  });
  it('does not automatically send an unfinished transcript after switching chats', async () => {
    const { result, rerender } = setup();
    await act(() => result.current.startRecording());
    capture.isProcessing = true;
    act(() => capture.options.onRecorded?.(file));
    capture.isProcessing = false;
    rerender({ scopeKey: 'chat:2' });
    await waitFor(() => expect(result.current.sendError).toBeTruthy());
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(result.current.pendingFile).toBe(file);
    await act(() => result.current.retry());
    expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations/1/voice-notes', expect.any(Object));
    expect(onSent).not.toHaveBeenCalled();
  });
  it('can send audio without a transcript and discard a failed note explicitly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ success: false, error: { message: 'Read only' } });
    const { result } = setup();
    await act(() => result.current.startRecording());
    act(() => capture.options.onRecorded?.(file));
    await waitFor(() => expect(result.current.sendError).toBeTruthy());
    expect(apiClient.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ text: '' }));
    act(() => result.current.discard());
    expect(result.current.pendingFile).toBeNull();
    expect(result.current.sendError).toBeNull();
  });
});
