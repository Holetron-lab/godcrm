import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../authStore';
import { apiClient } from '@/shared/utils/apiClient';
import { authApi } from '@/features/auth/api/authApi';

vi.mock('@/features/auth/api/authApi', () => ({
  authApi: {
    login: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  }
}));

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiClient.setAccessToken(null);
    useAuthStore.setState({ user: null, token: null, loading: false, error: null, initialized: false });
  });

  it('stores token on login', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      data: {
        accessToken: 'jwt-token',
        user: { id: '1', email: 'user@test.com', name: 'User', role: 'owner' }
      }
    } as any);

    await useAuthStore.getState().login({ email: 'user@test.com', password: 'password123' });
    expect(useAuthStore.getState().token).toBe('jwt-token');
    expect(apiClient.getAccessToken()).toBe('jwt-token');
  });

  it('hydrates user during initialize when token exists', async () => {
    useAuthStore.setState({ token: 'existing', user: null, loading: false, error: null, initialized: false });
    vi.mocked(authApi.me).mockResolvedValueOnce({
      data: {
        accessToken: 'existing',
        user: { id: '1', email: 'owner@test.com', name: 'Owner', role: 'owner' }
      }
    } as any);

    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().user?.email).toBe('owner@test.com');
    expect(useAuthStore.getState().initialized).toBe(true);
  });

  it('refreshes session from cookie when no token is stored', async () => {
    vi.mocked(authApi.refresh).mockResolvedValueOnce({
      data: {
        accessToken: 'refresh-token',
        user: { id: '2', email: 'cookie@test.com', name: 'Cookie', role: 'member' }
      }
    } as any);

    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().token).toBe('refresh-token');
    expect(useAuthStore.getState().user?.email).toBe('cookie@test.com');
    expect(useAuthStore.getState().initialized).toBe(true);
  });
});
