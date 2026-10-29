import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatSearch } from '../useChatSearch';
import type { ChatMessage } from '../../../../types';

afterEach(() => vi.useRealTimers());

it('searches only while active, wraps navigation and highlights the matching message', () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  container.innerHTML = '<div data-message-id="1"></div><div data-message-id="3"></div>';
  const first = container.children[0] as HTMLElement;
  const last = container.children[1] as HTMLElement;
  first.scrollIntoView = vi.fn();
  last.scrollIntoView = vi.fn();
  const messages = [
    { id: '1', content: 'Alpha' }, { id: '2', content: 'Other' }, { id: '3', content: 'ALPHA again' },
  ] as ChatMessage[];
  const ref = { current: container };
  const { result, rerender } = renderHook(({ items }) => useChatSearch(items, ref), {
    initialProps: { items: messages },
  });
  act(() => result.current.setChatSearchQuery('alpha'));
  expect(result.current.searchMatchIds).toEqual([]);
  act(() => result.current.handleSearchNext());
  expect(result.current.chatSearchCurrentMatch).toBe(0);
  act(() => result.current.setChatSearchActive(true));
  expect(result.current.searchMatchIds).toEqual(['1', '3']);
  expect(first.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  expect(first).toHaveClass('search-highlight');
  act(() => result.current.handleSearchPrev());
  expect(result.current.chatSearchCurrentMatch).toBe(1);
  expect(last.scrollIntoView).toHaveBeenCalledOnce();
  act(() => result.current.handleSearchNext());
  expect(result.current.chatSearchCurrentMatch).toBe(0);
  act(() => vi.advanceTimersByTime(2000));
  expect(first).not.toHaveClass('search-highlight');
  expect(last).not.toHaveClass('search-highlight');
  rerender({ items: [messages[1]] });
  expect(result.current.searchMatchIds).toEqual([]);
  act(() => result.current.handleSearchPrev());
  expect(result.current.chatSearchCurrentMatch).toBe(0);
});
