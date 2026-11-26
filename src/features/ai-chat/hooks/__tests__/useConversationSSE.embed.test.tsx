import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { useConversationSSE } from '../useConversationSSE';

function mount(conversationId = 7) {
  const queryClient = new QueryClient();
  return renderHook(() => useConversationSSE(conversationId), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

describe('ADR-210 conversation transport', () => {
  afterEach(() => {
    apiClient.setEmbedReauthHandler(null);
    apiClient.setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('does not open EventSource or put the embed Bearer token in a URL', () => {
    const eventSource = vi.fn();
    vi.stubGlobal('EventSource', eventSource);
    apiClient.setAccessToken('embed-secret-token');
    apiClient.setEmbedReauthHandler(() => Promise.resolve('renewed-token'));

    const { result } = mount();
    expect(eventSource).not.toHaveBeenCalled();
    expect(result.current.connectionState).toBe('disconnected');
  });
});
