import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createTestQueryClient, renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { UserAccessPanel } from '../UserAccessPanel';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));

beforeEach(() => {
  vi.mocked(apiClient.request).mockReset();
  vi.mocked(apiClient.request).mockImplementation(async (url, options) => {
    if (options?.method) return { success: true };
    if (url.endsWith('/settings')) return { data: { access_control: { enabled: true, users_table_id: 90, role_column_id: 'role', role_mappings: [] } } };
    if (url.includes('/available-users')) return { data: { users: [{ id: 24, name: 'Architect', avatar: '/architect.png', color: '#14b8a6', agent_icon: '🔍', user_type: 'agent' }] } };
    if (url.startsWith('/tables/90/rows?')) return { data: { rows: [{ id: '7', data: { system_user_id: 24, name: 'Architect', email: 'architect@example.test', role: 'admin', active: true, project_viewer: ['44'] } }] } };
    if (url === '/tables/90/columns') return { data: ['system_user_id', 'name', 'email', 'role', 'active'].map(name => ({ id: name, name, type: 'text' })) };
    if (url.endsWith('/tables')) return { data: { tables: [], default_table_id: 90 } };
    return { data: [] };
  });
});

it('shows member identity in a compact list and expands the access map independently of role edits', async () => {
  renderWithProviders(<UserAccessPanel entityType="space" entityId={11} spaceId={11} currentUserLevel="owner_owner" />, { language: 'en' });
  fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
  const avatar = await screen.findByRole('img', { name: 'Architect' });
  expect(avatar).toHaveAttribute('src', '/architect.png');
  const list = screen.getByRole('list', { name: 'Users' });
  expect(list).toContainElement(avatar);
  expect(list).toContainElement(screen.getByText('Agent'));
  expect(list).toContainElement(screen.getByText('(#24)'));
  const toggle = screen.getByRole('button', { name: 'Access map: Architect' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Granular access for Architect')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Granular access for Architect')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Role: Architect' }), { target: { value: 'viewer' } });
  await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith('/tables/90/rows/7', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ data: { role: 'viewer' } }) })));
  fireEvent.click(toggle);
  expect(screen.queryByText('Granular access for Architect')).not.toBeInTheDocument();
  fireEvent.error(avatar);
  expect(screen.getByLabelText('Architect')).toHaveTextContent('🔍');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search by name, email or ID...' }), { target: { value: 'missing' } });
  expect(screen.getByText('No matching users')).toBeVisible();
});

it('reports a failed member list instead of showing an empty list', async () => {
  const request = vi.mocked(apiClient.request).getMockImplementation()!;
  vi.mocked(apiClient.request).mockImplementation((url, options) => url.startsWith('/tables/90/rows?')
    ? Promise.reject(new Error('Unavailable')) : request(url, options));
  renderWithProviders(<UserAccessPanel entityType="space" entityId={11} spaceId={11} currentUserLevel="owner_owner" />, { language: 'en' });
  fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load users');
  expect(screen.queryByText('No users in the table')).not.toBeInTheDocument();
});


it('invalidates cached mention membership after removing a member', async () => {
  const client = createTestQueryClient();
  client.setQueryDefaults(['users-for-mentions'], { gcTime: Infinity });
  client.setQueryData(['users-for-mentions', 11], [{ id: 24 }]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderWithProviders(<UserAccessPanel entityType="space" entityId={11} spaceId={11} currentUserLevel="owner_owner" />, { language: 'en', queryClient: client });
  fireEvent.click(await screen.findByRole('button', { name: 'Delete user: Architect' }));
  await waitFor(() => expect(client.getQueryState(['users-for-mentions', 11])?.isInvalidated).toBe(true));
  expect(apiClient.request).toHaveBeenCalledWith('/tables/90/rows/7', { method: 'DELETE' });
  vi.restoreAllMocks();
});

it('keeps an empty member list usable for adding participants', async () => {
  const request = vi.mocked(apiClient.request).getMockImplementation()!;
  vi.mocked(apiClient.request).mockImplementation((url, options) => url.startsWith('/tables/90/rows?')
    ? Promise.resolve({ data: { rows: [] } }) : request(url, options));
  renderWithProviders(<UserAccessPanel entityType="space" entityId={11} spaceId={11} currentUserLevel="owner_owner" />, { language: 'en' });
  expect(await screen.findByText('No users in the table')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
});

it('loads every table page and displays members in batches of 50 with search below Add', async () => {
  const request = vi.mocked(apiClient.request).getMockImplementation()!;
  vi.mocked(apiClient.request).mockImplementation((url, options) => {
    if (url.startsWith('/tables/90/rows')) {
      const page = Number(new URL(url, 'https://test.local').searchParams.get('page') || 1);
      return Promise.resolve({ data: {
        rows: Array.from({ length: page === 3 ? 1 : 50 }, (_, i) => {
          const id = (page - 1) * 50 + i + 1;
          return { id: String(id), data: { system_user_id: id, name: `Member ${id}`, role: 'viewer', active: true } };
        }), pagination: { page, limit: 50, total: 101, pages: 3 },
      } });
    }
    return request(url, options);
  });
  renderWithProviders(<UserAccessPanel entityType="space" entityId={11} spaceId={11} currentUserLevel="owner_owner" />, { language: 'en' });
  expect(await screen.findByText('Member 50')).toBeVisible();
  expect(screen.queryByText('Member 51')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load 50 more' }));
  expect(await screen.findByText('Member 100')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Load 50 more' }));
  expect(await screen.findByText('Member 101')).toBeVisible();
  const search = screen.getByRole('textbox', { name: 'Search by name, email or ID...' });
  expect(screen.getByRole('button', { name: 'Add' }).compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(search, { target: { value: 'Member 101' } });
  expect(screen.getByText('Member 101')).toBeVisible();
  expect(screen.queryByText('Member 1')).not.toBeInTheDocument();
});

it('reports a failed later page instead of presenting a partial member list as complete', async () => {
  const request = vi.mocked(apiClient.request).getMockImplementation()!;
  vi.mocked(apiClient.request).mockImplementation((url, options) => {
    if (url.includes('/rows?page=2')) return Promise.reject(new Error('Page unavailable'));
    if (url.includes('/rows?page=1')) return Promise.resolve({ data: { rows: [{ id: '1', data: { system_user_id: 1, name: 'Partial member' } }], pagination: { pages: 2 } } });
    return request(url, options);
  });
  renderWithProviders(<UserAccessPanel entityType="space" entityId={11} spaceId={11} currentUserLevel="owner_owner" />, { language: 'en' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load users');
  expect(screen.queryByText('Partial member')).not.toBeInTheDocument();
});
