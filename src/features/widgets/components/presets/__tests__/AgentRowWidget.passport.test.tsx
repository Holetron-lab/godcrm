import { beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { AgentRowWidget } from '../AgentRowWidget';

vi.mock('@/features/spaces/store/spacesStore', () => ({ useCurrentSpace: () => ({ id: 11 }) }));
vi.mock('@/features/spaces/hooks/useSpaceAccessLevel', () => ({ useSpaceAccessLevel: () => ({ isOwner: true }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const widget = { config: { space_id: 11 } } as unknown as Parameters<typeof AgentRowWidget>[0]['widget'];
let handle: string | null;
beforeEach(() => {
  vi.resetAllMocks();
  handle = null;
  vi.mocked(apiClient.get).mockImplementation(async url => {
    if (url === '/users/passport-authority?space_id=11') return { success: true, data: { allowed: true, reason: 'ok', space: { id: 11 } } };
    if (url === '/ai/agents/11') return { success: true, data: { agents: [{ id: 12, name: 'Reviewer' }] } };
    if (url === '/users/agents?spaceId=11') return { success: true, data: [{ id: 99, managed_by_agent_row_id: 12, handle }] };
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.mocked(apiClient.post).mockImplementation(async () => { handle = 'audit-reviewer'; return { success: true, data: { ok: true, handle } }; });
  vi.mocked(apiClient.delete).mockImplementation(async () => { handle = null; return { success: true, data: { ok: true } }; });
});

it.each(['issue', 'revoke', 'refused'] as const)('refreshes mention caches only after a successful passport action: %s', async action => {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (action === 'revoke') handle = 'audit-reviewer';
  if (action === 'refused') vi.mocked(apiClient.post).mockRejectedValue(new Error('Forbidden'));
  const initial = handle;
  const keys = [['users-for-mentions', 11], ['chat-space-users', 11], ['chat-all-users']];
  const queries = keys.map(queryKey => new QueryObserver(client, { queryKey, queryFn: async () => handle }));
  const stop = queries.map(query => query.subscribe(() => {}));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    await waitFor(() => keys.forEach(key => expect(client.getQueryData(key)).toBe(initial)));
    const view = renderWithProviders(<AgentRowWidget widget={widget} data={[]} />, { queryClient: client });
    await user.click(await screen.findByRole('button', { name: 'Действия: Reviewer' }));
    await user.click(await screen.findByRole('menuitem', { name: action === 'revoke' ? 'Отозвать паспорт' : 'Выдать паспорт' }));
    await waitFor(() => expect(action === 'revoke' ? apiClient.delete : apiClient.post).toHaveBeenCalled());
    if (action !== 'refused') {
      await waitFor(() => keys.forEach(key => expect(client.getQueryData(key)).toBe(action === 'revoke' ? null : 'audit-reviewer')));
    } else {
      keys.forEach(key => expect(client.getQueryData(key)).toBe(initial));
    }
    view.unmount();
  } finally { stop.forEach(unsubscribe => unsubscribe()); client.clear(); confirm.mockRestore(); }
});
