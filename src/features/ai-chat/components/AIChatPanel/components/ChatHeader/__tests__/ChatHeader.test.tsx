import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatHeader } from '../ChatHeader';
import type { ChatPartner, Agent, User } from '../../../types';

// Mock icons
vi.mock('lucide-react', () => ({
  Users: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="users-icon" {...props} />,
  Bot: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="bot-icon" {...props} />,
  Zap: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="zap-icon" {...props} />,
  ListTodo: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="list-todo-icon" {...props} />,
  Inbox: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="inbox-icon" {...props} />,
  Settings: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="settings-icon" {...props} />,
  Plus: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="plus-icon" {...props} />,
  X: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="x-icon" {...props} />,
  Search: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="search-icon" {...props} />,
  User: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="user-icon" {...props} />,
  MessageSquare: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="message-square-icon" {...props} />
}));

// Mock ToolbarButton component
vi.mock('../../shared/ToolbarButton', () => ({
  ToolbarButton: ({ icon, label, active, onClick, badge, badgeColor }: {
    icon?: React.ReactNode;
    label?: string;
    active?: boolean;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    badge?: React.ReactNode;
    badgeColor?: string;
  }) => (
    <button
      onClick={onClick}
      className={active ? 'active' : ''}
      data-testid={`toolbar-${(label ?? '').toLowerCase().replace(/\s+/g, '-')}`}
      title={label}
    >
      {icon}
      {badge && <span data-testid="badge">{badge}</span>}
      {badgeColor && <span data-testid="badge-color">{badgeColor}</span>}
    </button>
  )
}));

// Mock cn utility
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}));

describe('ChatHeader', () => {
  const mockAgentPartner: ChatPartner = {
    type: 'agent',
    id: 1,
    name: 'Test Agent',
    icon: '🤖'
  };

  const mockUserPartner: ChatPartner = {
    type: 'user',
    id: 1,
    name: 'John Doe',
    email: 'john@example.com',
    avatarUrl: undefined
  };

  const mockGroupPartner: ChatPartner = {
    type: 'group',
    id: 1,
    name: 'Test Group'
  };

  const mockAgents: Agent[] = [
    { id: 1, name: 'Agent 1', icon: '🤖', system_prompt: '', model: '', provider_id: 1, operator_id: 1 },
    { id: 2, name: 'Agent 2', icon: '🤖', system_prompt: '', model: '', provider_id: 1, operator_id: 1 }
  ];

  const mockUsers: User[] = [
    { id: 1, name: 'User 1', email: 'user1@example.com' },
    { id: 2, name: 'User 2', email: 'user2@example.com' }
  ];

  const mockConversations = [
    { id: 1, title: 'Chat 1', updatedAt: '2024-01-20T10:00:00Z', type: 'direct' },
    { id: 2, title: 'Chat 2', updatedAt: '2024-01-21T10:00:00Z', type: 'direct' }
  ];

  const mockParticipants = [
    { id: 1, name: 'Participant 1' },
    { id: 2, name: 'Participant 2' }
  ];

  const defaultProps = {
    chatMode: 'ai' as const,
    activePanel: 'none' as const,
    chatPartner: mockAgentPartner,
    chatParticipants: [],
    agents: mockAgents,
    users: mockUsers,
    conversations: mockConversations,
    totalUnreadCount: 5,
    isWideMode: false,
    contactsSearch: '',
    historySearch: '',
    currentAgent: mockAgents[0],
    setChatMode: vi.fn(),
    setActivePanel: vi.fn(),
    setChatPartner: vi.fn(),
    setChatParticipants: vi.fn(),
    togglePanel: vi.fn(),
    loadConversations: vi.fn(),
    refetchInbox: vi.fn(),
    createNewConversation: vi.fn(),
    closeChat: vi.fn(),
    setContactsSearch: vi.fn(),
    setHistorySearch: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Unified Toolbar', () => {
    it('should render all toolbar buttons in unified row', () => {
      render(<ChatHeader {...defaultProps} />);

      expect(screen.getByTestId('toolbar-агенты')).toBeInTheDocument();
      expect(screen.getByTestId('toolbar-входящие')).toBeInTheDocument();
      expect(screen.getByTestId('toolbar-контакты')).toBeInTheDocument();
      // History button removed — Ticket #81448
      expect(screen.getByTestId('toolbar-задачи')).toBeInTheDocument();
    });

    it('should show agent count badge on agents button', () => {
      render(<ChatHeader {...defaultProps} />);

      const agentsButton = screen.getByTestId('toolbar-агенты');
      expect(agentsButton.querySelector('[data-testid="badge"]')).toHaveTextContent('2');
    });

    // History button badge test removed — Ticket #81448

    it('should show unread count badge on inbox button', () => {
      render(<ChatHeader {...defaultProps} totalUnreadCount={10} />);

      const inboxButton = screen.getByTestId('toolbar-входящие');
      expect(inboxButton.querySelector('[data-testid="badge"]')).toHaveTextContent('10');
    });

    it('should show red badge color on inbox when unread count > 0', () => {
      render(<ChatHeader {...defaultProps} totalUnreadCount={5} />);

      const inboxButton = screen.getByTestId('toolbar-входящие');
      expect(inboxButton.querySelector('[data-testid="badge-color"]')).toHaveTextContent('red');
    });

    it('should show users count badge on contacts button', () => {
      render(<ChatHeader {...defaultProps} />);

      const contactsButton = screen.getByTestId('toolbar-контакты');
      expect(contactsButton.querySelector('[data-testid="badge"]')).toHaveTextContent('2');
    });

    it('should toggle agents panel and set AI mode when agents clicked', () => {
      render(<ChatHeader {...defaultProps} />);

      fireEvent.click(screen.getByTestId('toolbar-агенты'));

      expect(defaultProps.setChatMode).toHaveBeenCalledWith('ai');
      expect(defaultProps.togglePanel).toHaveBeenCalledWith('ai-agents');
    });

    it('should toggle inbox panel, set people mode, and refetch when inbox clicked', () => {
      render(<ChatHeader {...defaultProps} activePanel="none" />);

      fireEvent.click(screen.getByTestId('toolbar-входящие'));

      expect(defaultProps.setChatMode).toHaveBeenCalledWith('people');
      expect(defaultProps.togglePanel).toHaveBeenCalledWith('inbox');
      expect(defaultProps.refetchInbox).toHaveBeenCalled();
    });

    it('should not refetch inbox if inbox panel already active', () => {
      render(<ChatHeader {...defaultProps} activePanel="inbox" />);

      fireEvent.click(screen.getByTestId('toolbar-входящие'));

      expect(defaultProps.togglePanel).toHaveBeenCalledWith('inbox');
      expect(defaultProps.refetchInbox).not.toHaveBeenCalled();
    });

    it('should toggle contacts panel and set people mode when contacts clicked', () => {
      render(<ChatHeader {...defaultProps} />);

      fireEvent.click(screen.getByTestId('toolbar-контакты'));

      expect(defaultProps.setChatMode).toHaveBeenCalledWith('people');
      expect(defaultProps.togglePanel).toHaveBeenCalledWith('contacts');
    });

    // History panel toggle tests removed — Ticket #81448
  });

  describe('Right Toolbar', () => {
    it('should render right toolbar buttons', () => {
      render(<ChatHeader {...defaultProps} />);

      expect(screen.getByTestId('toolbar-настройки')).toBeInTheDocument();
      expect(screen.getByTestId('toolbar-новый-чат')).toBeInTheDocument();
      expect(screen.getByTestId('toolbar-закрыть')).toBeInTheDocument();
    });

    it('should toggle settings panel', () => {
      render(<ChatHeader {...defaultProps} />);

      fireEvent.click(screen.getByTestId('toolbar-настройки'));

      expect(defaultProps.togglePanel).toHaveBeenCalledWith('settings');
    });

    it('should create new conversation', () => {
      render(<ChatHeader {...defaultProps} />);

      fireEvent.click(screen.getByTestId('toolbar-новый-чат'));

      expect(defaultProps.createNewConversation).toHaveBeenCalled();
    });

    it('should close chat', () => {
      render(<ChatHeader {...defaultProps} />);

      fireEvent.click(screen.getByTestId('toolbar-закрыть'));

      expect(defaultProps.closeChat).toHaveBeenCalled();
    });
  });

  describe('Chat Partner Info', () => {
    it('should display agent partner info', () => {
      render(<ChatHeader {...defaultProps} chatPartner={mockAgentPartner} />);

      expect(screen.getByText('Test Agent')).toBeInTheDocument();
      expect(screen.getByText('🤖')).toBeInTheDocument();
    });

    it('should display user partner info', () => {
      render(<ChatHeader {...defaultProps} chatPartner={mockUserPartner} />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
      expect(screen.getByTestId('user-icon')).toBeInTheDocument();
    });

    it('should display user avatar when available', () => {
      const userWithAvatar = { ...mockUserPartner, avatarUrl: 'https://example.com/avatar.jpg' };
      render(<ChatHeader {...defaultProps} chatPartner={userWithAvatar} />);

      const avatar = screen.getByAltText('John Doe');
      expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg');
    });

    it('should display group partner info', () => {
      render(<ChatHeader {...defaultProps} chatPartner={mockGroupPartner} />);

      expect(screen.getByText('Test Group')).toBeInTheDocument();
      // Check for the users icon in the partner info area (with green color)
      const usersIcons = screen.getAllByTestId('users-icon');
      const groupIcon = usersIcons.find(icon => icon.classList.contains('text-green-400'));
      expect(groupIcon).toBeInTheDocument();
    });

    it('should display "Новый чат" when no partner', () => {
      render(<ChatHeader {...defaultProps} chatPartner={null} />);

      expect(screen.getByText('Новый чат')).toBeInTheDocument();
      expect(screen.getByTestId('message-square-icon')).toBeInTheDocument();
    });

    it('should display participants when available', () => {
      render(<ChatHeader {...defaultProps} chatParticipants={mockParticipants} />);

      expect(screen.getByText('Participant 1, Participant 2')).toBeInTheDocument();
      expect(screen.getByText('2 участника')).toBeInTheDocument();
    });

    it('should display model name for agent', () => {
      const agentWithModel = { ...mockAgents[0], model_name: 'GPT-4' };
      render(<ChatHeader {...defaultProps} chatPartner={mockAgentPartner} currentAgent={agentWithModel} />);

      expect(screen.getByText('GPT-4')).toBeInTheDocument();
    });

    it('should open appropriate panel when partner info clicked', () => {
      render(<ChatHeader {...defaultProps} chatMode="ai" />);

      const partnerButton = screen.getByText('Test Agent').closest('button');
      fireEvent.click(partnerButton!);

      expect(defaultProps.togglePanel).toHaveBeenCalledWith('ai-agents');
    });
  });

  describe('Search Bar', () => {
    it('should show search bar for contacts panel in narrow mode', () => {
      render(<ChatHeader {...defaultProps} activePanel="contacts" isWideMode={false} />);

      expect(screen.getByPlaceholderText('Поиск контактов...')).toBeInTheDocument();
    });

    // History search bar test removed — Ticket #81448

    it('should not show search bar in wide mode', () => {
      render(<ChatHeader {...defaultProps} activePanel="contacts" isWideMode={true} />);

      expect(screen.queryByPlaceholderText('Поиск контактов...')).not.toBeInTheDocument();
    });

    it('should not show search bar for ai-agents panel', () => {
      render(<ChatHeader {...defaultProps} activePanel="ai-agents" isWideMode={false} />);

      expect(screen.queryByPlaceholderText('Поиск контактов...')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Поиск в истории...')).not.toBeInTheDocument();
    });

    it('should update contacts search', () => {
      render(<ChatHeader {...defaultProps} activePanel="contacts" isWideMode={false} />);

      const searchInput = screen.getByPlaceholderText('Поиск контактов...');
      fireEvent.change(searchInput, { target: { value: 'test search' } });

      expect(defaultProps.setContactsSearch).toHaveBeenCalledWith('test search');
    });

    // History search update test removed — Ticket #81448

    it('should display current search value', () => {
      render(<ChatHeader {...defaultProps} activePanel="contacts" isWideMode={false} contactsSearch="existing search" />);

      const searchInput = screen.getByDisplayValue('existing search');
      expect(searchInput).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    it('should hide chat partner info when panel is open in narrow mode', () => {
      render(<ChatHeader {...defaultProps} activePanel="contacts" isWideMode={false} />);

      expect(screen.queryByText('Test Agent')).not.toBeInTheDocument();
    });

    it('should show chat partner info in wide mode even with panel open', () => {
      render(<ChatHeader {...defaultProps} activePanel="contacts" isWideMode={true} />);

      expect(screen.getByText('Test Agent')).toBeInTheDocument();
    });

    it('should show chat partner info when no panel is active', () => {
      render(<ChatHeader {...defaultProps} activePanel="none" isWideMode={false} />);

      expect(screen.getByText('Test Agent')).toBeInTheDocument();
    });
  });
});
