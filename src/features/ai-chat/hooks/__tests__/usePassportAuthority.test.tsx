import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { useAuthStore } from '@/features/auth/store/authStore';
import { apiClient } from '@/shared/utils/apiClient';
import { usePassportAuthority } from '../usePassportAuthority';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
const permission = { allowed: true, reason: 'ok', space: { id: 11 } };
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ user: { id: '1', name: 'Owner', email: 'owner@example.test', role: 'owner' } });
  vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: permission });
});

it.each([undefined, { allowed: 'true', reason: 'ok' }, { allowed: true, reason: 'unknown' },
  { allowed: true, reason: 'space_admin_required', space: { id: 11 } },
  { allowed: true, reason: 'ok', space: null }])('fails closed on malformed authority: %j', async data => {
  vi.mocked(apiClient.get).mockResolvedValue({ success: true, data });
  const { result } = renderHook(() => usePassportAuthority('row_id', 12), { wrapper: ProvidersWrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.allowed).toBe(false);
});

it('does not reuse an allowed result across actors or targets', async () => {
  const { result, rerender } = renderHook(({ id }) => usePassportAuthority('row_id', id), {
    initialProps: { id: 12 }, wrapper: ProvidersWrapper,
  });
  await waitFor(() => expect(result.current.allowed).toBe(true));
  vi.mocked(apiClient.get).mockImplementation(() => new Promise(() => {}));
  act(() => useAuthStore.setState({ user: { id: '2', name: 'Viewer', email: 'viewer@example.test', role: 'viewer' } }));
  expect(result.current.allowed).toBe(false);
  rerender({ id: 13 });
  expect(result.current.allowed).toBe(false);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/users/passport-authority?row_id=13'));
});

it('revokes cached permission after a failed refetch', async () => {
  const { result } = renderHook(() => usePassportAuthority('row_id', 12), { wrapper: ProvidersWrapper });
  await waitFor(() => expect(result.current.allowed).toBe(true));
  vi.mocked(apiClient.get).mockRejectedValue(new Error('Offline'));
  await act(async () => { await result.current.refetch(); });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.allowed).toBe(false);
});
