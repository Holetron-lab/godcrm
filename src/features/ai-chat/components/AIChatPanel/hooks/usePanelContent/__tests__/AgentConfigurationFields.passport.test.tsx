import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTestQueryClient, renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { AgentConfigurationFields } from '../AgentConfigurationFields';
import type { AIAgent } from '@/features/ai-chat/types';

const access = vi.hoisted(() => ({ accessLevel: 'owner_owner', loading: false }));
vi.mock('@/features/spaces/hooks/useSpaceAccessLevel', () => ({ useSpaceAccessLevel: () => access }));
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ loadAgents: vi.fn(), spaceId: 7809 }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const agent = { id: 12, table_id: 1784, space_id: 11, name: 'Agent' } as AIAgent;
let authority = { allowed: true, reason: 'ok', space: { id: 11 } };
let users: Array<{ id: number; managed_by_agent_row_id: number; handle?: string | null }>;
beforeEach(() => {
  vi.resetAllMocks();
  access.accessLevel = 'owner_owner';
  users = [];
  authority = { allowed: true, reason: 'ok', space: { id: 11 } };
  vi.mocked(apiClient.get).mockImplementation(async url => {
    if (url === '/users/passport-authority?row_id=12') return { success: true, data: authority };
    if (url === '/users/agents?spaceId=11') return { success: true, data: users };
    if (url.includes('/rows/')) return { success: true, data: { row: { data: { main_instructions: 'Original' } } } };
    throw new Error(`Unexpected GET ${url}`);
  });
  vi.mocked(apiClient.post).mockImplementation(async url => {
    if (url === '/users/create-agent-user') {
      users = [{ id: 99, managed_by_agent_row_id: 12 }];
      return { success: true, data: users[0] };
    }
    users = [{ id: 99, managed_by_agent_row_id: 12, handle: 'agent' }];
    return { success: true, data: { ok: true, user_id: 99, handle: 'agent' } };
  });
});

async function renderOwner() {
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  const button = await screen.findByRole('button', { name: 'Выдать паспорт' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

it('creates the linked user, issues by user ID, and preserves the settings draft', async () => {
  const button = await renderOwner();
  fireEvent.change(screen.getByLabelText('Основная инструкция'), { target: { value: 'Unsaved' } });
  fireEvent.click(button);
  expect(await screen.findByRole('button', { name: 'Паспорт выдан' })).toBeDisabled();
  expect(apiClient.post).toHaveBeenNthCalledWith(1, '/users/create-agent-user', { agentTableId: 1784, agentRowId: 12 });
  expect(apiClient.post).toHaveBeenNthCalledWith(2, '/users/99/passport', {});
  expect(screen.getByRole('status')).toHaveTextContent('@agent');
  expect(screen.getByLabelText('Основная инструкция')).toHaveValue('Unsaved');
  expect(apiClient.put).not.toHaveBeenCalled();
});

it('reuses an existing account without a passport', async () => {
  users = [{ id: 99, managed_by_agent_row_id: 12, handle: null }];
  fireEvent.click(await renderOwner());
  await screen.findByRole('button', { name: 'Паспорт выдан' });
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith('/users/99/passport', {});
});

it('does not offer issuance for an existing passport', async () => {
  users = [{ id: 99, managed_by_agent_row_id: 12, handle: 'agent' }];
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  expect(await screen.findByRole('button', { name: 'Паспорт выдан' })).toBeDisabled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('blocks repeated clicks while issuance is pending', async () => {
  users = [{ id: 99, managed_by_agent_row_id: 12 }];
  vi.mocked(apiClient.post).mockImplementation(() => new Promise(() => {}));
  const button = await renderOwner();
  fireEvent.click(button);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

it.each([false, true])('coalesces a double-click before React renders, existing account: %s', async existing => {
  if (existing) users = [{ id: 99, managed_by_agent_row_id: 12 }];
  const post = vi.mocked(apiClient.post).getMockImplementation()!;
  vi.mocked(apiClient.post).mockImplementation(async (url, body) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    return post(url, body);
  });
  const button = await renderOwner();
  fireEvent.change(screen.getByLabelText('Основная инструкция'), { target: { value: 'Unsaved' } });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  await screen.findByRole('button', { name: 'Паспорт выдан' }, { timeout: 2000 });
  expect(vi.mocked(apiClient.post).mock.calls.filter(([url]) => url.endsWith('/passport'))).toHaveLength(1);
  expect(vi.mocked(apiClient.post).mock.calls.filter(([url]) => url === '/users/create-agent-user')).toHaveLength(existing ? 0 : 1);
  expect(screen.getByLabelText('Основная инструкция')).toHaveValue('Unsaved');
  expect(apiClient.put).not.toHaveBeenCalled();
});

it('does not issue a passport when account creation is refused', async () => {
  vi.mocked(apiClient.post).mockResolvedValue({ success: false, error: { message: 'Account creation refused' } });
  fireEvent.click(await renderOwner());
  expect(await screen.findByRole('alert')).toHaveTextContent('Account creation refused');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

it.each(['global_role_required', 'space_admin_required', 'agent_principal', 'residence_not_found', 'not_authenticated'])('hides passport actions for server denial %s even for the local owner', async reason => {
  authority = { allowed: false, reason, space: { id: 11 } };
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  await screen.findByLabelText('Основная инструкция');
  expect(screen.queryByRole('button', { name: /паспорт/i })).not.toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith('/users/agents?spaceId=11');
});

it('reuses the created account when retrying a failed issuance', async () => {
  const post = vi.mocked(apiClient.post).getMockImplementation()!;
  let fail = true;
  vi.mocked(apiClient.post).mockImplementation(async (url, body) => {
    if (url.endsWith('/passport') && fail) { fail = false; throw new Error('Passport unavailable'); }
    return post(url, body);
  });
  fireEvent.click(await renderOwner());
  expect(await screen.findByRole('alert')).toHaveTextContent('Passport unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Выдать паспорт' }));
  await screen.findByRole('button', { name: 'Паспорт выдан' });
  expect(vi.mocked(apiClient.post).mock.calls.filter(([url]) => url === '/users/create-agent-user')).toHaveLength(1);
});

it('fails closed when passport state cannot be loaded and allows retry', async () => {
  const get = vi.mocked(apiClient.get).getMockImplementation()!;
  vi.mocked(apiClient.get).mockImplementation(async url => {
    if (url.startsWith('/users/agents?')) throw new Error('State unavailable');
    return get(url);
  });
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('State unavailable');
  expect(screen.getByRole('button', { name: 'Выдать паспорт' })).toBeDisabled();
  vi.mocked(apiClient.get).mockImplementation(get);
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать паспорт' })).toBeEnabled());
});

it('refreshes already-cached mention and identity lists after issuance without remounting', async () => {
  const { QueryClient, QueryObserver } = await import('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const keys = [['users-for-mentions', 11], ['users-for-mentions', 12], ['chat-space-users', 11], ['chat-all-users']];
  const observers = keys.map(queryKey => new QueryObserver(client, {
    queryKey, queryFn: async () => users.filter(user => user.handle),
  }));
  const unsubscribe = observers.map(observer => observer.subscribe(() => {}));
  try {
    await waitFor(() => keys.forEach(key => expect(client.getQueryData(key)).toEqual([])));
    renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />, { queryClient: client });
    const button = await screen.findByRole('button', { name: 'Выдать паспорт' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByRole('button', { name: 'Паспорт выдан' });
    await waitFor(() => keys.forEach(key => expect(client.getQueryData(key)).toEqual([
      { id: 99, managed_by_agent_row_id: 12, handle: 'agent' },
    ])));
  } finally {
    unsubscribe.forEach(stop => stop());
    client.clear();
  }
});

it('uses server permission for a local viewer and the row residence instead of chat space', async () => {
  access.accessLevel = 'viewer';
  await renderOwner();
  expect(apiClient.get).toHaveBeenCalledWith('/users/passport-authority?row_id=12');
  expect(apiClient.get).not.toHaveBeenCalledWith('/users/passport-authority?space_id=7809');
});

it('fails closed during authority loading and lets the user retry an authority error', async () => {
  const get = vi.mocked(apiClient.get).getMockImplementation()!;
  let rejectAuthority!: (error: Error) => void;
  vi.mocked(apiClient.get).mockImplementation(url => url.includes('passport-authority')
    ? new Promise((_resolve, reject) => { rejectAuthority = reject; }) : get(url));
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  await screen.findByLabelText('Основная инструкция');
  expect(screen.queryByRole('button', { name: 'Выдать паспорт' })).not.toBeInTheDocument();
  await act(async () => rejectAuthority(new Error('Offline')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить права на паспорт');
  vi.mocked(apiClient.get).mockImplementation(get);
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Выдать паспорт' })).toBeEnabled());
});

it('refreshes authority and accounts even when issuance fails after account creation', async () => {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const post = vi.mocked(apiClient.post).getMockImplementation()!;
  vi.mocked(apiClient.post).mockImplementation((url, body) => url.endsWith('/passport')
    ? Promise.reject(new Error('Permission changed')) : post(url, body));
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />, { queryClient });
  const button = await screen.findByRole('button', { name: 'Выдать паспорт' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByText('Permission changed');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['passport-authority'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agent-roster', 'agent-users'] });
});

it('loads passport accounts from the server residence when it differs from the displayed space', async () => {
  renderWithProviders(<AgentConfigurationFields agent={{ ...agent, space_id: 7809 }} operators={[]} disabled={false} />);
  const button = await screen.findByRole('button', { name: 'Выдать паспорт' });
  await waitFor(() => expect(button).toBeEnabled());
  expect(apiClient.get).toHaveBeenCalledWith('/users/agents?spaceId=11');
  expect(apiClient.get).not.toHaveBeenCalledWith('/users/agents?spaceId=7809');
});
