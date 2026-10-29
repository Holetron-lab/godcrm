import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useScrollManagement } from '../useScrollManagement';
import type { ChatMessage } from '../../../../types';

type Params = Parameters<typeof useScrollManagement>[0];
const messages: ChatMessage[] = [{ id: '1', role: 'assistant', content: 'Streaming', timestamp: new Date() }];
let resize: () => void;
const disconnect = vi.fn();

function mount() {
  const container = document.createElement('div');
  container.append(document.createElement('div'));
  let height = 1000;
  let viewport = 400;
  let top = 0;
  Object.defineProperties(container, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => viewport },
    scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - viewport)); } },
  });
  container.scrollTo = vi.fn();
  const beforePaint = vi.fn();
  const params: Params = {
    displayMessages: messages, aiConversationMessages: messages,
    currentConversationId: 1, userConversationId: null,
    chatPartnerId: 1, chatPartnerType: 'agent', isOpen: true,
    hasOlderMessages: false, hasNextAIPage: false,
    fetchOlderMessages: vi.fn(), fetchNextAIPage: vi.fn(),
    isFetchingOlderMessages: false, isFetchingNextAIPage: false, isAgentProcessing: true,
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
  const scroll = (value: number) => act(() => {
    container.scrollTop = value;
    container.dispatchEvent(new Event('scroll'));
  });
  return { hook, container, beforePaint, scroll,
    contentHeight: (value: number) => { height = value; },
    viewportHeight: (value: number) => { viewport = value; },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resize = () => {};
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bottom anchoring during active chat updates', () => {
  it.each(['append', 'stream'] as const)('pins before paint on %s without smooth scrolling', kind => {
    const { hook, container, contentHeight, beforePaint } = mount();
    contentHeight(1400);
    hook.rerender({ displayMessages: kind === 'append'
      ? [...messages, { ...messages[0], id: '2' }]
      : [{ ...messages[0], content: 'More streamed text' }] });
    expect(beforePaint).toHaveBeenLastCalledWith(1000);
    act(() => { vi.advanceTimersByTime(100); });
    expect(container.scrollTo).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('pins child-only growth, collapse and viewport resize; keeps following after shrink', () => {
    const { hook, container, contentHeight, viewportHeight, scroll } = mount();
    contentHeight(1600);
    act(() => resize());
    expect(container.scrollTop).toBe(1200);
    scroll(1200);
    contentHeight(1100);
    act(() => resize());
    expect(container.scrollTop).toBe(700);
    scroll(700);
    expect(hook.result.current.isNearBottomRef.current).toBe(true);
    viewportHeight(200);
    act(() => resize());
    expect(container.scrollTop).toBe(900);
    hook.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('preserves reading position and resumes only after returning to bottom', () => {
    const { hook, container, contentHeight, scroll } = mount();
    scroll(500);
    contentHeight(1400);
    hook.rerender({ displayMessages: [...messages] });
    act(() => resize());
    expect(container.scrollTop).toBe(500);
    scroll(1000);
    contentHeight(1600);
    act(() => resize());
    expect(container.scrollTop).toBe(1200);
    hook.unmount();
  });

  it('does not move a text selection during an update or resize', () => {
    const { hook, container, contentHeight } = mount();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false, rangeCount: 1, anchorNode: container.firstChild,
    } as Selection);
    contentHeight(1400);
    hook.rerender({ displayMessages: [...messages, { ...messages[0], id: '2' }] });
    act(() => { resize(); vi.advanceTimersByTime(100); });
    expect(container.scrollTop).toBe(600);
    hook.unmount();
  });

  it('leaves older-message restoration in control', () => {
    const { hook, container, contentHeight } = mount();
    hook.result.current.isLoadingOlderRef.current = true;
    contentHeight(1400);
    hook.rerender({ displayMessages: [...messages] });
    act(() => resize());
    expect(container.scrollTop).toBe(600);
    hook.unmount();
  });
});
