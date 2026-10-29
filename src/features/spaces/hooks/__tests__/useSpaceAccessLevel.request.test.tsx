import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useSpacesStore } from '../../store/spacesStore';
import type { AccessControlConfig, SpaceModel } from '../../types/space.types';
import { useSpaceAccessLevel } from '../useSpaceAccessLevel';

const config: AccessControlConfig = {
  enabled: true, mode: 'roles', usersTableId: 99, userIdColumn: 'user_id',
  userNameColumn: 'name', roleColumn: 'role',
  roleMapping: { owner: [], admin: ['boss'], editor: ['writer'], viewer: [], denied: ['banned'] }
};
const clients: QueryClient[] = [];
function mount(accessControl = config, backendLevel?: string) {
  useAuthStore.setState({ user: { id: '77', email: 'qa@example.test', name: 'QA', role: 'admin' } });
  const space: SpaceModel = {
    id: 5, owner_id: 1, name: 'S', type: 'business', created_at: '', updated_at: '',
    access_control: accessControl, user_access_level: backendLevel
  };
  useSpacesStore.setState({ spaces: [space] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return renderHook(() => useSpaceAccessLevel(5), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

describe('space role API fallback', () => {
  it('sends the v3 filter and reads the current user from rows[].data', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { rows: [{ data: { user_id: 77, role: 'writer' } }] } });
    const { result } = mount();
    await waitFor(() => expect(result.current.accessLevel).toBe('editor'));
    const url = new URL(get.mock.calls[0][0], 'https://example.test');
    expect(url.pathname).toBe('/tables/99/rows');
    expect(JSON.parse(url.searchParams.get('filter')!)).toEqual({ user_id: '77' });
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('mode')).toBe('raw');
  });
  it('supports snake_case column configuration', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { rows: [{ data: { account: '77', level: 'banned' } }] } });
    const snakeConfig = { ...config, users_table_id: 101, user_id_column: 'account', role_column: 'level' };
    const { result } = mount(snakeConfig);
    await waitFor(() => expect(result.current.accessLevel).toBe('denied'));
    const url = new URL(get.mock.calls[0][0], 'https://example.test');
    expect(url.pathname).toBe('/tables/101/rows');
    expect(JSON.parse(url.searchParams.get('filter')!)).toEqual({ account: '77' });
  });
  it.each([
    [{ data: { user_id: '88', role: 'boss' } }],
    [{ data: { user_id: '77', role: { name: 'boss' } } }],
    []
  ])('does not grant privileges for an unrelated, malformed or absent role: %j', async (...rows) => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { rows } });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accessLevel).toBe('viewer');
    expect(result.current.canManageSpace).toBe(false);
  });
  it('keeps the backend denial authoritative', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { rows: [{ data: { user_id: '77', role: 'boss' } }] } });
    const { result } = mount(config, 'denied');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accessLevel).toBe('denied');
  });
  it('falls back to viewer on a failed request', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('unavailable'));
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accessLevel).toBe('viewer');
  });
});
