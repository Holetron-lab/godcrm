import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/features/auth/store/authStore';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { apiClient } from '@/shared/utils/apiClient';
import type { Widget } from '../../../../types/widget.types';
import { Neo16Setup } from '../setup/Neo16Setup';
import { Neo16ModuleWidget } from '../town/TownWidget';
import { call } from '../learning/transport';
import { Neo16ApiError } from '../learning/types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), request: vi.fn() } }));
vi.mock('../learning/transport', () => ({ call: vi.fn() }));
vi.mock('../town/useWorld', () => ({ useWorld: () => ({ world: null, notice: null }) }));
const widget = { id: 4376, dashboard_id: 7739, config: {}, title: 'Neo16' } as Widget;
const installed = { ...widget, config: { __module: { key: 'neo16' } } };
const project = { id: 8427, space_id: 7829, name: 'Город' };
let dashboard: { project_id: number | null; space_id: number | null };
let role: string;
let projects: typeof project[];
const plan = {
  dry_run: true,
  plan: { tables: [{ name: 'neo16_worlds', action: 'create', columns_added: ['state'] }], seed: [],
    widgets: [{ widget_id: 4376, dashboard_id: 7739, action: 'adopt' }], conflicts: [] },
  npc_agents: { tables: [{ name: 'AI Agents', action: 'existing', columns_added: [] }],
    agents: [{ npc_key: 'nora', action: 'create' }], operator: { action: 'existing', provider: 'codex' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  dashboard = { project_id: 8427, space_id: null };
  role = 'owner_owner'; projects = [project];
  useAuthStore.setState({ user: { id: '1', name: 'Owner', email: 'owner@test.invalid', role: 'owner' } });
  vi.mocked(apiClient.get).mockImplementation(async (path) => ({ data: path.startsWith('/dashboards/') ? dashboard : installed }));
  vi.mocked(apiClient.request).mockImplementation(async (path) => ({ data: path === '/projects' ? projects : [
    { id: 7829, owner_id: 1, name: 'Space', user_access_level: role },
  ] }));
  vi.mocked(call).mockResolvedValue({ status: 200, body: plan });
});

function mount(ui?: React.ReactElement) {
  const onInstalled = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui ?? <Neo16Setup widget={widget} onInstalled={onInstalled} />}</QueryClientProvider>);
  return { onInstalled, client };
}
async function preview() { fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть изменения' })); }
async function apply() { fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить установку' })); }

it('previews on click, applies only after review, and refetches the same URL', async () => {
  const { onInstalled, client } = mount();
  await screen.findByRole('button', { name: 'Посмотреть изменения' });
  expect(call).not.toHaveBeenCalled();
  await preview();
  expect(await screen.findByText(/AI Agents: использовать существующую/)).toBeInTheDocument();
  expect(call).toHaveBeenLastCalledWith('POST', '/widgets/4376/install', { data: { project_id: 8427, dry_run: true } });
  await apply();
  await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(installed));
  expect(call).toHaveBeenLastCalledWith('POST', '/widgets/4376/install', { data: { project_id: 8427, dry_run: false } });
  expect(apiClient.get).toHaveBeenCalledWith('/widgets/4376');
  expect(client.getQueryData(['widget', 4376])).toEqual(installed);
});

it('offers only projects in the widget space and invalidates preview on selection change', async () => {
  dashboard = { project_id: null, space_id: 7829 };
  projects = [project, { ...project, id: 8428, name: 'Второй' }, { ...project, id: 999, space_id: 10, name: 'Чужой' }];
  mount();
  const select = await screen.findByLabelText('Проект для данных города');
  expect(screen.queryByRole('option', { name: 'Чужой' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Посмотреть изменения' })).toBeDisabled();
  fireEvent.change(select, { target: { value: '8427' } });
  await preview();
  await screen.findByRole('button', { name: 'Подтвердить установку' });
  fireEvent.change(select, { target: { value: '8428' } });
  expect(screen.queryByRole('button', { name: 'Подтвердить установку' })).not.toBeInTheDocument();
});

it('explains missing projects without allowing installation', async () => {
  dashboard = { project_id: null, space_id: 7829 }; projects = [];
  mount();
  expect(await screen.findByText(/нет доступных проектов/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Посмотреть изменения' })).toBeDisabled();
});

it('does not offer installation to a viewer', async () => {
  role = 'viewer'; mount();
  expect(await screen.findByText(/Обратитесь к нему/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Посмотреть изменения' })).not.toBeInTheDocument();
  expect(call).not.toHaveBeenCalled();
});

it('does not fetch private setup context on a public surface', () => {
  mount(<PublicViewProvider readOnly publicSlug="city"><Neo16Setup widget={widget} onInstalled={vi.fn()} /></PublicViewProvider>);
  expect(screen.getByText(/войдите как владелец/)).toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalled();
});

it('recovers context loading errors', async () => {
  vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку' }));
  expect(await screen.findByRole('button', { name: 'Посмотреть изменения' })).toBeEnabled();
});

it('keeps conflicts visible and never applies an unsuccessful preview', async () => {
  vi.mocked(call).mockRejectedValueOnce(new Neo16ApiError(409, 'AGENT_SETUP_CONFLICT', 'Incompatible AI Agents.model type'));
  mount(); await preview();
  expect(await screen.findByRole('alert')).toHaveTextContent('Incompatible AI Agents.model type');
  expect(screen.queryByRole('button', { name: 'Подтвердить установку' })).not.toBeInTheDocument();
});

it('refuses a plan that would create another widget', async () => {
  vi.mocked(call).mockResolvedValueOnce({ status: 200, body: { ...plan, plan: { ...plan.plan, widgets: [] } } });
  mount(); await preview();
  expect(await screen.findByRole('alert')).toHaveTextContent('Установка остановлена');
});

it('retries partial NPC setup without uninstall or premature town entry', async () => {
  const { onInstalled } = mount(); await preview();
  vi.mocked(call).mockRejectedValueOnce(new Neo16ApiError(409, 'NPC_SETUP_INCOMPLETE', 'partial'));
  await apply();
  expect(await screen.findByRole('alert')).toHaveTextContent('Город установлен, но создание NPC не завершено');
  expect(onInstalled).not.toHaveBeenCalled();
  await preview(); await apply();
  await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(installed));
  expect(call).toHaveBeenCalledTimes(4);
});

it('retries widget readback without applying installation again', async () => {
  const { onInstalled } = mount(); await preview();
  vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('readback offline'));
  await apply();
  fireEvent.click(await screen.findByRole('button', { name: 'Загрузить город' }));
  await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(installed));
  expect(call).toHaveBeenCalledTimes(2);
});

it('blocks repeated clicks while a request is pending', async () => {
  vi.mocked(call).mockImplementationOnce(() => new Promise(() => {}));
  mount(); await preview();
  fireEvent.click(screen.getByRole('button', { name: 'Подождите…' }));
  expect(call).toHaveBeenCalledTimes(1);
});

it('opens town after setup and lets an installed widget retry NPC setup after reload', async () => {
  mount(<Neo16ModuleWidget widget={widget} data={[]} />);
  await preview(); await apply();
  expect(await screen.findByLabelText('Neo16 town')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Настройка Neo16' }));
  expect(await screen.findByRole('button', { name: 'Посмотреть изменения' })).toBeInTheDocument();
});
