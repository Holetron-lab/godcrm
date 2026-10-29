import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { useVoiceMessage } from '../useVoiceMessage';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn() } }));
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = (type: string) => type === 'audio/mp4';
  state = 'inactive';
  mimeType = 'audio/mp4';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['recorded bytes'], { type: this.mimeType }) });
    this.onstop?.();
  }
}
const stopTrack = vi.fn();
beforeEach(() => {
  localStorage.setItem('god-crm-language', 'ru');
  Recorder.instances = [];
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { data: { text: 'Фраза' } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('voice message', () => {
  it.each([
    { data: { text: 'Фраза' } },
    { text: 'Фраза' },
  ])('transcribes complete segments during capture and attaches MP4 with matching extension on stop (%j)', async data => {
    vi.mocked(apiClient.post).mockResolvedValue({ success: true, data });
    const onResult = vi.fn(); const onRecorded = vi.fn();
    const { result, rerender } = renderHook(() => useVoiceMessage({ scopeKey: 'chat:11', resolveSpaceId: async () => 11, onResult, onRecorded }), { wrapper: LanguageProvider });
    await act(() => result.current.startRecording());
    rerender();
    expect(result.current.isRecording).toBe(true);
    expect(result.current.recordingStream).not.toBeNull();
    act(() => Recorder.instances[1].stop());
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('Фраза'));
    expect(result.current.isRecording).toBe(true);
    expect(onRecorded).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledWith('/ai/transcribe', expect.objectContaining({ format: 'm4a', space_id: 11 }));
    act(() => result.current.stopRecording());
    await waitFor(() => expect(result.current.isProcessing).toBe(false));
    const file = onRecorded.mock.calls[0][0] as File;
    expect((file as File & { duration: number }).duration).toBeGreaterThanOrEqual(0);
    expect(result.current.recordingStream).toBeNull();
    expect(file.type).toBe('audio/mp4'); expect(file.name).toMatch(/^voice-\d+\.m4a$/);
    expect(stopTrack).toHaveBeenCalled();
  });
  it('retains audio when transcription fails', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Whisper unavailable'));
    const onRecorded = vi.fn();
    const { result } = renderHook(() => useVoiceMessage({ scopeKey: 'chat:11', resolveSpaceId: async () => 11, onRecorded }), { wrapper: LanguageProvider });
    await act(() => result.current.startRecording());
    act(() => result.current.stopRecording());
    await waitFor(() => expect(result.current.error).toContain('Whisper unavailable'));
    expect(onRecorded).toHaveBeenCalledOnce();
  });
  it('discards late transcription and capture after changing chat', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiClient.post).mockImplementation(() => new Promise(r => { resolve = r; }));
    const onResult = vi.fn(); const onRecorded = vi.fn();
    const { result, rerender } = renderHook(({ scopeKey }) => useVoiceMessage({ scopeKey, resolveSpaceId: async () => 11, onResult, onRecorded }), { wrapper: LanguageProvider,  initialProps: { scopeKey: 'chat:1' } });
    await act(() => result.current.startRecording());
    act(() => Recorder.instances[1].stop());
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    rerender({ scopeKey: 'chat:2' });
    await act(async () => resolve({ success: true, data: { text: 'Old chat' } }));
    expect(onResult).not.toHaveBeenCalled(); expect(onRecorded).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingStream).toBeNull();
  });
});
