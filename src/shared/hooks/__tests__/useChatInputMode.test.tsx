import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useChatInputMode } from '../useChatInputMode';

beforeEach(() => localStorage.clear());
it('defaults to shared input and synchronizes preferences across mounted consumers and tabs', () => {
  const first = renderHook(() => useChatInputMode());
  const second = renderHook(() => useChatInputMode());
  expect(first.result.current.mode).toBe('shared');
  act(() => first.result.current.setMode('per-chat'));
  expect(second.result.current.mode).toBe('per-chat');
  expect(renderHook(() => useChatInputMode()).result.current.mode).toBe('per-chat');
  act(() => {
    localStorage.setItem('god-crm-chat-input-mode', 'invalid');
    window.dispatchEvent(new StorageEvent('storage', { key: 'god-crm-chat-input-mode' }));
  });
  expect(first.result.current.mode).toBe('shared');
});
it('reports a failed save without changing the active preference', () => {
  const { result } = renderHook(() => useChatInputMode());
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  act(() => result.current.setMode('per-chat'));
  expect(result.current.error).toBe(true);
  expect(result.current.mode).toBe('shared');
  spy.mockRestore();
});
