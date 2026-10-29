import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import type { ChatMessage } from '../../types';
import { useConversationMessages } from '../useConversationMessages';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each(['agent_status', 'plan'])('keeps the main poll when the interval changes during a delayed %s refresh', async (delayedType) => {
  const timestamp = new Date();
  const previous: ChatMessage = { id: '200', role: 'assistant', content: 'Previous', timestamp };
  const user: ChatMessage = { id: '201', role: 'user', content: 'Check the photo', timestamp };
  const status: ChatMessage = { id: '202', role: 'assistant', content: '', contentType: 'agent_status', timestamp,
    metadata: { job_id: 'current', agent_name: 'SysAdmin', placeholder: true, agent_status: 'running' } };
  const step: ChatMessage = { ...status, id: '203', contentType: 'thinking', content: 'Checking' };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['conversation-messages', 3692], {
    pages: [{ messages: [previous], hasMore: false }], pageParams: [null],
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let refreshStarted = false;
  const cursors: number[] = [];
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const types = params.get('content_types');
    if (types === 'agent_status' || types === 'plan') {
      if (types === delayedType && !refreshStarted) {
        refreshStarted = true;
        await pending;
      }
      return { data: { messages: types === 'agent_status' ? [status] : [] } };
    }
    if (!url.includes('/messages')) return { data: { id: 3692 } };
    const after = Number(params.get('after'));
    cursors.push(after);
    return { data: { messages: [user, step].filter(m => Number(m.id) > after), is_processing: true,
      active_agents: [{ job_id: 'current', agent_name: 'SysAdmin' }] } };
  });
  const { result, rerender, unmount } = renderHook(
    ({ interval }) => useConversationMessages(3692, { pollingInterval: interval }), {
      initialProps: { interval: 10 },
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
  try {
    await waitFor(() => expect(refreshStarted).toBe(true));
    // The chat consumer changes its polling interval when isProcessing becomes true.
    expect(result.current.isProcessing).toBe(true);
    rerender({ interval: 20 });
    // Main messages must already be visible while the optional request is pending.
    expect(result.current.messages.map(m => m.id)).toContain('201');
    await act(async () => { release(); await pending; });
    await waitFor(() => expect(cursors.length).toBeGreaterThan(1));
    await waitFor(() => expect(result.current.messages.map(m => m.id)).toEqual(['200', '201', '202', '203']));
    expect(cursors[0]).toBe(200);
    expect(cursors.slice(1)).not.toContain(202);
  } finally { unmount(); release(); client.clear(); }
});

it('ignores a main poll that resolves after switching conversations', async () => {
  const timestamp = new Date();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const id of [1, 2]) client.setQueryData(['conversation-messages', id], {
    pages: [{ messages: [{ id: String(id * 100), role: 'user', content: 'History', timestamp }], hasMore: false }], pageParams: [null],
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url.includes('/1/messages?after=')) {
      started = true;
      await pending;
      return { data: { messages: [{ id: '101', role: 'user', content: 'Late', timestamp }],
        is_processing: true, processing_agent_name: 'Old agent' } };
    }
    return { data: { messages: [], hasMore: false } };
  });
  const { result, rerender, unmount } = renderHook(
    ({ id }) => useConversationMessages(id, { pollingInterval: 10 }), {
      initialProps: { id: 1 },
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
  try {
    await waitFor(() => expect(started).toBe(true));
    rerender({ id: 2 });
    // Switching chats resets and refetches the old query; let that settle first.
    await waitFor(() => expect(client.getQueryData(['conversation-messages', 1])).toBeDefined());
    const oldCache = client.getQueryData(['conversation-messages', 1]);
    await act(async () => { release(); await pending; });
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.processingAgentName).toBeNull();
    expect(result.current.messages.map(m => m.id)).toEqual(['200']);
    expect(client.getQueryData(['conversation-messages', 1])).toBe(oldCache);
  } finally { unmount(); release(); client.clear(); }
});
