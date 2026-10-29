import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTestQueryClient, renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { AgentRowWidget } from '../AgentRowWidget';
import type { PresetWidgetProps } from '../../../types/widget.types';

vi.mock('@/features/spaces/store/spacesStore', () => ({ useCurrentSpace: () => ({ id: 11 }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const widget = { config: { space_id: 7809 } } as unknown as PresetWidgetProps['widget'];
let allowed: boolean;
let handle: string | null;

beforeEach(() => {
  vi.resetAllMocks();
  allowed = true;
  handle = null;
  vi.mocked(apiClient.get).mockImplementation(async url => {
    if (url === '/users/passport-authority?space_id=7809') return {
      success: true, data: { allowed, reason: allowed ? 'ok' : 'space_admin_required', space: { id: 7809 } },
    };
    if (url === '/ai/agents/7809') return { success: true, data: { agents: [
      { id: 12, name: 'Agent A' }, { id: 13, name: 'Agent B' },
    ] } };
    if (url === '/users/agents?spaceId=7809') return { success: true, data: [
      { id: 99, managed_by_agent_row_id: 12, handle }, { id: 100, managed_by_agent_row_id: 13 },
    ] };
    throw new Error(`Unexpected GET ${url}`);
  });
  vi.mocked(apiClient.post).mockResolvedValue({ success: true });
  vi.mocked(apiClient.delete).mockResolvedValue({ success: true });
});

it('queries the configured space once for the whole roster and invalidates authority after issue', async () => {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  renderWithProviders(<AgentRowWidget widget={widget} data={[]} />, { queryClient });
  await userEvent.click(await screen.findByRole('button', { name: 'Действия: Agent A' }));
  expect(vi.mocked(apiClient.get).mock.calls.filter(([url]) => url.includes('passport-authority'))).toEqual([
    ['/users/passport-authority?space_id=7809'],
  ]);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Выдать паспорт' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/users/99/passport', {}));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['passport-authority'] });
});

it('hides actions and explains a server denial', async () => {
  allowed = false;
  renderWithProviders(<AgentRowWidget widget={widget} data={[]} />);
  expect(await screen.findByRole('status')).toHaveTextContent('нужны права администратора в спейсе проживания агента');
  expect(screen.queryByRole('button', { name: /Действия:/ })).not.toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith('/users/agents?spaceId=7809');
});

it('fails closed on an authority error and retries without affecting roster visibility', async () => {
  const get = vi.mocked(apiClient.get).getMockImplementation()!;
  vi.mocked(apiClient.get).mockImplementation(url => url.includes('passport-authority')
    ? Promise.reject(new Error('Offline')) : get(url));
  renderWithProviders(<AgentRowWidget widget={widget} data={[]} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить права на паспорт');
  expect(screen.getByText('Agent A')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Действия:/ })).not.toBeInTheDocument();
  vi.mocked(apiClient.get).mockImplementation(get);
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByRole('button', { name: 'Действия: Agent A' });
});

it('does not turn a failed account lookup into an actionable missing account', async () => {
  const get = vi.mocked(apiClient.get).getMockImplementation()!;
  vi.mocked(apiClient.get).mockImplementation(url => url.includes('/users/agents?')
    ? Promise.resolve({ success: false }) : get(url));
  renderWithProviders(<AgentRowWidget widget={widget} data={[]} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить паспорт агента');
  expect(screen.queryByRole('button', { name: /Действия:/ })).not.toBeInTheDocument();
});

it('refreshes authority after a rejected revoke and hides actions when permission changed', async () => {
  handle = 'agent-a';
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(apiClient.delete).mockImplementation(async () => {
    allowed = false;
    throw new Error('Permission changed');
  });
  renderWithProviders(<AgentRowWidget widget={widget} data={[]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Действия: Agent A' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Отозвать паспорт' }));
  await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/users/99/passport'));
  await waitFor(() => expect(screen.queryByRole('button', { name: /Действия:/ })).not.toBeInTheDocument());
  expect(await screen.findByRole('status')).toHaveTextContent('нужны права администратора');
});
