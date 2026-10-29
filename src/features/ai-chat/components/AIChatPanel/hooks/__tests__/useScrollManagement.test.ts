/**
 * useScrollManagement — WP-3 (bug 228711) regression.
 * A chatPartnerId change inside the SAME conversation (another agent joins a
 * group chat) must not re-arm the first-load scroll while the user reads above.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollManagement } from '../useScrollManagement';
import type { ChatMessage } from '../../../../types';

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 400;

function makeContainer() {
  const el = document.createElement('div');
  let top = 0;
  Object.defineProperty(el, 'scrollHeight', { get: () => SCROLL_HEIGHT });
  Object.defineProperty(el, 'clientHeight', { get: () => CLIENT_HEIGHT });
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = v; } });
  return el;
}

function msg(id: number): ChatMessage {
  return { id, role: 'assistant', content: `m${id}`, contentType: 'text' } as unknown as ChatMessage;
}

type Overrides = Partial<Parameters<typeof useScrollManagement>[0]>;

function setup() {
  const container = makeContainer();
  const setNewMessageCount = vi.fn();
  const baseParams = {
    aiConversationMessages: null,
    currentConversationId: 1,
    userConversationId: null,
    chatPartnerType: 'agent',
    hasOlderMessages: false,
    fetchOlderMessages: vi.fn(),
    hasNextAIPage: false,
    fetchNextAIPage: vi.fn(),
    isFetchingOlderMessages: false,
    isFetchingNextAIPage: false,
    isAgentProcessing: false,
    isOpen: true,
    messagesEndRef: { current: document.createElement('div') },
    messagesContainerRef: { current: container },
    loadMoreSentinelRef: { current: null },
    setShowScrollToBottom: vi.fn(),
    setNewMessageCount,
    setAgentWorking: vi.fn(),
    fetchReactionsForMessages: vi.fn(),
  };
  const initial = { ...baseParams, displayMessages: [msg(1)], chatPartnerId: 'agent-a' };
  const hook = renderHook((p: Overrides) => useScrollManagement({ ...initial, ...p }), {
    initialProps: {} as Overrides,
  });
  return { container, hook, setNewMessageCount };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useScrollManagement — partner change vs. reading position (WP-3)', () => {
  it('does NOT re-arm scroll-to-bottom when chatPartnerId changes while the user is scrolled up', () => {
    const { container, hook, setNewMessageCount } = setup();
    expect(container.scrollTop).toBe(SCROLL_HEIGHT); // first load lands at the bottom

    // First-load rAF loop has settled (jsdom never runs it), user scrolls up to read.
    act(() => {
      hook.result.current.isLoadingOlderRef.current = false;
      container.scrollTop = 100;
      hook.result.current.isNearBottomRef.current = false;
    });

    // Another agent joins → chatPartnerId flips, conversation ids unchanged.
    hook.rerender({ chatPartnerId: 'agent-b' });
    // Next poll brings a new message (tool call / text).
    hook.rerender({ chatPartnerId: 'agent-b', displayMessages: [msg(1), msg(2)] });

    expect(container.scrollTop).toBe(100);
    expect(hook.result.current.isNearBottomRef.current).toBe(false);
    // The unread badge still counts the new human-visible message.
    expect(setNewMessageCount).toHaveBeenCalledWith(expect.any(Function));
    hook.unmount();
  });

  it('still resets on chatPartnerId change when the user is at the bottom', () => {
    const { container, hook } = setup();
    act(() => { container.scrollTop = 900; });

    hook.rerender({ chatPartnerId: 'agent-b' });
    hook.rerender({ chatPartnerId: 'agent-b', displayMessages: [msg(1), msg(2)] });

    expect(container.scrollTop).toBe(SCROLL_HEIGHT);
    hook.unmount();
  });

  it('still resets on a real conversation switch even if the user was scrolled up', () => {
    const { container, hook } = setup();
    act(() => {
      container.scrollTop = 100;
      hook.result.current.isNearBottomRef.current = false;
    });

    hook.rerender({ currentConversationId: 2 });
    hook.rerender({ currentConversationId: 2, displayMessages: [msg(10)] });

    expect(container.scrollTop).toBe(SCROLL_HEIGHT);
    expect(hook.result.current.isNearBottomRef.current).toBe(true);
    hook.unmount();
  });
});

describe('reading history during incoming messages', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function readHistory(top = 100) {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const state = setup();
    state.container.scrollTo = (options?: ScrollToOptions | number) => {
      if (typeof options === 'object') state.container.scrollTop = options.top ?? 0;
    };
    act(() => { vi.advanceTimersByTime(3500); });
    // Match the browser's clamped bottom position before the gesture.
    act(() => {
      state.container.scrollTop = 600;
      state.container.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(16);
      state.container.scrollTop = top;
      state.container.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(16);
    });
    return state;
  }

  it('does not mistake an incoming human message for our own send', () => {
    const { container, hook } = readHistory();
    hook.rerender({ displayMessages: [msg(1), { ...msg(2), role: 'user' }] });
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.scrollTop).toBe(100);
    hook.unmount();
  });

  it('keeps following disabled after 600ms even within the 300px threshold', () => {
    const { container, hook } = readHistory(500);
    act(() => { vi.advanceTimersByTime(1000); });
    hook.rerender({ displayMessages: [msg(1), msg(2)] });
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.scrollTop).toBe(500);
    hook.unmount();
  });

  it('cancels send fallbacks as soon as the reader scrolls up', () => {
    const { container, hook } = readHistory();
    act(() => { hook.result.current.scrollToBottom(); });
    act(() => {
      container.scrollTop = 600;
      container.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(16);
      container.scrollTop = 500;
      container.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(200);
    });
    expect(container.scrollTop).toBe(500);
    hook.rerender({ displayMessages: [msg(1), msg(2)] });
    expect(container.scrollTop).toBe(500);
    hook.unmount();
  });

  it('resumes following when the reader returns to the bottom', () => {
    const { container, hook, setNewMessageCount } = readHistory(500);
    act(() => {
      container.scrollTop = 600;
      container.dispatchEvent(new Event('scroll'));
    });
    hook.rerender({ displayMessages: [msg(1), msg(2)] });
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.scrollTop).toBe(SCROLL_HEIGHT);
    expect(setNewMessageCount).toHaveBeenCalledWith(0);
    hook.unmount();
  });

  it('still follows our explicit send while reading history', () => {
    const { container, hook } = readHistory();
    act(() => { hook.result.current.scrollToBottom(); });
    hook.rerender({ displayMessages: [msg(1), { ...msg(2), role: 'user' }] });
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.scrollTop).toBe(SCROLL_HEIGHT);
    hook.unmount();
  });

  it('rechecks reading intent before queued incoming-message scrolling', () => {
    const { container, hook } = readHistory(600);
    hook.rerender({ displayMessages: [msg(1), msg(2)] });
    act(() => {
      container.scrollTop = 500;
      container.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(200);
    });
    expect(container.scrollTop).toBe(500);
    hook.unmount();
  });

});
