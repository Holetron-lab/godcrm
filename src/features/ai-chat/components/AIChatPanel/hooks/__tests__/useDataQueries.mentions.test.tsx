import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProvidersWrapper, createTestQueryClient } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { useDataQueries } from '../useDataQueries';

vi.mock('@/features/spaces/store/spacesStore', () => ({ useCurrentSpace: () => null }));
vi.mock('@/features/tables/hooks/useAllTables', () => ({ useAllTables: () => ({ data: [] }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
const params: Parameters<typeof useDataQueries>[0] = {
  activePanel: 'none', effectiveSpaceId: 11, showAllContacts: false,
  tasksSource: undefined, tasksSearch: '', filesSource: undefined, showFilePicker: false,
  chatOperatorId: null, currentAgentOperatorId: undefined, currentAgentProviderId: undefined,
  contextSpaceId: 11, inboxSearch: '', inboxAgentFilter: '', inboxUserFilter: [],
  inboxParticipantMode: 'any', inboxDateFrom: '', inboxDateTo: '', inboxSortBy: 'updated',
  inboxSortDir: 'desc', inboxUnreadOnly: false, isWideMode: false,
};
const local = { id: 1, name: 'Human', color: '#a16207' };
const passport = { id: 99, name: 'Reviewer', handle: 'audit-reviewer', managed_by_agent_table_id: 1784,
  managed_by_agent_row_id: 12, agent_data: { icon: '🔍', color: '#14b8a6', description: 'Review' } };
let issued = false;
beforeEach(() => {
  issued = false;
  vi.mocked(apiClient.get).mockImplementation(async url => {
    if (url.endsWith('/available-users')) return { success: true, data: { users: [local] } };
    if (url === '/users/agents') return { success: true, data: [{ ...passport, handle: issued ? passport.handle : null }] };
    if (url === '/chat/unread') return { success: true, data: { total_unread: 0 } };
    if (url === '/ai/agents/11') return { success: true, data: { agents: [] } };
    throw new Error(`Unexpected GET ${url}`);
  });
});

it('never adds a nonmember to the space picker when a global passport is issued', async () => {
  const client = createTestQueryClient();
  const { result, unmount } = renderHook(() => useDataQueries(params), {
    wrapper: ({ children }) => <ProvidersWrapper queryClient={client}>{children}</ProvidersWrapper>,
  });
  try {
    await waitFor(() => expect(result.current.usersForMentions).toEqual([local]));
    issued = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['agent-roster', 'agent-users'] }); });
    await waitFor(() => expect(result.current.usersForMentions).toEqual([local]));
    await waitFor(() => expect(client.getQueryData(['agent-roster', 'agent-users'])).toEqual([expect.objectContaining({ handle: 'audit-reviewer' })]));
    expect(result.current.usersForMentions).toEqual([local]);
    issued = false;
    await act(async () => { await client.invalidateQueries({ queryKey: ['agent-roster', 'agent-users'] }); });
    await waitFor(() => expect(result.current.usersForMentions).toEqual([local]));
  } finally { unmount(); client.clear(); }
});

it('deduplicates a passport already present in the space and preserves local users', async () => {
  issued = true;
  const get = vi.mocked(apiClient.get).getMockImplementation()!;
  vi.mocked(apiClient.get).mockImplementation(url => url.endsWith('/available-users')
    ? Promise.resolve({ success: true, data: { users: [local, { ...passport, handle: undefined }] } }) : get(url));
  const { result } = renderHook(() => useDataQueries(params), { wrapper: ProvidersWrapper });
  await waitFor(() => expect(result.current.usersForMentions).toHaveLength(2));
  expect(result.current.usersForMentions?.find(user => user.id === 99)).toHaveProperty('handle', 'audit-reviewer');
});

it('keeps space members available when the global passport directory fails', async () => {
  const get = vi.mocked(apiClient.get).getMockImplementation()!;
  vi.mocked(apiClient.get).mockImplementation(url => url === '/users/agents'
    ? Promise.reject(new Error('Directory unavailable')) : get(url));
  const { result } = renderHook(() => useDataQueries(params), { wrapper: ProvidersWrapper });
  await waitFor(() => expect(result.current.usersForMentions).toEqual([local]));
});


it('drops members when switching spaces even while their global passports remain cached', async () => {
  issued = true;
  const get = vi.mocked(apiClient.get).getMockImplementation()!;
  vi.mocked(apiClient.get).mockImplementation(url => url === '/access/space/11/available-users'
    ? Promise.resolve({ success: true, data: { users: [local, passport] } }) : get(url));
  const { result, rerender } = renderHook(({ spaceId }) => useDataQueries({ ...params, effectiveSpaceId: spaceId }), {
    initialProps: { spaceId: 11 }, wrapper: ProvidersWrapper,
  });
  await waitFor(() => expect(result.current.usersForMentions).toHaveLength(2));
  rerender({ spaceId: 12 });
  await waitFor(() => expect(result.current.usersForMentions).toEqual([local]));
});

it('does not offer global agents when membership cannot be loaded', async () => {
  issued = true;
  const get = vi.mocked(apiClient.get).getMockImplementation()!;
  vi.mocked(apiClient.get).mockImplementation(url => url.endsWith('/available-users')
    ? Promise.reject(new Error('Membership unavailable')) : get(url));
  const { result } = renderHook(() => useDataQueries(params), { wrapper: ProvidersWrapper });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/users/agents'));
  expect(result.current.usersForMentions).toEqual([]);
});
