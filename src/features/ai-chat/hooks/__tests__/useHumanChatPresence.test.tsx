import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { useHumanChatPresence } from '../useHumanChatPresence';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const base = new Date('2026-09-24T10:00:00Z');
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(base); vi.resetAllMocks();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.mocked(apiClient.post).mockResolvedValue({ success: true });
  vi.mocked(apiClient.get).mockImplementation(async () => ({ success: true, data: { server_time: new Date().toISOString(), users: [{ user_id: 2, last_activity_at: base.toISOString() }] } }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(1); });

it('expires after exactly 1 minute; polling never refreshes user activity', async () => {
  const { result, unmount } = renderHook(() => useHumanChatPresence(11, true), { wrapper: ProvidersWrapper });
  await flush();
  expect(result.current.onlineUserIds.has(2)).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(59_998); });
  expect(result.current.onlineUserIds.has(2)).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2); });
  expect(result.current.onlineUserIds.has(2)).toBe(false);
  expect(vi.mocked(apiClient.post).mock.calls.filter(([, body]) => (body as { data: { active: boolean } }).data.active)).toHaveLength(1);
  expect(apiClient.post).toHaveBeenLastCalledWith('/chat/conversations/11/presence', { data: { client_id: expect.any(String), active: false, idle_ms: 60_000 } }, { keepalive: true });
  unmount();
});

it('only activity inside this chat renews presence and is throttled', async () => {
  const { unmount } = renderHook(() => useHumanChatPresence(11, true), { wrapper: ProvidersWrapper });
  await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  act(() => document.body.dispatchEvent(new Event('pointermove', { bubbles: true })));
  await flush();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  const chat = document.createElement('div'); chat.dataset.chatPresence = '11'; document.body.append(chat);
  act(() => { for (let i = 0; i < 50; i++) chat.dispatchEvent(new Event('pointermove', { bubbles: true })); });
  await flush();
  expect(apiClient.post).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(apiClient.post).toHaveBeenCalledTimes(3);
  unmount();
});

it('clears on hidden tab and conversation switch and never reuses another chat snapshot', async () => {
  const { result, rerender, unmount } = renderHook(({ id }) => useHumanChatPresence(id, true), { wrapper: ProvidersWrapper, initialProps: { id: 11 } });
  await flush();
  act(() => { vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await flush();
  expect(vi.mocked(apiClient.post).mock.calls.at(-1)?.[1]).toMatchObject({ data: { active: false } });
  vi.mocked(apiClient.get).mockReturnValue(new Promise(() => {}));
  rerender({ id: 12 });
  expect(result.current.conversationId).toBe(12);
  expect(result.current.known).toBe(false);
  expect(result.current.onlineUserIds.size).toBe(0);
  await flush();
  expect(vi.mocked(apiClient.post).mock.calls.at(-1)?.[0]).toBe('/chat/conversations/11/presence');
  unmount();
});

it('reports unknown on failure and expires a stalled snapshot despite server clock skew', async () => {
  vi.mocked(apiClient.get).mockResolvedValueOnce({ success: true, data: { server_time: '2026-09-25T10:00:00Z', users: [{ user_id: 2, last_activity_at: '2026-09-25T09:59:05Z' }] } }).mockReturnValue(new Promise(() => {}));
  const { result, unmount } = renderHook(() => useHumanChatPresence(11, true), { wrapper: ProvidersWrapper });
  await flush();
  expect(result.current.onlineUserIds.has(2)).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(result.current.onlineUserIds.has(2)).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(result.current.known).toBe(false);
  unmount();
});
