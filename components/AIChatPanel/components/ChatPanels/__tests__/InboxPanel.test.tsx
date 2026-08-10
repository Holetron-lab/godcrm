/**
 * InboxPanel Component Tests — Unified Conversation Browser
 * Ticket #81449: Tests for enhanced InboxPanel with filters
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InboxPanel } from '../InboxPanel';

// Mock dependencies
vi.mock('lucide-react', () => ({
  Inbox: (props: any) => <div data-testid="inbox-icon" {...props} />,
  Loader2: (props: any) => <div data-testid="loader-icon" {...props} />,
  User: (props: any) => <div data-testid="user-icon" {...props} />,
  Users: (props: any) => <div data-testid="users-icon" {...props} />,
  ChevronRight: (props: any) => <div data-testid="chevron-icon" {...props} />,
  Bot: (props: any) => <div data-testid="bot-icon" {...props} />,
  Search: (props: any) => <div data-testid="search-icon" {...props} />,
  X: (props: any) => <div data-testid="x-icon" {...props} />,
  Calendar: (props: any) => <div data-testid="calendar-icon" {...props} />,
  SlidersHorizontal: (props: any) => <div data-testid="sliders-icon" {...props} />,
}));

vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(' ')
}));

vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 1 } })
  }
}));

const mockProps = {
  totalUnreadCount: 0,
  inboxConversations: [] as any[],
  isLoadingInbox: false,
  agents: [],
  onConversationSelect: vi.fn(),
  onAiConversationSelect: vi.fn(),
  onMarkAsRead: vi.fn(),
  setActivePanel: vi.fn()
};

describe('InboxPanel', () => {
  it('should render inbox panel header', () => {
    render(<InboxPanel {...mockProps} />);

    expect(screen.getByText('Все беседы')).toBeInTheDocument();
  });

  it('should show unread count when totalUnreadCount > 0', () => {
    render(<InboxPanel {...mockProps} totalUnreadCount={5} />);

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('should not show unread count when totalUnreadCount is 0', () => {
    render(<InboxPanel {...mockProps} totalUnreadCount={0} />);

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('should show loading state when isLoadingInbox is true', () => {
    render(<InboxPanel {...mockProps} isLoadingInbox={true} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show empty state when no conversations', () => {
    render(<InboxPanel {...mockProps} inboxConversations={[]} />);

    expect(screen.getByText('Нет бесед')).toBeInTheDocument();
  });

  it('should render conversation list when conversations are provided', () => {
    const conversations = [
      {
        id: 1, title: 'Test Chat', type: 'direct', unread_count: 2,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [
          { user_id: 1, name: 'Current User' },
          { user_id: 2, name: 'Other User', email: 'other@example.com' }
        ]
      }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={conversations} />);

    expect(screen.getByText('Test Chat')).toBeInTheDocument();
    expect(screen.getByText('Test Chat').closest('button')).toBeInTheDocument();
  });

  it('should show unread badge for conversations with unread messages', () => {
    const conversations = [
      {
        id: 1, title: 'Unread Chat', type: 'direct', unread_count: 3,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [
          { user_id: 1, name: 'Current User' },
          { user_id: 2, name: 'Other User' }
        ]
      }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={conversations} />);

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should call onConversationSelect when user conversation is clicked', () => {
    const onConversationSelect = vi.fn();
    const conversations = [
      {
        id: 1, title: 'Test Chat', type: 'direct', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [
          { user_id: 1, name: 'Current User' },
          { user_id: 2, name: 'Other User', email: 'other@example.com' }
        ]
      }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={conversations} onConversationSelect={onConversationSelect} />);

    const conversationButton = screen.getByText('Test Chat').closest('button');
    fireEvent.click(conversationButton!);

    expect(onConversationSelect).toHaveBeenCalled();
  });

  it('should handle group conversations correctly', () => {
    const conversations = [
      {
        id: 1, title: 'Group Chat', type: 'group', unread_count: 1,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [
          { user_id: 1, name: 'Current User' },
          { user_id: 2, name: 'User 2' },
          { user_id: 3, name: 'User 3' }
        ]
      }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={conversations} />);

    expect(screen.getByText('Group Chat')).toBeInTheDocument();
    expect(screen.getByText('Group Chat').closest('button')).toBeInTheDocument();
  });

  it('should generate display name from participants when title is missing', () => {
    const conversations = [
      {
        id: 1, title: null, type: 'direct', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [
          { user_id: 1, name: 'Current User' },
          { user_id: 2, name: 'Other User' }
        ]
      }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={conversations} />);

    expect(screen.getByText('Other User')).toBeInTheDocument();
  });

  it('should show search input', () => {
    render(<InboxPanel {...mockProps} />);

    expect(screen.getByPlaceholderText('Поиск бесед...')).toBeInTheDocument();
  });

  it('should filter conversations by search query', () => {
    const conversations = [
      {
        id: 1, title: 'Alpha Chat', type: 'direct', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [{ user_id: 1, name: 'Current User' }, { user_id: 2, name: 'User A' }]
      },
      {
        id: 2, title: 'Beta Chat', type: 'direct', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [{ user_id: 1, name: 'Current User' }, { user_id: 3, name: 'User B' }]
      }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={conversations} />);

    expect(screen.getByText('Alpha Chat')).toBeInTheDocument();
    expect(screen.getByText('Beta Chat')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Поиск бесед...');
    fireEvent.change(searchInput, { target: { value: 'Alpha' } });

    expect(screen.getByText('Alpha Chat')).toBeInTheDocument();
    expect(screen.queryByText('Beta Chat')).not.toBeInTheDocument();
  });

  it('should show AI conversations with agent info', () => {
    const aiConversations = [
      {
        id: 100, title: 'AI Discussion', type: 'chat', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [],
        agent_id: 5, agent_name: 'Developer Agent', agent_icon: '🛠️',
        _source: 'ai' as const
      }
    ];

    render(<InboxPanel {...mockProps} aiConversations={aiConversations} />);

    expect(screen.getByText('AI Discussion')).toBeInTheDocument();
    expect(screen.getByText(/Developer Agent/)).toBeInTheDocument();
  });

  it('should call onAiConversationSelect for AI conversations', () => {
    const onAiConversationSelect = vi.fn();
    const aiConversations = [
      {
        id: 100, title: 'AI Chat', type: 'chat', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [],
        agent_id: 5, agent_name: 'Agent', _source: 'ai' as const
      }
    ];

    render(<InboxPanel {...mockProps} aiConversations={aiConversations} onAiConversationSelect={onAiConversationSelect} />);

    const button = screen.getByText('AI Chat').closest('button');
    fireEvent.click(button!);

    expect(onAiConversationSelect).toHaveBeenCalledWith(100);
  });

  it('should show filter toggle button', () => {
    render(<InboxPanel {...mockProps} />);

    const filterButton = screen.getByTitle('Фильтры');
    expect(filterButton).toBeInTheDocument();
  });

  it('should toggle filters panel when filter button clicked', () => {
    const agents = [
      { id: 1, name: 'Agent 1', icon: '🤖', system_prompt: '', model: '', provider_id: 1, operator_id: 1 }
    ];
    render(<InboxPanel {...mockProps} agents={agents} />);

    // Filters hidden initially
    expect(screen.queryByText('Все агенты')).not.toBeInTheDocument();

    // Click filter button
    fireEvent.click(screen.getByTitle('Фильтры'));

    // Filters visible now
    expect(screen.getByText('Все агенты')).toBeInTheDocument();
  });

  it('should close panel when close button clicked', () => {
    const setActivePanel = vi.fn();
    render(<InboxPanel {...mockProps} setActivePanel={setActivePanel} />);

    fireEvent.click(screen.getByTitle('Закрыть'));

    expect(setActivePanel).toHaveBeenCalledWith('none');
  });

  it('should show total conversation count in header', () => {
    const conversations = [
      { id: 1, title: 'Chat 1', type: 'direct', unread_count: 0, updated_at: '2024-01-01T00:00:00Z', participants: [] },
      { id: 2, title: 'Chat 2', type: 'direct', unread_count: 0, updated_at: '2024-01-01T00:00:00Z', participants: [] }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={conversations} />);

    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('should deduplicate conversations when same id in inbox and AI', () => {
    const inboxConversations = [
      { id: 1, title: 'Same Chat', type: 'chat', unread_count: 2, updated_at: '2024-01-01T00:00:00Z', participants: [] }
    ];
    const aiConversations = [
      { id: 1, title: 'Same Chat AI', type: 'chat', unread_count: 0, updated_at: '2024-01-01T00:00:00Z', participants: [], _source: 'ai' as const }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={inboxConversations} aiConversations={aiConversations} />);

    // Should show count 1, not 2
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  // --- Filter tests (Ticket #81449) ---

  it('should filter conversations by agent when agent selected', () => {
    const agents = [
      { id: 5, name: 'Dev Agent', icon: '🛠️', system_prompt: '', model: '', provider_id: 1, operator_id: 1 }
    ];
    const aiConversations = [
      {
        id: 10, title: 'Agent5 Chat', type: 'chat', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z', participants: [],
        agent_id: 5, agent_name: 'Dev Agent', _source: 'ai' as const
      },
      {
        id: 11, title: 'Agent6 Chat', type: 'chat', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z', participants: [],
        agent_id: 6, agent_name: 'Other Agent', _source: 'ai' as const
      }
    ];

    render(<InboxPanel {...mockProps} agents={agents} aiConversations={aiConversations} />);

    // Open filters
    fireEvent.click(screen.getByTitle('Фильтры'));

    // Select agent 5
    const agentSelect = screen.getByDisplayValue('Все агенты');
    fireEvent.change(agentSelect, { target: { value: '5' } });

    // Only Agent5 Chat should be visible
    expect(screen.getByText('Agent5 Chat')).toBeInTheDocument();
    expect(screen.queryByText('Agent6 Chat')).not.toBeInTheDocument();
  });

  it('should filter conversations by date when date filter button clicked', () => {
    const today = new Date().toISOString();
    const oldDate = '2020-01-01T00:00:00Z';

    const inboxConversations = [
      {
        id: 20, title: 'Today Chat', type: 'direct', unread_count: 0,
        updated_at: today,
        participants: [{ user_id: 1, name: 'Current User' }, { user_id: 2, name: 'User A' }]
      },
      {
        id: 21, title: 'Old Chat', type: 'direct', unread_count: 0,
        updated_at: oldDate,
        participants: [{ user_id: 1, name: 'Current User' }, { user_id: 3, name: 'User B' }]
      }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={inboxConversations} />);

    // Open filters
    fireEvent.click(screen.getByTitle('Фильтры'));

    // Click "Сегодня" date filter button
    fireEvent.click(screen.getByText('Сегодня'));

    // Only today's chat should be visible
    expect(screen.getByText('Today Chat')).toBeInTheDocument();
    expect(screen.queryByText('Old Chat')).not.toBeInTheDocument();
  });

  it('should sort conversations by name when sort option changed', () => {
    const inboxConversations = [
      {
        id: 30, title: 'Zebra Chat', type: 'direct', unread_count: 0,
        updated_at: '2024-01-02T00:00:00Z',
        participants: [{ user_id: 1, name: 'Current User' }, { user_id: 2, name: 'User Z' }]
      },
      {
        id: 31, title: 'Alpha Chat', type: 'direct', unread_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        participants: [{ user_id: 1, name: 'Current User' }, { user_id: 3, name: 'User A' }]
      }
    ];

    render(<InboxPanel {...mockProps} inboxConversations={inboxConversations} />);

    // Open filters to access sort select
    fireEvent.click(screen.getByTitle('Фильтры'));

    // Change sort to "name"
    const sortSelect = screen.getByDisplayValue('По дате');
    fireEvent.change(sortSelect, { target: { value: 'name' } });

    // Both chats should still be visible
    expect(screen.getByText('Alpha Chat')).toBeInTheDocument();
    expect(screen.getByText('Zebra Chat')).toBeInTheDocument();

    // Alpha should appear before Zebra in DOM order
    const items = screen.getAllByRole('button', { name: /Chat/ });
    const alphaIndex = items.findIndex(el => el.textContent?.includes('Alpha Chat'));
    const zebraIndex = items.findIndex(el => el.textContent?.includes('Zebra Chat'));
    expect(alphaIndex).toBeLessThan(zebraIndex);
  });
});
