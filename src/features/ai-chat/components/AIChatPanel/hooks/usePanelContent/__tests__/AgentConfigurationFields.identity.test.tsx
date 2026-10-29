import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTestQueryClient, renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { AgentConfigurationFields } from '../AgentConfigurationFields';
import type { AIAgent } from '@/features/ai-chat/types';
import { MentionUsersProvider, useMentionUsers } from '@/features/ai-chat/components/MentionUsersContext';

vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ loadAgents: vi.fn(), spaceId: 11 }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }));
const agent = { id: 12, table_id: 1784, name: 'Stale name' } as AIAgent;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.get).mockImplementation(async url => url.includes('passport-authority')
    ? { success: true, data: { allowed: false, reason: 'global_role_required', space: { id: 11 } } }
    : { success: true, data: { row: { data: { name: 'Reviewer', slug: 'reviewer', icon: '🤖' } } } });
  vi.mocked(apiClient.put).mockResolvedValue({ success: true });
});

it('groups emoji and color before the authoritative name and slug', async () => {
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  const name = await screen.findByLabelText('Имя агента');
  expect(name).toHaveValue('Reviewer');
  expect(screen.getByLabelText('Slug агента')).toHaveValue('reviewer');
  const color = screen.getByLabelText('Цвет аватара');
  expect(screen.getByLabelText('Эмодзи аватара').compareDocumentPosition(color) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(color.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('sends one atomic configuration request for identity and other edited fields', async () => {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const dirty = vi.fn();
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} onDirtyChange={dirty} />, { queryClient });
  fireEvent.change(await screen.findByLabelText('Имя агента'), { target: { value: '  New reviewer  ' } });
  fireEvent.change(screen.getByLabelText('Slug агента'), { target: { value: 'new-reviewer' } });
  fireEvent.change(screen.getByLabelText('Цвет аватара'), { target: { value: '#123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  expect(apiClient.put).toHaveBeenCalledExactlyOnceWith('/ai/agents/12/configuration', { data: { name: 'New reviewer', slug: 'new-reviewer', color: '#123456' } });
  for (const key of [['agent-roster'], ['users-for-mentions'], ['chat-space-users'], ['chat-all-users']]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  }
});

it.each([['Имя агента', '   '], ['Slug агента', ''], ['Slug агента', 'Taken Name'], ['Slug агента', '@agent']])('rejects invalid %s: %s without writing', async (label, value) => {
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
  expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  expect(apiClient.put).not.toHaveBeenCalled();
});

it.each(['Slug already taken', 'Not found', 'Permission denied'])('preserves the full draft on server refusal: %s', async message => {
  vi.mocked(apiClient.put).mockRejectedValue(new Error(message));
  const dirty = vi.fn();
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} onDirtyChange={dirty} />);
  fireEvent.change(await screen.findByLabelText('Имя агента'), { target: { value: 'New reviewer' } });
  fireEvent.change(screen.getByLabelText('Slug агента'), { target: { value: 'taken' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText('Имя агента')).toHaveValue('New reviewer');
  expect(screen.getByLabelText('Slug агента')).toHaveValue('taken');
  expect(dirty).not.toHaveBeenCalledWith(false);
  expect(apiClient.put).toHaveBeenCalledTimes(1);
});

it('does not regenerate the slug when only the name is changed', async () => {
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  fireEvent.change(await screen.findByLabelText('Имя агента'), { target: { value: 'Новое имя' } });
  expect(screen.getByLabelText('Slug агента')).toHaveValue('reviewer');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/ai/agents/12/configuration', { data: { name: 'Новое имя' } }));
});

function EvokeIdentity() {
  const { getBySlug } = useMentionUsers();
  return <output aria-label="Имя в эвоке">{getBySlug('reviewer')?.name}</output>;
}

it('refreshes an already mounted evoke after renaming without changing its handle', async () => {
  let name = 'Reviewer';
  vi.mocked(apiClient.get).mockImplementation(async url => {
    if (url.includes('passport-authority')) return { success: true, data: { allowed: false, reason: 'global_role_required', space: { id: 11 } } };
    if (url === '/users') return { success: true, data: [{ id: 99, name, managed_by_agent_row_id: 12 }] };
    if (url.startsWith('/ai/agents?')) return { success: true, data: { agents: [{ ...agent, name, agent_slug: 'reviewer' }], total: 1 } };
    return { success: true, data: { row: { data: { name, slug: 'reviewer' } } } };
  });
  vi.mocked(apiClient.put).mockImplementation(async () => {
    name = 'Новое имя';
    return { success: true };
  });
  renderWithProviders(<>
    <AgentConfigurationFields agent={agent} operators={[]} disabled={false} />
    <MentionUsersProvider agents={[]} mentionUsers={[{ id: 99, name: 'Reviewer', handle: 'reviewer', type: 'bot' }]}>
      <EvokeIdentity />
    </MentionUsersProvider>
  </>);
  await waitFor(() => expect(screen.getByLabelText('Имя в эвоке')).toHaveTextContent('Reviewer'));
  fireEvent.change(screen.getByLabelText('Имя агента'), { target: { value: 'Новое имя' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(screen.getByLabelText('Имя в эвоке')).toHaveTextContent('Новое имя'));
});
