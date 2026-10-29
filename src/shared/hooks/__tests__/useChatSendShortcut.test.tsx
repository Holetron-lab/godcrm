import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useChatSendShortcut } from '../useChatSendShortcut';

beforeEach(() => localStorage.clear());

it('defaults to Shift+Enter and persists independent mobile and desktop choices', () => {
  const first = renderHook(() => useChatSendShortcut());
  const second = renderHook(() => useChatSendShortcut());
  expect(first.result.current.preferences).toEqual({ desktop: 'shift-enter', mobile: 'shift-enter' });
  act(() => first.result.current.setMode('desktop', 'enter'));
  expect(second.result.current.preferences).toEqual({ desktop: 'enter', mobile: 'shift-enter' });
  first.unmount();
  expect(renderHook(() => useChatSendShortcut()).result.current.preferences.desktop).toBe('enter');
});

it('handles storage failure without claiming the choice was saved', () => {
  const { result } = renderHook(() => useChatSendShortcut());
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  act(() => result.current.setMode('mobile', 'enter'));
  expect(result.current.error).toBe(true);
  expect(result.current.preferences.mobile).toBe('shift-enter');
  spy.mockRestore();
});

it('synchronizes external changes and reset; ignores invalid saved values', () => {
  const { result } = renderHook(() => useChatSendShortcut());
  act(() => {
    localStorage.setItem('god-crm-chat-send-shortcut', JSON.stringify({ desktop: 'enter', mobile: 'invalid' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'god-crm-chat-send-shortcut' }));
  });
  expect(result.current.preferences).toEqual({ desktop: 'enter', mobile: 'shift-enter' });
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage')); });
  expect(result.current.preferences.desktop).toBe('shift-enter');
});
