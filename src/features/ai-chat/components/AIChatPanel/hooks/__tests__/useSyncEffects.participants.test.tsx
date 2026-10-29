import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSyncEffects } from '../useSyncEffects';

vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 1 } }) } }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: {} }));

type Params = Parameters<typeof useSyncEffects>[0];
const owner = { user_id: 1, name: 'Owner' };
const agent = { user_id: 2, name: 'Frontend', user_type: 'agent' };
const initial = () => ({
  agents: [], chatPartner: { type: 'group', id: 10, name: 'Task' },
  userConversationId: 10, userConversationData: { id: 10, participants: [owner, agent] },
  setChatParticipants: vi.fn(), setBoundRows: vi.fn(), setShowBoundRowsBar: vi.fn(),
  markAsRead: vi.fn(), refetchUnread: vi.fn(), setUserConversationId: vi.fn(),
} as unknown as Params);

describe('participant synchronization', () => {
  it('updates an existing chat when the server adds or replaces a participant', () => {
    const props = initial();
    const { rerender } = renderHook(useSyncEffects, { initialProps: props });
    const added = { user_id: 3, name: 'Architect', user_type: 'agent' };
    rerender({ ...props, userConversationData: { id: 10, participants: [owner, agent, added] } });
    expect(props.setChatParticipants).toHaveBeenLastCalledWith([
      { id: 2, name: 'Frontend', type: 'agent' }, { id: 3, name: 'Architect', type: 'agent' },
    ]);
    rerender({ ...props, userConversationData: { id: 10, participants: [owner, { ...agent, name: 'Renamed' }] } });
    expect(props.setChatParticipants).toHaveBeenLastCalledWith([{ id: 2, name: 'Renamed', type: 'agent' }]);
  });
  it('clears the header when only the owner remains', () => {
    const props = initial();
    const { rerender } = renderHook(useSyncEffects, { initialProps: props });
    rerender({ ...props, userConversationData: { id: 10, participants: [owner] } });
    expect(props.setChatParticipants).toHaveBeenLastCalledWith([]);
  });
  it('uses only the active conversation and ignores stale responses', () => {
    const props = initial();
    props.chatPartner = { type: 'agent', id: 22, name: 'AI' };
    props.currentConversationId = 20;
    props.aiConversationData = { id: 20, participants: [owner, { user_id: 4, name: 'AI', user_type: 'agent' }] };
    const { rerender } = renderHook(useSyncEffects, { initialProps: props });
    expect(props.setChatParticipants).toHaveBeenLastCalledWith([{ id: 4, name: 'AI', type: 'agent' }]);
    vi.mocked(props.setChatParticipants).mockClear();
    rerender({ ...props, currentConversationId: 21 });
    expect(props.setChatParticipants).not.toHaveBeenCalled();
  });
});
