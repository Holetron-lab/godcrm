import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { useCallStore } from '../callStore';
const sdk = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('livekit-client', () => ({
  AudioPresets: { speech: {} },
  RoomEvent: { Disconnected: 'disconnected' },
  Room: class {
    localParticipant = { identity: 'me', isMicrophoneEnabled: true, setMicrophoneEnabled: vi.fn() };
    remoteParticipants = new Map();
    handlers = new Map<string, () => void>();
    on(event: string, fn: () => void) { this.handlers.set(event, fn); }
    connect = sdk.connect;
    async disconnect() { sdk.disconnect(); this.handlers.get('disconnected')?.(); }
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  useCallStore.setState({ state: 'idle' });
  vi.mocked(apiClient.post).mockResolvedValue({ data: { token: 'test', url: 'wss://example.test', room: 'conv-7' } });
});
afterEach(async () => { await useCallStore.getState().endCall(); });
it('retries after a failed connection and preserves the conversation for retry', async () => {
  sdk.connect.mockRejectedValueOnce(new Error('websocket connection failed')).mockResolvedValueOnce(undefined);
  await useCallStore.getState().startCall(7, { withRecording: false });
  expect(useCallStore.getState()).toMatchObject({ state: 'error', conversationId: 7 });
  await useCallStore.getState().startCall(7, { withRecording: false });
  expect(sdk.connect).toHaveBeenCalledTimes(2);
  expect(useCallStore.getState().state).toBe('connected');
});
it('disconnects once when ending a connected call', async () => {
  await useCallStore.getState().startCall(7, { withRecording: false });
  await useCallStore.getState().endCall();
  expect(sdk.disconnect).toHaveBeenCalledTimes(1);
  expect(useCallStore.getState().state).toBe('idle');
});
