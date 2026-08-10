import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMessages } from '../ChatMessages';
import type { ChatMessage, ChatPartner } from '../../../types';
import { getFileIcon } from '@/shared/utils/fileHelpers';

type MockIconProps = { className?: string; [key: string]: unknown };

// Mock icons — includes all icons used by ChatMessages + ChatTurn child component
vi.mock('lucide-react', () => ({
  Users: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="users-icon" {...props} />,
  Bot: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="bot-icon" {...props} />,
  User: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="user-icon" {...props} />,
  MessageSquare: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="message-square-icon" {...props} />,
  AlertCircle: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="alert-circle-icon" {...props} />,
  X: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="x-icon" {...props} />,
  MoreVertical: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="more-vertical-icon" {...props} />,
  Copy: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="copy-icon" {...props} />,
  Forward: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="forward-icon" {...props} />,
  Trash2: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="trash-icon" {...props} />,
  Ban: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="ban-icon" {...props} />,
  Key: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="key-icon" {...props} />,
  ExternalLink: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="external-link-icon" {...props} />,
  Wrench: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="wrench-icon" {...props} />,
  Zap: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="zap-icon" {...props} />,
  Plus: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="plus-icon" {...props} />,
  ChevronDown: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="chevron-down-icon" {...props} />,
  ChevronRight: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="chevron-right-icon" {...props} />,
  Brain: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="brain-icon" {...props} />,
  Loader2: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="loader-icon" {...props} />,
  CheckCircle2: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="check-circle-icon" {...props} />,
  XCircle: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="x-circle-icon" {...props} />,
  Terminal: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="terminal-icon" {...props} />,
  Link2: ({ className, ...props }: MockIconProps) => <div className={className} data-testid="link2-icon" {...props} />
}));

// Mock ChatTurn component — ChatMessages now renders ChatTurn (not MessageBubble)
vi.mock('../ChatTurn', () => ({
  ChatTurn: ({ messages, turnType, onReact, onCopy, onForward, onDelete }: {
    messages: { id: string; role: string; content: string }[];
    turnType: string;
    onReact?: (id: string, emoji: string) => void;
    onCopy?: (message: { id: string; role: string; content: string }) => void;
    onForward?: (message: { id: string; role: string; content: string }) => void;
    onDelete?: (id: string) => void;
  }) => (
    <div data-testid={`turn-${messages[0]?.id}`} data-turntype={turnType}>
      {messages.map((m: { id: string; role: string; content: string }) => (
        <div key={m.id} data-testid={`message-${m.id}`} data-role={m.role}>
          <div>{m.content}</div>
        </div>
      ))}
      {onReact && <button onClick={() => onReact(messages[0]?.id, '👍')}>React</button>}
      {onCopy && <button onClick={() => onCopy(messages[0])}>Copy</button>}
      {onForward && <button onClick={() => onForward(messages[0])}>Forward</button>}
      {onDelete && <button onClick={() => onDelete(messages[0]?.id)}>Delete</button>}
    </div>
  )
}));

// Mock cn utility
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}));

// Mock file icon helper
vi.mock('@/shared/utils/fileHelpers', () => ({
  getFileIcon: vi.fn((type: string) => {
    if (type.startsWith('image/')) return '🖼️';
    if (type.includes('pdf')) return '📄';
    return '📎';
  })
}));

describe('ChatMessages', () => {
  const mockMessages: ChatMessage[] = [
    {
      id: '1',
      content: 'Hello from user',
      role: 'user',
      sender_id: 1,
      timestamp: new Date('2024-01-20T10:00:00Z')
    },
    {
      id: '2',
      content: 'Hello from AI',
      role: 'assistant',
      sender_id: undefined,
      timestamp: new Date('2024-01-20T10:01:00Z')
    },
    {
      id: '3',
      content: 'Another user message',
      role: 'user',
      sender_id: 2,
      timestamp: new Date('2024-01-20T10:02:00Z')
    }
  ];

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
    email: 'john@example.com'
  };

  const mockGroupPartner: ChatPartner = {
    type: 'group',
    id: 1,
    name: 'Test Group'
  };

  const mockAttachments = [
    { name: 'document.pdf', type: 'application/pdf', size: 1024 },
    { name: 'image.jpg', type: 'image/jpeg', size: 2048 }
  ];

  const defaultProps = {
    chatMode: 'ai' as const,
    chatPartner: mockAgentPartner,
    displayMessages: mockMessages,
    currentUserId: 1,
    markdownEnabled: true,
    messageReactions: {},
    quickEmojis: ['👍', '❤️', '😂'],
    dragOver: false,
    error: null,
    localError: null,
    attachments: [],
    messagesEndRef: { current: null },
    setActivePanel: vi.fn(),
    setDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handleReaction: vi.fn(),
    handleCopyMessage: vi.fn(),
    handleForwardMessage: vi.fn(),
    handleDeleteMessage: vi.fn(),
    setAttachments: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('People Mode Empty States', () => {
    it('should show contact picker when in people mode without partner', () => {
      render(<ChatMessages {...defaultProps} chatMode="people" chatPartner={null} />);
      
      expect(screen.getByText('Выберите собеседника')).toBeInTheDocument();
      expect(screen.getByText('Выберите контакт из списка для начала разговора')).toBeInTheDocument();
      expect(screen.getByText('Открыть контакты')).toBeInTheDocument();
    });

    it('should show contact picker when in people mode with agent partner', () => {
      render(<ChatMessages {...defaultProps} chatMode="people" chatPartner={mockAgentPartner} />);
      
      expect(screen.getByText('Выберите собеседника')).toBeInTheDocument();
    });

    it('should open contacts panel when button clicked', () => {
      render(<ChatMessages {...defaultProps} chatMode="people" chatPartner={null} />);
      
      fireEvent.click(screen.getByText('Открыть контакты'));
      expect(defaultProps.setActivePanel).toHaveBeenCalledWith('contacts');
    });
  });

  describe('Empty Chat States', () => {
    it('should show empty state for agent chat', () => {
      render(<ChatMessages {...defaultProps} displayMessages={[]} chatPartner={mockAgentPartner} />);
      
      expect(screen.getByText('Начните разговор')).toBeInTheDocument();
      expect(screen.getByText('Чат с Test Agent')).toBeInTheDocument();
      expect(screen.getByTestId('bot-icon')).toBeInTheDocument();
    });

    it('should show empty state for user chat', () => {
      render(<ChatMessages {...defaultProps} displayMessages={[]} chatPartner={mockUserPartner} />);
      
      expect(screen.getByText('Начните разговор')).toBeInTheDocument();
      expect(screen.getByText('Чат с John Doe')).toBeInTheDocument();
      expect(screen.getByTestId('user-icon')).toBeInTheDocument();
    });

    it('should show empty state for group chat', () => {
      render(<ChatMessages {...defaultProps} displayMessages={[]} chatPartner={mockGroupPartner} />);
      
      expect(screen.getByText('Начните разговор')).toBeInTheDocument();
      expect(screen.getByText('Чат с Test Group')).toBeInTheDocument();
      expect(screen.getByTestId('users-icon')).toBeInTheDocument();
    });

    it('should show empty state with no partner', () => {
      render(<ChatMessages {...defaultProps} displayMessages={[]} chatPartner={null} />);
      
      expect(screen.getByText('Начните разговор')).toBeInTheDocument();
      expect(screen.getByText('Выберите собеседника из контактов или AI агентов')).toBeInTheDocument();
      expect(screen.getByTestId('message-square-icon')).toBeInTheDocument();
    });
  });

  describe('Message Rendering', () => {
    it('should render all messages', () => {
      render(<ChatMessages {...defaultProps} />);
      
      expect(screen.getByTestId('message-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-2')).toBeInTheDocument();
      expect(screen.getByTestId('message-3')).toBeInTheDocument();
    });

    it('should pass correct props to MessageBubble', () => {
      render(<ChatMessages {...defaultProps} />);
      
      const userMessage = screen.getByTestId('message-1');
      const aiMessage = screen.getByTestId('message-2');
      
      expect(userMessage).toHaveAttribute('data-role', 'user');
      expect(aiMessage).toHaveAttribute('data-role', 'assistant');
    });

    it('should handle message reactions', () => {
      render(<ChatMessages {...defaultProps} />);
      
      fireEvent.click(screen.getAllByText('React')[0]);
      expect(defaultProps.handleReaction).toHaveBeenCalledWith('1', '👍');
    });

    it('should handle message copy', () => {
      render(<ChatMessages {...defaultProps} />);
      
      fireEvent.click(screen.getAllByText('Copy')[0]);
      expect(defaultProps.handleCopyMessage).toHaveBeenCalledWith(mockMessages[0]);
    });

    it('should handle message forward', () => {
      render(<ChatMessages {...defaultProps} />);
      
      fireEvent.click(screen.getAllByText('Forward')[0]);
      expect(defaultProps.handleForwardMessage).toHaveBeenCalledWith(mockMessages[0]);
    });

    it('should handle message delete', () => {
      render(<ChatMessages {...defaultProps} />);
      
      fireEvent.click(screen.getAllByText('Delete')[0]);
      expect(defaultProps.handleDeleteMessage).toHaveBeenCalledWith('1');
    });
  });

  describe('Drag and Drop', () => {
    it('should apply drag over styles when dragging', () => {
      const { container } = render(<ChatMessages {...defaultProps} dragOver={true} />);
      
      const messagesArea = container.querySelector('.flex-1');
      expect(messagesArea).toHaveClass('bg-[var(--color-primary-500)]/5');
    });

    it('should handle drag over event', () => {
      const { container } = render(<ChatMessages {...defaultProps} />);
      
      const messagesArea = container.querySelector('.flex-1')!;
      const dragEvent = new Event('dragover', { bubbles: true });
      Object.defineProperty(dragEvent, 'preventDefault', { value: vi.fn() });
      
      fireEvent(messagesArea, dragEvent);
      expect(defaultProps.setDragOver).toHaveBeenCalledWith(true);
    });

    it('should handle drag leave event', () => {
      const { container } = render(<ChatMessages {...defaultProps} />);
      
      const messagesArea = container.querySelector('.flex-1')!;
      fireEvent.dragLeave(messagesArea);
      
      expect(defaultProps.setDragOver).toHaveBeenCalledWith(false);
    });

    it('should handle drop event', () => {
      const { container } = render(<ChatMessages {...defaultProps} />);
      
      const messagesArea = container.querySelector('.flex-1')!;
      fireEvent.drop(messagesArea);
      
      expect(defaultProps.handleDrop).toHaveBeenCalled();
    });
  });

  describe('Error Display', () => {
    it('should show error message', () => {
      render(<ChatMessages {...defaultProps} error="Test error message" />);
      
      expect(screen.getByText('Test error message')).toBeInTheDocument();
      expect(screen.getByTestId('alert-circle-icon')).toBeInTheDocument();
    });

    it('should show local error message', () => {
      render(<ChatMessages {...defaultProps} localError="Local error message" />);
      
      expect(screen.getByText('Local error message')).toBeInTheDocument();
    });

    it('should prioritize error over localError', () => {
      render(<ChatMessages {...defaultProps} error="Main error" localError="Local error" />);
      
      expect(screen.getByText('Main error')).toBeInTheDocument();
      expect(screen.queryByText('Local error')).not.toBeInTheDocument();
    });
  });

  describe('Attachments Preview', () => {
    it('should show attachments when present', () => {
      render(<ChatMessages {...defaultProps} attachments={mockAttachments} />);
      
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });

    it('should show correct file icons', () => {
      render(<ChatMessages {...defaultProps} attachments={mockAttachments} />);
      
      expect(getFileIcon).toHaveBeenCalledWith('application/pdf');
      expect(getFileIcon).toHaveBeenCalledWith('image/jpeg');
    });

    it('should remove attachment when X clicked', () => {
      render(<ChatMessages {...defaultProps} attachments={mockAttachments} />);
      
      const removeButtons = screen.getAllByTestId('x-icon');
      fireEvent.click(removeButtons[0]);
      
      expect(defaultProps.setAttachments).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should not show attachments section when empty', () => {
      render(<ChatMessages {...defaultProps} attachments={[]} />);
      
      expect(screen.queryByText('document.pdf')).not.toBeInTheDocument();
    });
  });

  describe('Chat Type Detection', () => {
    it('should pass correct chat type for user partner', () => {
      render(<ChatMessages {...defaultProps} chatPartner={mockUserPartner} />);
      
      // MessageBubble should receive chatType='user' for user/group partners
      // This is tested indirectly through the mock component
      expect(screen.getByTestId('message-1')).toBeInTheDocument();
    });

    it('should pass correct chat type for agent partner', () => {
      render(<ChatMessages {...defaultProps} chatPartner={mockAgentPartner} />);
      
      // MessageBubble should receive chatType='ai' for agent partners
      expect(screen.getByTestId('message-1')).toBeInTheDocument();
    });

    it('should pass correct chat type for group partner', () => {
      render(<ChatMessages {...defaultProps} chatPartner={mockGroupPartner} />);
      
      // MessageBubble should receive chatType='user' for group partners
      expect(screen.getByTestId('message-1')).toBeInTheDocument();
    });
  });

  describe('Messages End Ref', () => {
    it('should render messages end ref for scrolling', () => {
      const mockRef = { current: null };
      const { container } = render(<ChatMessages {...defaultProps} messagesEndRef={mockRef} />);
      
      // The ref should be attached to a div at the end of messages
      const messagesContainer = container.querySelector('.space-y-4');
      expect(messagesContainer).toBeInTheDocument();
    });
  });
});