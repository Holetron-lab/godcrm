import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { spacesApi } from '../../api/spacesApi';
import { useSpacesStore } from '../../store/spacesStore';
import type { SpaceModel } from '../../types/space.types';
import { useSpaceAccessLevel } from '../useSpaceAccessLevel';
import { useSpacesQuery } from '../useSpacesQuery';

const space: SpaceModel = {
  id: 5, owner_id: 1, name: 'Shared space', type: 'business',
  created_at: '', updated_at: '', user_access_level: 'viewer',
};
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  focusManager.setFocused(true);
  useAuthStore.setState({ user: { id: '77', email: 'viewer@example.test', name: 'Viewer', role: 'viewer' } });
  useSpacesStore.setState({ spaces: [space] });
});
afterEach(() => {
  cleanup();
  client.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('space role refresh', () => {
  it('updates mounted permissions on promotion, demotion and removal', () => {
    const { result } = renderHook(() => useSpaceAccessLevel(5), { wrapper });
    expect(result.current.canManageSpace).toBe(false);
    act(() => useSpacesStore.getState().updateSpace(5, { user_access_level: 'admin' }));
    expect(result.current.canManageSpace).toBe(true);
    act(() => useSpacesStore.getState().setSpaces([space]));
    expect(result.current.canManageSpace).toBe(false);
    act(() => useSpacesStore.getState().removeSpace(5));
    expect(result.current.canView).toBe(false);
  });

  it('refreshes a still-fresh role on return to the tab and updates a separate consumer', async () => {
    const list = vi.spyOn(spacesApi, 'list').mockResolvedValue([space]);
    const access = renderHook(() => useSpaceAccessLevel(5), { wrapper });
    const query = renderHook(() => useSpacesQuery(), { wrapper });
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true));
    expect(access.result.current.canManageSpace).toBe(false);
    list.mockResolvedValue([{ ...space, user_access_level: 'admin' }]);
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(access.result.current.canManageSpace).toBe(true));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('rechecks roles in an active tab without polling in the background', async () => {
    vi.useFakeTimers();
    const list = vi.spyOn(spacesApi, 'list').mockResolvedValue([space]);
    renderHook(() => useSpacesQuery(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue([{ ...space, user_access_level: 'admin' }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(useSpacesStore.getState().spaces[0].user_access_level).toBe('admin');
    expect(list).toHaveBeenCalledTimes(2);
    act(() => focusManager.setFocused(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(list).toHaveBeenCalledTimes(2);
  });
});
