import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';
import { publicConfigApi, type PublicConfig } from '../api/publicConfigApi';

vi.mock('../api/publicConfigApi', () => ({ publicConfigApi: { get: vi.fn() } }));
vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

let client: QueryClient;
const config = (signup_mode: PublicConfig['signup_mode']) => ({
  success: true, data: { signup_mode, referral_enabled: signup_mode !== 'closed' },
});
const registrationLink = () => screen.queryByRole('link', { name: 'auth.login.register' });
const renderLogin = () => render(
  <QueryClientProvider client={client}>
    <MemoryRouter><LoginForm /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });

describe('login registration policy', () => {
  it('hides registration when the owner closes signup; login and recovery stay available', async () => {
    vi.mocked(publicConfigApi.get).mockResolvedValue(config('closed'));
    renderLogin();
    await waitFor(() => expect(publicConfigApi.get).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(registrationLink()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth.login.submit' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'auth.login.forgotPassword' })).toBeEnabled();
  });

  it.each(['open', 'invite'] as const)('allows signup in %s mode', async (mode) => {
    vi.mocked(publicConfigApi.get).mockResolvedValue(config(mode));
    renderLogin();
    expect(await screen.findByRole('link', { name: 'auth.login.register' })).toHaveAttribute('href', '/auth/register');
  });

  it('hides registration until the policy arrives', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof publicConfigApi.get>>) => void;
    vi.mocked(publicConfigApi.get).mockReturnValue(new Promise(done => { resolve = done; }));
    renderLogin();
    expect(registrationLink()).not.toBeInTheDocument();
    await act(async () => { resolve(config('open')); });
    expect(await screen.findByRole('link', { name: 'auth.login.register' })).toBeVisible();
  });

  it('revalidates cached permission on a new visit without flashing the signup link', async () => {
    client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
    vi.mocked(publicConfigApi.get).mockResolvedValue(config('open'));
    const firstVisit = renderLogin();
    await screen.findByRole('link', { name: 'auth.login.register' });
    firstVisit.unmount();
    let resolve!: (value: Awaited<ReturnType<typeof publicConfigApi.get>>) => void;
    vi.mocked(publicConfigApi.get).mockReturnValue(new Promise(done => { resolve = done; }));
    renderLogin();
    expect(registrationLink()).not.toBeInTheDocument();
    await act(async () => { resolve(config('closed')); });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(registrationLink()).not.toBeInTheDocument();
  });

  it.each(['error', 'unsuccessful', 'missing'] as const)('fails closed for a %s response', async (mode) => {
    if (mode === 'error') vi.mocked(publicConfigApi.get).mockRejectedValue(new Error('Unavailable'));
    else vi.mocked(publicConfigApi.get).mockResolvedValue(mode === 'unsuccessful'
      ? { ...config('open'), success: false }
      : { success: true, data: {} as PublicConfig });
    renderLogin();
    await waitFor(() => expect(publicConfigApi.get).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(registrationLink()).not.toBeInTheDocument();
  });

  it('removes an already visible link when a policy refresh closes signup or fails', async () => {
    vi.mocked(publicConfigApi.get).mockResolvedValue(config('open'));
    renderLogin();
    await screen.findByRole('link', { name: 'auth.login.register' });
    vi.mocked(publicConfigApi.get).mockResolvedValue(config('closed'));
    await act(async () => { await client.refetchQueries(); });
    await waitFor(() => expect(registrationLink()).not.toBeInTheDocument());
    vi.mocked(publicConfigApi.get).mockResolvedValue(config('open'));
    await act(async () => { await client.refetchQueries(); });
    await screen.findByRole('link', { name: 'auth.login.register' });
    vi.mocked(publicConfigApi.get).mockRejectedValue(new Error('Unavailable'));
    await act(async () => { await client.refetchQueries(); });
    await waitFor(() => expect(registrationLink()).not.toBeInTheDocument());
  });
});
