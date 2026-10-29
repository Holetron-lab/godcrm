import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import { MentionUsersProvider } from '../MentionUsersContext';
import { HighlightedText } from '../HighlightedText';
import { ValidSlugsProvider } from '../../context/ValidSlugsContext';
import { MentionPill } from '../InvocationPills';
import { TurnHeader } from '../AIChatPanel/components/ChatMessages/ChatTurn/TurnHeader';

const agent = { id: 123, name: 'Remote Agent', agent_slug: 'remote-helper', icon: '🦊', color: '#cc5500', is_active: false };
const users = [{ id: 7, name: agent.name, managed_by_agent_row_id: 123, agent_icon: '🦊', agent_color: '#cc5500' }, { id: 8, name: 'Human' }];
let members: { id: number; role: string }[];
let failAccess = false;

beforeEach(() => {
  vi.restoreAllMocks();
  members = [{ id: 7, role: 'writer' }];
  failAccess = false;
  useSpacesStore.setState({ currentSpace: null, activeSpaceId: 11, spaces: [{ id: 11, name: 'Development', owner_id: 8, type: 'team', created_at: '', updated_at: '', access_control: { enabled: true, mode: 'roles', usersTableId: 10, userIdColumn: 'id', userNameColumn: 'name', roleColumn: 'role', roleMapping: { owner: [], admin: [], editor: ['writer'], viewer: [], denied: [] } } }] });
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (url === '/users') return { success: true, data: users };
    if (url.startsWith('/ai/agents?')) return { success: true, data: { agents: [agent], total: 1 } };
    if (failAccess) throw new Error('Unavailable');
    if (url.endsWith('/available-users')) return { success: true, data: { users: members } };
    if (url.endsWith('/permissions')) return { success: true, data: [] };
    throw new Error(`Unexpected URL ${url}`);
  });
});

describe('cross-space identity and shared hover card', () => {
  it.each([
    ['admin', 'admin', 'Администратор'],
    [' Writer ', 'editor', 'Редактор'],
    ['blocked', 'denied', 'Заблокирован'],
  ])('shows the stored API role mapping for %s', async (role, accessLevel, label) => {
    members = [{ id: 7, role }];
    // The stored API contract differs from the legacy editor's roleMapping object.
    useSpacesStore.setState(state => ({ spaces: state.spaces.map(space => ({
      ...space,
      access_control: {
        enabled: true, users_table_id: 1782, role_column_id: '13257',
        role_mappings: [{ columnValue: role.trim().toLowerCase(), accessLevel }],
      } as unknown as typeof space.access_control,
    })) }));
    renderWithProviders(<MentionUsersProvider agents={[]}><MentionPill slug="remote-helper" /></MentionUsersProvider>);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('🦊'));
    fireEvent.focus(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(`Development: ${label}`));
  });

  it('renders canonical remote agent icon/color even with no local agents', async () => {
    renderWithProviders(<MentionUsersProvider agents={[]}><MentionPill slug="remote-helper" /></MentionUsersProvider>);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('🦊'));
    const loadedPill = screen.getByRole('button');
    expect(loadedPill.style.borderColor).toBe('rgb(204, 85, 0)');
    fireEvent.focus(loadedPill);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Неактивен');
    await waitFor(() => expect(tooltip).toHaveTextContent('Редактор'));
    fireEvent.keyDown(loadedPill, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the same card from an avatar, with absent membership distinct from failure', async () => {
    members = [];
    renderWithProviders(<MentionUsersProvider agents={[]}><TurnHeader turnType="agent" senderName="Remote Agent" senderUserId={7} timestamp="12:00" /></MentionUsersProvider>);
    const avatar = screen.getByRole('button', { name: /Remote Agent/ });
    await userEvent.hover(avatar);
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Не добавлен в спейс'));
  });

  it('shows the human owner and never confuses their role with the viewer', async () => {
    renderWithProviders(<MentionUsersProvider agents={[]}><TurnHeader turnType="human" senderName="Human" senderUserId={8} timestamp="12:00" /></MentionUsersProvider>);
    fireEvent.focus(screen.getByRole('button', { name: /Human/ }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Владелец-создатель'));
  });

  it('reports failed access lookup without claiming non-membership', async () => {
    failAccess = true;
    renderWithProviders(<MentionUsersProvider agents={[]}><MentionPill slug="remote-helper" /></MentionUsersProvider>);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('🦊'));
    fireEvent.focus(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Не удалось загрузить уровень'));
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Не добавлен');
  });
  it('resolves a legacy agent avatar by agent row ID without a sender user ID', async () => {
    renderWithProviders(<MentionUsersProvider agents={[]}><TurnHeader turnType="agent" senderName="Old Name" agentRowId={123} timestamp="12:00" /></MentionUsersProvider>);
    fireEvent.focus(screen.getByRole('button', { name: /Old Name/ }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Редактор'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Remote Agent');
  });

  it('does not reuse membership from a previous space', async () => {
    const { act } = await import('@testing-library/react');
    renderWithProviders(<MentionUsersProvider agents={[]}><MentionPill slug="remote-helper" /></MentionUsersProvider>);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('🦊'));
    fireEvent.focus(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Редактор'));
    members = [];
    act(() => useSpacesStore.setState(state => ({ activeSpaceId: 12, spaces: [...state.spaces, { ...state.spaces[0], id: 12, name: 'Other space' }] })));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Other space: Не добавлен в спейс'));
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Редактор');
  });

  it('preserves historical references outside the current picker roster', async () => {
    renderWithProviders(<ValidSlugsProvider mentionUsers={[{ id: 2, name: 'Local User', type: 'human' }]} slashAgents={[{ id: 3, name: 'Local Agent', type: 'agent' }]}><MentionUsersProvider agents={[]}>
      <HighlightedText text="@remote-helper /remote-helper @unknown" />
    </MentionUsersProvider></ValidSlugsProvider>);
    await waitFor(() => expect(screen.getByTitle('Упоминание: @remote-helper')).toHaveTextContent('🦊'));
    expect(screen.getByRole('button', { name: '/remote-helper' })).toBeInTheDocument();
    expect(screen.queryByTitle('Упоминание: @unknown')).not.toBeInTheDocument();
  });

  it('uses the panel space even when the persisted selection points elsewhere', async () => {
    members = [];
    useSpacesStore.setState(state => ({ spaces: [...state.spaces, { ...state.spaces[0], id: 12, name: 'Panel space' }] }));
    renderWithProviders(<MentionUsersProvider agents={[]} spaceId={12}><MentionPill slug="remote-helper" /></MentionUsersProvider>);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('🦊'));
    fireEvent.focus(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Panel space: Не добавлен в спейс'));
    expect(apiClient.get).not.toHaveBeenCalledWith('/access/space/11/available-users');
  });

});
