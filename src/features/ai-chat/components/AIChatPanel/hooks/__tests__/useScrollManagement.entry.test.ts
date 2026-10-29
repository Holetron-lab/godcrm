import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useScrollManagement } from '../useScrollManagement';
import type { ChatMessage } from '../../../../types';

type Params = Parameters<typeof useScrollManagement>[0];
const messages: ChatMessage[] = [{ id: '1', role: 'assistant', content: 'History', timestamp: new Date() }];

function mount() {
  const container = document.createElement('div');
  Object.defineProperty(container, 'scrollHeight', { value: 10000 });
  Object.defineProperty(container, 'clientHeight', { value: 500 });
  container.scrollTo = vi.fn();
  const beforePaint = vi.fn();
  const params: Params = {
    displayMessages: messages, aiConversationMessages: messages,
    currentConversationId: 1, userConversationId: null,
    chatPartnerId: 1, chatPartnerType: 'agent', isOpen: true,
    hasOlderMessages: false, hasNextAIPage: false,
    fetchOlderMessages: vi.fn(), fetchNextAIPage: vi.fn(),
    isFetchingOlderMessages: false, isFetchingNextAIPage: false, isAgentProcessing: false,
    messagesContainerRef: { current: container }, messagesEndRef: { current: null },
    loadMoreSentinelRef: { current: null },
    setShowScrollToBottom: vi.fn(), setNewMessageCount: vi.fn(), setAgentWorking: vi.fn(),
    fetchReactionsForMessages: vi.fn(),
  };
  const hook = renderHook((overrides: Partial<Params>) => {
    const result = useScrollManagement({ ...params, ...overrides });
    useLayoutEffect(() => { beforePaint(container.scrollTop); });
    return result;
  }, { initialProps: {} as Partial<Params> });
  act(() => { vi.advanceTimersByTime(4000); });
  return { hook, container, beforePaint };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('chat entry positioning', () => {
  it('positions loaded history before paint after an empty loading interval', () => {
    const { hook, container, beforePaint } = mount();
    hook.rerender({ displayMessages: [] });
    container.scrollTop = 0; // The empty DOM has no scroll range.
    act(() => { vi.advanceTimersByTime(4000); });
    hook.rerender({ displayMessages: [...messages, { ...messages[0], id: '2' }] });
    expect(beforePaint).toHaveBeenLastCalledWith(10000);
    act(() => { vi.advanceTimersByTime(40); });
    expect(container.scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    hook.unmount();
  });

  it('positions a switched conversation before paint even with the same cached message reference', () => {
    const { hook, container, beforePaint } = mount();
    container.scrollTop = 0;
    hook.rerender({ currentConversationId: 2 });
    expect(beforePaint).toHaveBeenLastCalledWith(10000);
    hook.unmount();
  });
});
