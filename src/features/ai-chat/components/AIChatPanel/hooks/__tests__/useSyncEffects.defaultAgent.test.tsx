import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSyncEffects } from '../useSyncEffects';

vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 1 } }) } }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: {} }));

type Params = Parameters<typeof useSyncEffects>[0];
const marketer = { id: 44465, name: 'Marketer' };
const smith = { id: 110507, name: 'Agent Smith' };
const initial = () => ({
  isOpen: true, agents: [marketer, smith], defaultAgentId: marketer.id, currentAgent: null,
  selectAgent: vi.fn(), loadAgents: vi.fn(), loadConversations: vi.fn(),
  setChatOperatorId: vi.fn(), setChatModelId: vi.fn(), setChatSystemPrompt: vi.fn(),
  setChatPartner: vi.fn(), setUserConversationId: vi.fn(), setChatParticipants: vi.fn(),
  setBoundRows: vi.fn(), setShowBoundRowsBar: vi.fn(), markAsRead: vi.fn(), refetchUnread: vi.fn(),
  chatPartner: null, userConversationId: null, userConversationData: null,
} as unknown as Params);

describe('default agent auto-select', () => {
  it('selects the space default when the chat opens with no agent chosen', () => {
    const props = initial();
    renderHook(useSyncEffects, { initialProps: props });
    expect(props.selectAgent).toHaveBeenCalledWith(marketer);
  });

  it('keeps an agent the user picked instead of reverting to the default', () => {
    const props = initial();
    props.currentAgent = smith as Params['currentAgent'];
    renderHook(useSyncEffects, { initialProps: props });
    expect(props.selectAgent).not.toHaveBeenCalled();
  });

  it('applies the default when it loads later and nothing is selected yet', () => {
    const props: Params = { ...initial(), defaultAgentId: null };
    const { rerender } = renderHook(useSyncEffects, { initialProps: props });
    expect(props.selectAgent).not.toHaveBeenCalled();
    rerender({ ...props, defaultAgentId: marketer.id });
    expect(props.selectAgent).toHaveBeenCalledWith(marketer);
  });
});
