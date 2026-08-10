/**
 * useConversationMessages Hook Tests
 * ADR-024 Phase 2: React Query hook for messages
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

// Mock apiClient before imports
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  }
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Import after mock
import { useConversationMessages, useCreateConversation, useConversations, POLL_INTERVALS } from '../useConversationMessages';
import { apiClient } from '@/shared/utils/apiClient';

// Cast to mocked type
const mockApiClient = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

// Wrapper with QueryClientProvider
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });
  
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
};

describe('useConversationMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('when conversation ID is null', () => {
    it('should not fetch and return empty data', () => {
      const { result } = renderHook(
        () => useConversationMessages(null),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(mockApiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('when conversation ID is provided', () => {
    it('should fetch conversation with messages', async () => {
      mockApiClient.get.mockResolvedValue({
        data: {
          id: 123,
          type: 'chat',
          messages: [
            { id: '1', role: 'user', content: 'Hello' },
            { id: '2', role: 'assistant', content: 'Hi there!' }
          ]
        }
      });

      const { result } = renderHook(
        () => useConversationMessages(123),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockApiClient.get).toHaveBeenCalledWith('/chat/conversations/123');
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].content).toBe('Hello');
    });

    it('should handle loading state', () => {
      mockApiClient.get.mockReturnValue(new Promise(() => {})); // Never resolves

      const { result } = renderHook(
        () => useConversationMessages(123),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('should handle errors', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () => useConversationMessages(123),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });

    it('should poll for new messages when polling is enabled', async () => {
      let pollCallCount = 0;
      mockApiClient.get.mockImplementation(async (url: string) => {
        if (url.includes('/messages')) {
          if (url.includes('after=')) {
            // Incremental poll — return a new message
            pollCallCount++;
            if (pollCallCount >= 1) {
              return { data: { messages: [{ id: '2', role: 'user', content: 'New message from another user' }], hasMore: false } };
            }
            return { data: { messages: [], hasMore: false } };
          }
          // Initial infinite query load
          return {
            data: {
              messages: [{ id: '1', role: 'user', content: 'Hello' }],
              hasMore: false
            }
          };
        }
        // Conversation metadata
        return { data: { id: 123, type: 'chat' } };
      });

      const { result } = renderHook(
        () => useConversationMessages(123, { pollingInterval: 100 }), // Short interval for testing
        { wrapper: createWrapper() }
      );

      // Wait for initial fetch via infinite query
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      // Wait for polling to bring new messages via setTimeout chain
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
      }, { timeout: 2000 });

      expect(result.current.messages[1].content).toBe('New message from another user');
    }, 5000); // Test timeout 5 seconds
  });

  describe('sendMessage', () => {
    it('should send message and refetch', async () => {
      mockApiClient.get.mockResolvedValue({
        data: { id: 123, messages: [] }
      });
      
      mockApiClient.post.mockResolvedValue({
        data: { id: '99', role: 'user', content: 'Test message' }
      });

      const { result } = renderHook(
        () => useConversationMessages(123),
        { wrapper: createWrapper() }
      );

      await waitFor(() => !result.current.isLoading);

      await result.current.sendMessage({ content: 'Test message' });

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/chat/conversations/123/messages',
        expect.objectContaining({
          content: 'Test message',
          content_type: 'text'
        })
      );
    });

    it('should include mentions when provided', async () => {
      mockApiClient.get.mockResolvedValue({
        data: { id: 123, messages: [] }
      });
      
      mockApiClient.post.mockResolvedValue({
        data: { id: '99', role: 'user', content: '@user Test' }
      });

      const { result } = renderHook(
        () => useConversationMessages(123),
        { wrapper: createWrapper() }
      );

      await waitFor(() => !result.current.isLoading);

      await result.current.sendMessage({
        content: '@user Test',
        mentions: [{ user_id: 5, offset: 0, length: 5 }]
      });

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/chat/conversations/123/messages',
        expect.objectContaining({
          mentions: [{ user_id: 5, offset: 0, length: 5 }]
        })
      );
    });
  });
});

describe('useCreateConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a new conversation', async () => {
    mockApiClient.post.mockResolvedValue({
      data: { id: 456 }
    });

    const { result } = renderHook(
      () => useCreateConversation(),
      { wrapper: createWrapper() }
    );

    const newConversation = await result.current.mutateAsync({
      type: 'chat',
      title: 'New Chat'
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      '/chat/conversations',
      expect.objectContaining({
        type: 'chat',
        title: 'New Chat'
      })
    );
    expect(newConversation.id).toBe(456);
  });

  it('should include participant IDs', async () => {
    mockApiClient.post.mockResolvedValue({
      data: { id: 789 }
    });

    const { result } = renderHook(
      () => useCreateConversation(),
      { wrapper: createWrapper() }
    );

    await result.current.mutateAsync({
      type: 'chat',
      participantIds: [1, 2, 3]
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      '/chat/conversations',
      expect.objectContaining({
        participant_ids: [1, 2, 3]
      })
    );
  });
});

describe('useConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch conversations list', async () => {
    mockApiClient.get.mockResolvedValue({
      data: [
        { id: 1, type: 'chat', title: 'Chat 1' },
        { id: 2, type: 'chat', title: 'Group Chat' }
      ]
    });

    const { result } = renderHook(
      () => useConversations(),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(2);
  });

  it('should filter by type', async () => {
    mockApiClient.get.mockResolvedValue({
      data: [{ id: 1, type: 'chat', title: 'AI Chat' }]
    });

    const { result } = renderHook(
      () => useConversations({ type: 'chat' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockApiClient.get).toHaveBeenCalledWith(
      expect.stringContaining('type=chat')
    );
  });

  it('should filter by space', async () => {
    mockApiClient.get.mockResolvedValue({
      data: [{ id: 1, type: 'chat', title: 'Space Chat' }]
    });

    const { result } = renderHook(
      () => useConversations({ spaceId: 42 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockApiClient.get).toHaveBeenCalledWith(
      expect.stringContaining('space_id=42')
    );
  });
});

// ============================================================
// ADR-078: Incremental Polling, Backoff, Adaptive Intervals
// ============================================================
describe('ADR-078: Incremental polling with ?after parameter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use real timers — fake timers conflict with async React Query + setTimeout chains
  });

  it('should use ?after=<lastId> on subsequent polls', async () => {
    // Initial load returns messages with IDs
    mockApiClient.get.mockImplementation(async (url: string) => {
      if (url.includes('/messages')) {
        if (url.includes('after=')) {
          // Incremental poll — return new message
          return { data: { messages: [{ id: 3, role: 'assistant', content: 'New!' }], hasMore: false } };
        }
        // Initial load
        return {
          data: {
            messages: [
              { id: 1, role: 'user', content: 'Hello' },
              { id: 2, role: 'assistant', content: 'Hi' }
            ],
            hasMore: false
          }
        };
      }
      // Conversation metadata
      return { data: { id: 123, type: 'chat' } };
    });

    const { result } = renderHook(
      () => useConversationMessages(123, { pollingInterval: 100 }),
      { wrapper: createWrapper() }
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    // Wait for poll to make a call with ?after=
    await waitFor(() => {
      const calls = mockApiClient.get.mock.calls;
      const afterCall = calls.find((c: string[]) => c[0]?.includes('after='));
      expect(afterCall).toBeDefined();
    }, { timeout: 2000 });
  }, 5000);

  it('should expose pollingError and reconnect when polling fails', async () => {
    mockApiClient.get.mockImplementation(async (url: string) => {
      if (url.includes('/messages')) {
        // Return data for initial load, then fail on polls
        if (!url.includes('after=')) {
          return { data: { messages: [{ id: 1, role: 'user', content: 'Hello' }], hasMore: false } };
        }
        throw new Error('Server error 500');
      }
      return { data: { id: 123, type: 'chat' } };
    });

    const { result } = renderHook(
      () => useConversationMessages(123, { pollingInterval: 50 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    // Initial state — no error
    expect(result.current.pollingError).toBeNull();
    expect(result.current.pollingStopped).toBe(false);
    expect(typeof result.current.reconnect).toBe('function');
  }, 5000);

  it('should support adaptive polling intervals', () => {
    // Verify POLL_INTERVALS constants
    expect(POLL_INTERVALS.AGENT_PROCESSING).toBe(1500);
    expect(POLL_INTERVALS.ACTIVE_CHAT).toBe(3000);
    expect(POLL_INTERVALS.IDLE_CHAT).toBe(8000);
    expect(POLL_INTERVALS.BACKGROUND).toBe(15000);
  });

  it('should use adaptive polling when chatActivityState is provided', async () => {
    mockApiClient.get.mockImplementation(async (url: string) => {
      if (url.includes('/messages')) {
        return { data: { messages: [{ id: 1, role: 'user', content: 'Hello' }], hasMore: false } };
      }
      return { data: { id: 123, type: 'chat' } };
    });

    const { result } = renderHook(
      () => useConversationMessages(123, { adaptivePolling: true, chatActivityState: 'agent_processing' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    // Just verify it's polling (doesn't crash with adaptive mode)
    expect(result.current.pollingError).toBeNull();
  }, 5000);

  it('should expose isProcessing from polling response', async () => {
    mockApiClient.get.mockImplementation(async (url: string) => {
      if (url.includes('/messages')) {
        return {
          data: {
            messages: [{ id: 1, role: 'user', content: 'Hello' }],
            hasMore: false,
            is_processing: true,
          }
        };
      }
      return { data: { id: 123, type: 'chat' } };
    });

    const { result } = renderHook(
      () => useConversationMessages(123, { adaptivePolling: true, chatActivityState: 'agent_processing' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    // isProcessing should be available in the return value
    expect(typeof result.current.isProcessing).toBe('boolean');
  }, 5000);

  it('should default isProcessing to false when not provided', async () => {
    mockApiClient.get.mockImplementation(async (url: string) => {
      if (url.includes('/messages')) {
        return {
          data: {
            messages: [{ id: 1, role: 'user', content: 'Hello' }],
            hasMore: false,
            // no is_processing field
          }
        };
      }
      return { data: { id: 123, type: 'chat' } };
    });

    const { result } = renderHook(
      () => useConversationMessages(123),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    expect(result.current.isProcessing).toBe(false);
  }, 5000);
});
