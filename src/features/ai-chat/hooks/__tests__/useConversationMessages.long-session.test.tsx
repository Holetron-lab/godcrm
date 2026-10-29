import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import type { ChatMessage } from '../../types';
import { useConversationMessages } from '../useConversationMessages';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each(['running', 'processing', 'pending', 'paused', 'legacy'])(
  'keeps fetching steps for a long-lived %s run until it finishes', async (status) => {
    const timestamp = new Date(Date.now() - 60 * 60 * 1000);
    const user: ChatMessage = { id: '100', role: 'user', content: 'Work', timestamp };
    const agentStatus: ChatMessage = { id: '101', role: 'assistant', content: '',
      contentType: 'agent_status', timestamp,
      metadata: { job_id: 'long-run', agent_name: 'Frontend', agent_row_id: 7, agent_status: 'running' } };
    const step: ChatMessage = { ...agentStatus, id: '102', contentType: 'thinking', content: 'Still working' };
    const final: ChatMessage = { ...step, id: '103', contentType: 'text', content: 'Done' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['conversation-messages', 3660], {
      pages: [{ messages: [user, agentStatus], hasMore: false }], pageParams: [null],
    });
    let finished = false;
    let idlePoll = false;
    let statusRefreshes = 0;
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (!url.includes('/messages')) return { data: { id: 3660 } };
      const params = new URL(url, 'http://localhost').searchParams;
      const types = params.get('content_types')?.split(',') ?? [];
      if (types.length === 1) {
        if (types[0] === 'agent_status') statusRefreshes++;
        return { data: { messages: types[0] === 'agent_status' ? [agentStatus] : [] } };
      }
      const after = Number(params.get('after'));
      if (finished && after === 103 && !types.includes('thinking')) idlePoll = true;
      return { data: {
        messages: (finished ? [step, final] : [step]).filter(m => Number(m.id) > after && types.includes(m.contentType!)),
        is_processing: status === 'legacy' && !finished,
        ...(status === 'legacy' ? {} : { active_agents: finished ? [] : [{
          job_id: 'long-run', agent_row_id: 7, agent_name: 'Frontend', status,
          started_at: timestamp.toISOString(),
        }] }),
      } };
    });
    const { result, unmount } = renderHook(() => useConversationMessages(3660, { pollingInterval: 10 }), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    try {
      // No new user message or final answer should be needed to wake the bubble.
      await waitFor(() => expect(result.current.messages.map(m => m.id)).toContain('102'));
      expect(result.current.isProcessing).toBe(true);
      if (status !== 'legacy') {
        expect(result.current.messages.map(m => m.id)).toContain('101');
        expect(statusRefreshes).toBeGreaterThan(0);
      }
      finished = true;
      await waitFor(() => expect(idlePoll).toBe(true));
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.messages.map(m => m.id)).toEqual(['100', '102', '103']);
    } finally { unmount(); client.clear(); }
  },
);
