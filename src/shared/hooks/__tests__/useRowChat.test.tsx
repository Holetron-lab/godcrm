// src/shared/hooks/__tests__/useRowChat.test.tsx
// ADR-069: Module Integration - Chat with Table Rows
// TASK-015: Comprehensive unit tests for useRowChat hook

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRowChat } from '../useRowChat';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

// Helpers
const mockConversation = (overrides = {}) => ({
  success: true,
  data: {
    conversationId: 123,
    bound_table_id: 1,
    bound_row_id: 42,
    messages: [
      {
        id: 1,
        conversation_id: 123,
        user_id: 10,
        content: 'Hello',
        content_type: 'text',
        created_at: '2025-01-01T00:00:00Z',
        sender_type: 'human' as const,
        role: 'user' as const,
        user: { id: 10, name: 'Test User' },
      },
    ],
    participants: [
      { user_id: 10, role: 'member', joined_at: '2025-01-01T00:00:00Z' },
    ],
    ...overrides,
  },
});

describe('useRowChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== INTERFACE ==========
  describe('hook interface', () => {
    it('should return all expected properties', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: 0, rowId: 0 }),
        { wrapper: createWrapper() }
      );

      expect(result.current).toHaveProperty('conversationId');
      expect(result.current).toHaveProperty('messages');
      expect(result.current).toHaveProperty('participants');
      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('sendMessage');
      expect(result.current).toHaveProperty('isSending');
      expect(result.current).toHaveProperty('refetch');
    });

    it('should return correct types for all properties', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: 0, rowId: 0 }),
        { wrapper: createWrapper() }
      );

      expect(result.current.conversationId).toBe(null);
      expect(Array.isArray(result.current.messages)).toBe(true);
      expect(Array.isArray(result.current.participants)).toBe(true);
      expect(typeof result.current.isLoading).toBe('boolean');
      expect(typeof result.current.sendMessage).toBe('function');
      expect(typeof result.current.isSending).toBe('boolean');
      expect(typeof result.current.refetch).toBe('function');
    });
  });

  // ========== DISABLED STATES ==========
  describe('disabled states', () => {
    it('should be disabled when tableId is 0', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: 0, rowId: 1 }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(result.current.conversationId).toBe(null);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should be disabled when rowId is 0', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 0 }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should be disabled when tableId is negative', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: -1, rowId: 1 }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should be disabled when rowId is negative', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: -5 }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should return empty participants when disabled', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: 0, rowId: 0 }),
        { wrapper: createWrapper() }
      );

      expect(result.current.participants).toEqual([]);
    });

    it('should return null error when disabled', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: 0, rowId: 0 }),
        { wrapper: createWrapper() }
      );

      expect(result.current.error).toBe(null);
    });

    it('should not be sending when disabled', () => {
      const { result } = renderHook(
        () => useRowChat({ tableId: 0, rowId: 0 }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isSending).toBe(false);
    });
  });

  // ========== DATA FETCHING ==========
  describe('data fetching', () => {
    it('should fetch chat data when enabled', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      // Initially loading
      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(apiClient.get).toHaveBeenCalledWith('/chat/tasks/1/42?create=true');
      expect(result.current.conversationId).toBe(123);
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].content).toBe('Hello');
      expect(result.current.participants).toHaveLength(1);
    });

    it('should pass autoCreate=true by default (create=true query param)', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());

      renderHook(
        () => useRowChat({ tableId: 5, rowId: 10 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledWith('/chat/tasks/5/10?create=true');
      });
    });

    it('should use create=false when autoCreate is false', async () => {
      (apiClient.get as Mock).mockResolvedValue({
        success: true,
        data: { conversationId: null, messages: [], participants: [] },
      });

      renderHook(
        () => useRowChat({ tableId: 1, rowId: 42, autoCreate: false }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledWith('/chat/tasks/1/42');
      });
    });

    it('should populate messages with full message data', async () => {
      const messageWithMeta = {
        id: 7,
        conversation_id: 123,
        user_id: 10,
        content: 'Test content',
        content_type: 'text',
        created_at: '2025-06-15T10:30:00Z',
        sender_type: 'human',
        role: 'user',
        user: { id: 10, name: 'Alice', avatar: '/avatar.png', user_type: 'user' },
      };

      (apiClient.get as Mock).mockResolvedValue({
        success: true,
        data: {
          conversationId: 50,
          bound_table_id: 1,
          bound_row_id: 42,
          messages: [messageWithMeta],
          participants: [],
        },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const msg = result.current.messages[0];
      expect(msg.id).toBe(7);
      expect(msg.content).toBe('Test content');
      expect(msg.sender_type).toBe('human');
      expect(msg.role).toBe('user');
      expect(msg.user?.name).toBe('Alice');
    });

    it('should populate participants data', async () => {
      (apiClient.get as Mock).mockResolvedValue({
        success: true,
        data: {
          conversationId: 123,
          bound_table_id: 1,
          bound_row_id: 42,
          messages: [],
          participants: [
            { user_id: 10, role: 'admin', joined_at: '2025-01-01T00:00:00Z', user: { id: 10, name: 'Admin User' } },
            { user_id: 20, role: 'member', joined_at: '2025-01-02T00:00:00Z', user: { id: 20, name: 'Member' } },
          ],
        },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.participants).toHaveLength(2);
      });

      expect(result.current.participants[0].role).toBe('admin');
      expect(result.current.participants[1].user?.name).toBe('Member');
    });

    it('should handle agent messages with tool_results', async () => {
      const agentMessage = {
        id: 2,
        conversation_id: 123,
        user_id: 99,
        content: 'I found the answer',
        content_type: 'text',
        created_at: '2025-01-01T00:05:00Z',
        sender_type: 'agent',
        role: 'assistant',
        agent_id: 5,
        tool_results: [
          { tool: 'search', args: { query: 'test' }, result: { count: 3 } },
        ],
        user: { id: 99, name: 'AI Agent', user_type: 'agent' },
      };

      (apiClient.get as Mock).mockResolvedValue({
        success: true,
        data: {
          conversationId: 123,
          bound_table_id: 1,
          bound_row_id: 42,
          messages: [agentMessage],
          participants: [],
        },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      const msg = result.current.messages[0];
      expect(msg.sender_type).toBe('agent');
      expect(msg.agent_id).toBe(5);
      expect(msg.tool_results).toHaveLength(1);
      expect(msg.tool_results![0].tool).toBe('search');
    });

    it('should handle error response from API', async () => {
      (apiClient.get as Mock).mockResolvedValue({
        success: false,
        error: { message: 'Table not found' },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 999, rowId: 1 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).not.toBeNull();
      expect(result.current.error?.message).toBe('Table not found');
      expect(result.current.conversationId).toBe(null);
    });

    it('should handle error response with fallback message', async () => {
      (apiClient.get as Mock).mockResolvedValue({
        success: false,
        error: {},
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 1 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      expect(result.current.error?.message).toBe('Failed to fetch conversation');
    });

    it('should handle network error', async () => {
      (apiClient.get as Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 1 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).not.toBeNull();
      expect(result.current.error?.message).toBe('Network error');
    });

    it('should call logger.debug when fetching', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ tableId: 1, rowId: 42 }),
        '[useRowChat] Fetching conversation'
      );
    });
  });

  // ========== SEND MESSAGE ==========
  describe('sendMessage', () => {
    it('should send message via POST', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());
      (apiClient.post as Mock).mockResolvedValue({
        success: true,
        data: { id: 999, content: 'Test message', content_type: 'text' },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.conversationId).toBe(123);
      });

      act(() => {
        result.current.sendMessage('Test message');
      });

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith(
          '/chat/conversations/123/messages',
          {
            content: 'Test message',
            content_type: 'text',
          }
        );
      });
    });

    it('should set isSending during message send', async () => {
      let resolvePost: (value: unknown) => void;
      const postPromise = new Promise((resolve) => {
        resolvePost = resolve;
      });

      (apiClient.get as Mock).mockResolvedValue(mockConversation());
      (apiClient.post as Mock).mockImplementation(() => postPromise);

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.conversationId).toBe(123);
      });

      expect(result.current.isSending).toBe(false);

      act(() => {
        result.current.sendMessage('Hello');
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(true);
      });

      act(() => {
        resolvePost!({ success: true, data: {} });
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });
    });

    it('should invalidate cache after successful send', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());
      (apiClient.post as Mock).mockResolvedValue({
        success: true,
        data: { id: 1 },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.conversationId).toBe(123);
      });

      // Clear mock to track refetch
      (apiClient.get as Mock).mockClear();

      act(() => {
        result.current.sendMessage('Hello');
      });

      // After send, cache should be invalidated and refetch triggered
      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalled();
      });
    });

    it('should handle failed message send', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());
      (apiClient.post as Mock).mockResolvedValue({
        success: false,
        error: { message: 'Permission denied' },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.conversationId).toBe(123);
      });

      act(() => {
        result.current.sendMessage('Unauthorized message');
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });

      // Logger.error should be called on failure
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        '[useRowChat] Failed to send message'
      );
    });

    it('should handle send message network error', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());
      (apiClient.post as Mock).mockRejectedValue(new Error('Connection lost'));

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.conversationId).toBe(123);
      });

      act(() => {
        result.current.sendMessage('Test');
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it('should call logger.debug when sending a message', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());
      (apiClient.post as Mock).mockResolvedValue({
        success: true,
        data: { id: 1 },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.conversationId).toBe(123);
      });

      act(() => {
        result.current.sendMessage('Log test');
      });

      await waitFor(() => {
        expect(logger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ conversationId: 123, text: 'Log test' }),
          '[useRowChat] Sending message'
        );
      });
    });

    it('should throw when sending without a conversation', async () => {
      (apiClient.get as Mock).mockResolvedValue({
        success: true,
        data: { conversationId: null, messages: [], participants: [] },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.sendMessage('Should fail');
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });

      // Error should be logged because no conversation exists
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ========== REFETCH ==========
  describe('refetch', () => {
    it('should refetch conversation data', async () => {
      (apiClient.get as Mock).mockResolvedValue(mockConversation());

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(apiClient.get).toHaveBeenCalledTimes(1);

      act(() => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ========== QUERY KEY ==========
  describe('query key isolation', () => {
    it('should use unique query keys for different tableId/rowId combos', async () => {
      (apiClient.get as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/1/10')) {
          return mockConversation({ conversationId: 100 });
        }
        return mockConversation({ conversationId: 200 });
      });

      const wrapper = createWrapper();

      const { result: result1 } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 10 }),
        { wrapper }
      );
      const { result: result2 } = renderHook(
        () => useRowChat({ tableId: 2, rowId: 20 }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.isLoading).toBe(false);
        expect(result2.current.isLoading).toBe(false);
      });

      // They should have been fetched independently
      expect(apiClient.get).toHaveBeenCalledWith('/chat/tasks/1/10?create=true');
      expect(apiClient.get).toHaveBeenCalledWith('/chat/tasks/2/20?create=true');
    });
  });

  // ========== EMPTY STATE ==========
  describe('empty conversation', () => {
    it('should handle conversation with no messages', async () => {
      (apiClient.get as Mock).mockResolvedValue({
        success: true,
        data: {
          conversationId: 50,
          bound_table_id: 1,
          bound_row_id: 42,
          messages: [],
          participants: [],
        },
      });

      const { result } = renderHook(
        () => useRowChat({ tableId: 1, rowId: 42 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.conversationId).toBe(50);
      expect(result.current.messages).toEqual([]);
      expect(result.current.participants).toEqual([]);
      expect(result.current.error).toBe(null);
    });
  });
});
