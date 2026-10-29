import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { useVoiceNote } from '../useVoiceNote';
import { useConversationSpace } from '../../components/AIChatPanel/hooks/useConversationSpace';

// Keep the real recorder hook and binding hook. Substitute hardware and HTTP
// transport only; inspect the exact request emitted before owner confirmation.
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
class BoundaryRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['synthetic QA audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('QA-3660-VOICE: sends no audio bytes before the unbound chat owner confirms a Space', async () => {
  vi.stubGlobal('MediaRecorder', BoundaryRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  } });
  vi.mocked(apiClient.get).mockResolvedValue({ data: { id: 44, created_by: 1, type: 'chat', space_id: null } });
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { text: 'synthetic transcript' } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => {
    const binding = useConversationSpace({ conversationId: 44, partnerKey: 'group:1', userId: 1,
      createConversation: async () => 44, onCreated: vi.fn() });
    const voice = useVoiceNote({ scopeKey: 'group:1:44',
      resolveTarget: binding.resolveTarget, assertTargetActive: binding.assertActive, onSent: vi.fn() });
    return { binding, voice };
  }, { wrapper: ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><LanguageProvider>{children}</LanguageProvider></QueryClientProvider> });
  await act(() => result.current.voice.startRecording());
  act(() => result.current.voice.stopRecording());
  await waitFor(() => expect(result.current.binding.dialogOpen).toBe(true));
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(filesApi.upload).not.toHaveBeenCalled();
  console.log('QA-3660-VOICE', JSON.stringify({ dialogOpen: result.current.binding.dialogOpen,
    patchCount: vi.mocked(apiClient.patch).mock.calls.length,
    requests: vi.mocked(apiClient.post).mock.calls.map(([url, payload]) => ({ url,
      hasAudio: !!(payload as { audio?: string }).audio,
      spaceId: (payload as { space_id?: number }).space_id })) }));
  expect(apiClient.post).not.toHaveBeenCalledWith('/ai/transcribe', expect.objectContaining({ audio: expect.any(String) }));
});
