import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { useConversationSpace } from '../useConversationSpace';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), patch: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const metadata = (space_id: number | null, created_by = 1) => ({ id: 44, type: 'chat', space_id, created_by });
function setup(conversationId: number | null = 44) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const createConversation = vi.fn().mockResolvedValue(44);
  const onCreated = vi.fn();
  const options = { conversationId, partnerKey: 'agent:7', userId: 1, createConversation, onCreated };
  const hook = renderHook(props => useConversationSpace(props), { initialProps: options, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, options, createConversation, onCreated, client };
}
it('deduplicates requests, cancels without binding, and permits retry', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(null) });
  const { result } = setup();
  let first!: Promise<number>; let second!: Promise<number>;
  await act(async () => { first = result.current.ensureSpace(); second = result.current.ensureSpace(); });
  await waitFor(() => expect(result.current.dialogOpen).toBe(true));
  const outcomes = Promise.allSettled([first, second]);
  act(() => result.current.cancel());
  expect((await outcomes).every(value => value.status === 'rejected')).toBe(true);
  expect(apiClient.patch).not.toHaveBeenCalled();
  let retry!: Promise<number>;
  await act(async () => { retry = result.current.ensureSpace(); });
  vi.mocked(apiClient.patch).mockResolvedValue({ success: true });
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(12) });
  await act(() => result.current.save(11));
  expect(await retry).toBe(12); // authoritative reread, not requested id
  expect(apiClient.patch).toHaveBeenCalledExactlyOnceWith('/chat/conversations/44/space', { space_id: 11 });
});
it('does not infer conversation ownership from Space access', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(null, 2) });
  const { result } = setup();
  await expect(result.current.ensureSpace()).rejects.toThrow('Владелец чата должен выбрать Space');
  expect(result.current.dialogOpen).toBe(false);
});
it('reads persisted Space for each batch, including non-owner uploads', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(11, 2) });
  const { result } = setup();
  expect(await result.current.ensureSpace()).toBe(11);
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(12, 2) });
  expect(await result.current.ensureSpace()).toBe(12);
});
it('retains one newly created conversation across cancellation and retries', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(null) });
  const { result, createConversation } = setup(null);
  let operation!: Promise<number>;
  await act(async () => { operation = result.current.ensureSpace(); });
  const outcome = Promise.allSettled([operation]);
  act(() => result.current.cancel());
  await outcome;
  expect(await result.current.ensureConversation()).toBe(44);
  expect(createConversation).toHaveBeenCalledOnce();
});
it('invalidates pending continuation on chat switch and unmount', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(null) });
  const { result, rerender, options } = setup();
  let operation!: Promise<number>;
  await act(async () => { operation = result.current.ensureSpace(); });
  const outcome = Promise.allSettled([operation]);
  rerender({ ...options, conversationId: 45 });
  expect((await outcome)[0].status).toBe('rejected');
  expect(result.current.dialogOpen).toBe(false);
});
it.each(['403: forbidden', '409: unsupported chat', 'offline'])('keeps the selection pending on %s until explicit retry', async message => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(null) });
  vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error(message));
  const { result } = setup();
  let operation!: Promise<number>; let continued = 0;
  await act(async () => { operation = result.current.ensureSpace().then(id => { continued++; return id; }); });
  await act(() => result.current.save(11));
  expect(result.current.error).toBe(message);
  expect(result.current.dialogOpen).toBe(true);
  expect(continued).toBe(0);
  vi.mocked(apiClient.patch).mockResolvedValue({ success: true });
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(11) });
  await act(() => Promise.all([result.current.save(11), result.current.save(11)]));
  expect(await operation).toBe(11);
  expect(continued).toBe(1);
  expect(apiClient.patch).toHaveBeenCalledTimes(2);
});
it.each(['cancel', 'switch', 'unmount'])('does not resume after %s during PATCH', async action => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(null) });
  let finish!: () => void;
  vi.mocked(apiClient.patch).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ success: true }); }));
  const { result, rerender, options, unmount } = setup();
  let operation!: Promise<number>;
  await act(async () => { operation = result.current.ensureSpace(); });
  const outcome = Promise.allSettled([operation]);
  let saving!: Promise<void>;
  act(() => { saving = result.current.save(11); });
  if (action === 'cancel') act(() => result.current.cancel());
  if (action === 'switch') rerender({ ...options, conversationId: 45 });
  if (action === 'unmount') unmount();
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(11) });
  await act(async () => { finish(); await saving; });
  expect((await outcome)[0].status).toBe('rejected');
});
it('does not adopt a conversation created after navigation, and deduplicates creation', async () => {
  const { result, rerender, options, createConversation, onCreated } = setup(null);
  let finish!: () => void;
  createConversation.mockImplementation(() => new Promise(resolve => { finish = () => resolve(44); }));
  const outcome = Promise.allSettled([result.current.ensureConversation(), result.current.ensureConversation()]);
  rerender({ ...options, conversationId: 45 });
  await act(async () => { finish(); await outcome; });
  expect(createConversation).toHaveBeenCalledOnce();
  expect(onCreated).not.toHaveBeenCalled();
  expect((await outcome).every(value => value.status === 'rejected')).toBe(true);
});
it('recognizes its own draft-to-conversation transition without cancelling selection', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(null) });
  const { result, rerender, options } = setup(null);
  let operation!: Promise<number>;
  await act(async () => { operation = result.current.ensureSpace(); });
  rerender({ ...options, conversationId: 44 });
  expect(result.current.dialogOpen).toBe(true);
  vi.mocked(apiClient.patch).mockResolvedValue({ success: true });
  vi.mocked(apiClient.get).mockResolvedValue({ data: metadata(11) });
  await act(() => result.current.save(11));
  expect(await operation).toBe(11);
});
it.each([{ bound_table_id: 1708 }, { parent_conversation_id: 1 }, { comment_thread_child_id: 5 }, { type: 'thread' }])('explains unsupported scope %j before opening selector', async extra => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { ...metadata(null), ...extra } });
  const { result } = setup();
  await expect(result.current.ensureSpace()).rejects.toThrow('Space нельзя менять');
  expect(result.current.dialogOpen).toBe(false);
});
