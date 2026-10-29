import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { useDataQueries } from '../useDataQueries';

vi.mock('@/features/spaces/store/spacesStore', () => ({ useCurrentSpace: () => ({ id: 35 }) }));
vi.mock('@/features/tables/hooks/useAllTables', () => ({ useAllTables: () => ({ data: [] }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
const params: Parameters<typeof useDataQueries>[0] = {
  activePanel: 'ai-agents', effectiveSpaceId: 11, showAllContacts: false,
  tasksSource: undefined, tasksSearch: '', filesSource: undefined, showFilePicker: false,
  chatOperatorId: 256605, currentAgentOperatorId: undefined, currentAgentProviderId: undefined,
  contextSpaceId: 11, inboxSearch: '', inboxAgentFilter: '', inboxUserFilter: [],
  inboxParticipantMode: 'any', inboxDateFrom: '', inboxDateTo: '', inboxSortBy: 'updated',
  inboxSortDir: 'desc', inboxUnreadOnly: false, isWideMode: false,
};
const kimi = { id: 256605, name: 'Kimi Code CLI' };
const model = { id: 256606, name: 'Kimi model from table', model_id: 'kimi-test' };

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset();
  vi.mocked(apiClient.get).mockImplementation(async url => {
    if (url === '/ai/providers?spaceId=11') return { success: true, data: { providers: [kimi] } };
    if (url.startsWith('/ai/providers?')) return { success: true, data: { providers: [] } };
    if (url === '/ai/providers/256605/models?spaceId=11') return { success: true, data: { models: [model] } };
    if (url.includes('/models')) return { success: true, data: { models: [] } };
    if (url.endsWith('/available-users')) return { success: true, data: { users: [] } };
    if (url === '/users/agents') return { success: true, data: [] };
    if (url === '/chat/unread') return { success: true, data: { total_unread: 0 } };
    if (url.startsWith('/ai/agents/')) return { success: true, data: { agents: [] } };
    throw new Error(`Unexpected GET ${url}`);
  });
});

it('loads table operators for the chat space instead of the page space', async () => {
  const { result } = renderHook(() => useDataQueries(params), { wrapper: ProvidersWrapper });
  await waitFor(() => expect(result.current.operators).toEqual([kimi]));
  expect(apiClient.get).not.toHaveBeenCalledWith('/ai/providers?spaceId=35');
});

it('scopes model requests and cached results to the chat space', async () => {
  const { result, rerender } = renderHook(({ spaceId }) => useDataQueries({ ...params, effectiveSpaceId: spaceId }), {
    initialProps: { spaceId: 11 }, wrapper: ProvidersWrapper,
  });
  await waitFor(() => expect(result.current.models).toEqual([model]));
  rerender({ spaceId: 12 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/ai/providers/256605/models?spaceId=12'));
  expect(result.current.models).toEqual([]);
  await waitFor(() => expect(result.current.operators).toEqual([]));
});

it('waits for a chat space instead of loading a global fallback catalog', async () => {
  renderHook(() => useDataQueries({ ...params, effectiveSpaceId: undefined, contextSpaceId: undefined }), { wrapper: ProvidersWrapper });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/chat/unread'));
  expect(vi.mocked(apiClient.get).mock.calls.some(([url]) => url.startsWith('/ai/providers'))).toBe(false);
});
