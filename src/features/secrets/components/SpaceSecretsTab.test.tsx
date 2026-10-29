import { screen, waitFor, cleanup } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SpaceSecretsTab } from './SpaceSecretsTab';
import { secretsApi } from '../api/secretsApi';

const access = vi.hoisted(() => ({ isOwner: true, canManageSpace: true, loading: false }));
vi.mock('@/features/spaces/hooks/useSpaceAccessLevel', () => ({
  useSpaceAccessLevel: () => access,
}));
vi.mock('../api/secretsApi', () => ({ secretsApi: { list: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); Object.assign(access, { isOwner: true, canManageSpace: true, loading: false }); });

describe.each(['en', 'ru'] as const)('space role gate in %s', (language) => {
  it('lets a space admin who is not the owner load secrets and open the translated form', async () => {
    Object.assign(access, { isOwner: false, canManageSpace: true });
    vi.mocked(secretsApi.list).mockResolvedValue({ table_id: 4242, secrets: [] });
    render(<MemoryRouter><SpaceSecretsTab spaceId={11} /></MemoryRouter>, { language });
    await waitFor(() => expect(secretsApi.list).toHaveBeenCalledWith(11));
    await userEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Add secret' : 'Добавить секрет' }));
    expect(screen.getByRole('textbox', { name: language === 'en' ? 'Key' : 'Ключ' })).toBeInTheDocument();
  });

  it('shows the owner/admin restriction without requesting secrets for a non-admin', () => {
    Object.assign(access, { isOwner: false, canManageSpace: false });
    render(<MemoryRouter><SpaceSecretsTab spaceId={11} /></MemoryRouter>, { language });
    expect(screen.getByText(language === 'en' ? 'Access restricted' : 'Доступ ограничен')).toBeInTheDocument();
    expect(screen.getByText(language === 'en' ? /space owner and space admins/ : /владелец и администраторы пространства/)).toBeInTheDocument();
    expect(secretsApi.list).not.toHaveBeenCalled();
  });
});

describe('secret modal focus', () => {
  it.each(['add', 'edit'])('lets Modal manage the initial field focus when opening %s', async (mode) => {
    const user = userEvent.setup();
    vi.mocked(secretsApi.list).mockResolvedValue({ table_id: 4242, secrets: [{
      key: 'test_key', description: 'Test description', last_revealed_at: null,
      created_at: '2026-09-25', updated_at: '2026-09-25',
    }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><SpaceSecretsTab spaceId={11} /></MemoryRouter></QueryClientProvider>);
    await screen.findByText('test_key');
    await user.click(mode === 'add'
      ? screen.getByRole('button', { name: 'Добавить секрет' })
      : screen.getByRole('button', { name: 'Редактировать' }));
    const input = screen.getByRole('textbox', { name: mode === 'add' ? 'Ключ' : 'Описание' });
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, 'draft');
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('space secret lists', () => {
  it('requests the current space and never displays another space cache while loading', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(secretsApi.list).mockImplementation(async (spaceId) => spaceId === 11 ? { table_id: 4242, secrets: [{
      key: 'development_only', description: '', last_revealed_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }] } : { table_id: 4343, secrets: [] });
    const view = (spaceId: number) => <QueryClientProvider client={client}>
      <MemoryRouter><SpaceSecretsTab key={spaceId} spaceId={spaceId} /></MemoryRouter>
    </QueryClientProvider>;
    const { rerender } = render(view(11));
    await screen.findByText('development_only');
    // ADR-0040 §space-secrets — the tab links to this space's Secrets system table.
    expect(screen.getByRole('link', { name: /Таблица пространства/ })).toHaveAttribute('href', '/tables/4242');
    rerender(view(773));
    expect(screen.queryByText('development_only')).not.toBeInTheDocument();
    await waitFor(() => expect(secretsApi.list).toHaveBeenCalledWith(773));
    expect(client.getQueryData<{ secrets: unknown[] }>(['secrets', 'list', 11])?.secrets).toHaveLength(1);
    await waitFor(() => expect(client.getQueryData(['secrets', 'list', 773])).toEqual({ table_id: 4343, secrets: [] }));
    expect(screen.getByRole('link', { name: /Таблица пространства/ })).toHaveAttribute('href', '/tables/4343');
  });
});
