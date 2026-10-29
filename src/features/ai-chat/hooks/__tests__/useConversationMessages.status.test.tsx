import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { useConversationMessages } from '../useConversationMessages';
import { groupMessagesIntoTurns } from '../../utils/groupMessagesIntoTurns';
import type { ChatMessage } from '../../types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps another device polling in the same turn order as freshly loaded history', async () => {
  const timestamp = new Date();
  const user: ChatMessage = { id: '201', role: 'user', content: 'Check the photo', timestamp };
  const status: ChatMessage = { id: '202', role: 'assistant', content: '', contentType: 'agent_status', timestamp,
    metadata: { agent_name: 'SysAdmin', agent_row_id: 3, job_id: 'current', placeholder: true, agent_status: 'running' } };
  const step: ChatMessage = { ...status, id: '203', contentType: 'thinking', content: 'Checking' };
  const previous: ChatMessage = { id: '200', role: 'assistant', contentType: 'text', content: 'Previous answer', timestamp,
    metadata: { agent_name: 'SysAdmin', agent_row_id: 3 } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['conversation-messages', 3692], {
    pages: [{ messages: [previous], hasMore: false }], pageParams: [null],
  });
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url.includes('content_types=agent_status')) return { data: { messages: [status] } };
    if (url.includes('content_types=plan')) return { data: { messages: [] } };
    return { data: { messages: [user, step], is_processing: true,
      active_agents: [{ job_id: 'current', agent_row_id: 3, agent_name: 'SysAdmin', started_at: timestamp.toISOString() }] } };
  });
  const { result } = renderHook(() => useConversationMessages(3692, { pollingInterval: 10 }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  try {
    await waitFor(() => expect(result.current.messages.some(m => m.id === step.id)).toBe(true));
    expect(result.current.messages.map(m => m.id)).toEqual(['200', '201', '202', '203']);
    const turns = groupMessagesIntoTurns(result.current.messages, {}, true);
    expect(turns).toEqual(groupMessagesIntoTurns([previous, user, status, step], {}, true));
    expect(turns.map(turn => turn.messages.map(m => m.id))).toEqual([['200'], ['201'], ['202', '203']]);
  } finally { client.clear(); }
});

it('does not revive completed jobs or copy historical steps into a current status', async () => {
  const timestamp = new Date();
  const oldStatus: ChatMessage = {
    id: '100', role: 'assistant', content: '', contentType: 'agent_status', timestamp,
    metadata: { agent_name: 'Architect', agent_row_id: 2, agent_status: 'finished', job_id: 'old' },
  };
  const currentStatus = {
    id: '201', role: 'assistant', content: '', contentType: 'agent_status', timestamp,
    metadata: { agent_name: 'SysAdmin', agent_row_id: 3, agent_status: 'thinking', job_id: 'current' },
    _step_groups_before: [{ type: 'thinking', count: 26, first_id: 80, last_id: 99, agent_name: 'Orchestrator' }],
    _total_hidden_before: 26,
  };
  const oldPlan: ChatMessage = {
    id: '90', role: 'assistant', content: 'Old plan', contentType: 'plan', timestamp,
    metadata: { agent_name: 'Orchestrator', agent_row_id: 4, job_id: 'old-plan' },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['conversation-messages', 3660], {
    pages: [{ messages: [{ id: '200', role: 'user', content: 'Continue', timestamp }, oldStatus, oldPlan], hasMore: false }],
    pageParams: [null],
  });
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url.includes('content_types=agent_status')) return { data: { messages: [oldStatus, currentStatus] } };
    if (url.includes('content_types=plan')) return { data: { messages: [oldPlan] } };
    return { data: { messages: [], is_processing: true, processing_agent_id: 3,
      active_agents: [{ job_id: 'current', job_db_id: 9, agent_row_id: 3, agent_name: 'SysAdmin', started_at: timestamp.toISOString(), status: 'processing' }] } };
  });
  const { result } = renderHook(() => useConversationMessages(3660, { pollingInterval: 10 }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.messages.some(m => m.id === '201')).toBe(true));
  expect(result.current.messages.map(m => m.id)).toEqual(['200', '201']);
  expect(result.current.messages.find(m => m.id === '201')).not.toHaveProperty('_step_groups_before');
  expect(currentStatus._total_hidden_before).toBe(26);
  client.clear();
});

it('groups a status and raw API steps and final answer for the same agent', () => {
  const base = { role: 'assistant' as const, timestamp: new Date(), sender_name: 'SysAdmin' };
  const messages = [
    { ...base, id: '1', contentType: 'agent_status' as const, content: '', metadata: { agent_name: 'SysAdmin', agent_row_id: 3 } },
    { ...base, id: '2', contentType: 'thinking' as const, content: 'Checking', agent_id: 3 },
    { ...base, id: '3', contentType: 'text' as const, content: 'Done', agent_id: 3 },
  ];
  const turns = groupMessagesIntoTurns(messages, {}, false);
  expect(turns).toHaveLength(1);
  expect(turns[0].messages.map(m => m.id)).toEqual(['1', '2', '3']);
});

it('refreshes all active plans across API and cache pages without reviving previous jobs', async () => {
  const timestamp = new Date();
  const first: ChatMessage = { id: '101', role: 'assistant', content: 'First updated', contentType: 'plan', timestamp,
    metadata: { agent_name: 'Architect', job_id: 'first' } };
  const second: ChatMessage = { id: '102', role: 'assistant', content: 'Second updated', contentType: 'plan', timestamp,
    metadata: { agent_name: 'Frontend', job_db_id: 12 } };
  const stale: ChatMessage = { ...first, id: '103', metadata: { job_id: 'previous' } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['conversation-messages', 3660], {
    pages: [{ messages: [{ id: '200', role: 'user', content: 'Continue', timestamp }], hasMore: false }], pageParams: [null],
  });
  let planPolls = 0;
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url.includes('content_types=agent_status')) return { data: { messages: [] } };
    if (url.includes('content_types=plan')) {
      if (url.includes('before=102')) return { data: { messages: [first], hasMore: false } };
      planPolls++;
      return { data: { messages: [second, stale], hasMore: true, nextCursor: 102 } };
    }
    return { data: { messages: [], is_processing: true, processing_agent_id: 2,
      active_agents: [
        { job_id: 'first', job_db_id: 11, agent_row_id: 2, agent_name: 'Architect', started_at: timestamp.toISOString() },
        { job_id: 'second', job_db_id: 12, agent_row_id: 3, agent_name: 'Frontend', started_at: timestamp.toISOString() },
      ] } };
  });
  const { result } = renderHook(() => useConversationMessages(3660, { pollingInterval: 10 }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  // An older cached plan must be updated in place, including a loaded history page.
  client.setQueryData(['conversation-messages', 3660], {
    pages: [
      { messages: [{ id: '200', role: 'user', content: 'Continue', timestamp }], hasMore: true },
      { messages: [{ ...first, content: 'First original' }], hasMore: false },
    ], pageParams: [null, 200],
  });
  await waitFor(() => expect(result.current.messages.find(m => m.id === '101')?.content).toBe('First updated'));
  expect(result.current.messages.filter(m => m.contentType === 'plan').map(m => m.id).sort()).toEqual(['101', '102']);
  const cached = client.getQueryData(['conversation-messages', 3660]);
  const polls = planPolls;
  await waitFor(() => expect(planPolls).toBeGreaterThan(polls));
  expect(client.getQueryData(['conversation-messages', 3660])).toBe(cached);
  client.clear();
});
