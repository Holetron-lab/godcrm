import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import type { ChatMessage } from '../../../types';

// Mock icons — includes icons from MessageBubble + ChatAttachmentRenderer
vi.mock('lucide-react', () => ({
  Bot: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="bot-icon" {...props} />,
  User: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="user-icon" {...props} />,
  MoreVertical: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="more-vertical-icon" {...props} />,
  Copy: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="copy-icon" {...props} />,
  Forward: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="forward-icon" {...props} />,
  Trash2: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="trash-icon" {...props} />,
  Ban: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="ban-icon" {...props} />,
  Key: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="key-icon" {...props} />,
  ExternalLink: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="external-link-icon" {...props} />,
  Wrench: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="wrench-icon" {...props} />,
  Zap: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="zap-icon" {...props} />,
  Plus: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="plus-icon" {...props} />,
  Eye: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="eye-icon" {...props} />
}));

// Mock MarkdownPreview component
vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content, className }: { content?: React.ReactNode; className?: string }) => (
    <div className={className} data-testid="markdown-preview">{content}</div>
  )
}));

// Mock cn utility
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}));

// Mock filesApi — used by ChatAttachmentRenderer
vi.mock('@/features/files/api/filesApi', () => ({
  getFileIcon: (type: string) => {
    if (type?.startsWith('image/')) return '🖼️';
    if (type?.includes('pdf')) return '📄';
    return '📎';
  },
  formatFileSize: (size: number) => `${Math.round(size / 1024)}KB`
}));

describe('MessageBubble', () => {
  const mockUserMessage: ChatMessage = {
    id: '1',
    content: 'Hello from user',
    role: 'user',
    sender_id: 1,
    timestamp: new Date('2024-01-20T10:00:00Z')
  };

  const mockAIMessage: ChatMessage = {
    id: '2',
    content: 'Hello from AI',
    role: 'assistant',
    sender_id: undefined,
    timestamp: new Date('2024-01-20T10:01:00Z')
  };

  const mockDeletedMessage: ChatMessage = {
    id: '3',
    content: '',
    role: 'user',
    sender_id: 1,
    timestamp: new Date('2024-01-20T10:02:00Z'),
    is_deleted: true
  };

  const mockStreamingMessage: ChatMessage = {
    id: '4',
    content: '',
    role: 'assistant',
    sender_id: undefined,
    timestamp: new Date('2024-01-20T10:03:00Z'),
    isStreaming: true
  };

  const mockMessageWithAttachments: ChatMessage = {
    id: '5',
    content: 'Message with files',
    role: 'user',
    sender_id: 1,
    timestamp: new Date('2024-01-20T10:04:00Z'),
    attachments: [
      { id: 'att-1', name: 'document.pdf', type: 'application/pdf', size: 1024 },
      { id: 'att-2', name: 'image.jpg', type: 'image/jpeg', size: 2048, url: 'https://example.com/image.jpg' }
    ]
  };

  const mockMessageWithTools: ChatMessage = {
    id: '6',
    content: 'AI response with tools',
    role: 'assistant',
    sender_id: undefined,
    timestamp: new Date('2024-01-20T10:05:00Z'),
    toolResults: [
      { tool: 'search', args: { query: 'test' }, result: { found: 5 } },
      { tool: 'calculate', args: { expression: '2+2' }, result: 4 }
    ],
    iterations: 2
  };

  const mockReactions = {
    '❤️': [
      { user_id: 1, user_name: 'User 1' },
      { user_id: 2, user_name: 'User 2' }
    ],
    '👍': [
      { user_id: 3, user_name: 'User 3' }
    ]
  };

  const defaultProps = {
    message: mockUserMessage,
    currentUserId: 1,
    markdownEnabled: true,
    chatType: 'ai' as const,
    reactions: {},
    quickEmojis: ['👍', '❤️', '😂', '😮', '😢', '🙏'],
    onReact: vi.fn(),
    onCopy: vi.fn(),
    onForward: vi.fn(),
    onDelete: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Message Alignment', () => {
    it('should align user messages to the right', () => {
      const { container } = render(<MessageBubble {...defaultProps} />);
      
      const messageContainer = container.querySelector('.group');
      expect(messageContainer).toHaveClass('justify-end');
    });

    it('should align AI messages to the left', () => {
      const { container } = render(<MessageBubble {...defaultProps} message={mockAIMessage} />);
      
      const messageContainer = container.querySelector('.group');
      expect(messageContainer).not.toHaveClass('justify-end');
    });

    it('should align other user messages to the left', () => {
      const otherUserMessage = { ...mockUserMessage, sender_id: 2 };
      const { container } = render(<MessageBubble {...defaultProps} message={otherUserMessage} />);
      
      const messageContainer = container.querySelector('.group');
      expect(messageContainer).not.toHaveClass('justify-end');
    });
  });

  describe('Avatar Display', () => {
    it('should not show avatar for own messages', () => {
      render(<MessageBubble {...defaultProps} />);
      
      expect(screen.queryByTestId('user-icon')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bot-icon')).not.toBeInTheDocument();
    });

    it('should show AI avatar for AI messages', () => {
      render(<MessageBubble {...defaultProps} message={mockAIMessage} />);
      
      expect(screen.getByTestId('bot-icon')).toBeInTheDocument();
    });

    it('should show user avatar for other user messages', () => {
      const otherUserMessage = { ...mockUserMessage, sender_id: 2 };
      render(<MessageBubble {...defaultProps} message={otherUserMessage} />);
      
      expect(screen.getByTestId('user-icon')).toBeInTheDocument();
    });
  });

  describe('Context Menu', () => {
    it('should show context menu button on hover', () => {
      render(<MessageBubble {...defaultProps} />);
      
      expect(screen.getByTestId('more-vertical-icon')).toBeInTheDocument();
    });

    it('should toggle context menu when clicked', () => {
      render(<MessageBubble {...defaultProps} />);
      
      const menuButton = screen.getByTestId('more-vertical-icon').closest('button')!;
      fireEvent.click(menuButton);
      
      expect(screen.getByText('Копировать')).toBeInTheDocument();
      expect(screen.getByText('Переслать')).toBeInTheDocument();
    });

    it('should show delete option for own messages', () => {
      render(<MessageBubble {...defaultProps} />);
      
      const menuButton = screen.getByTestId('more-vertical-icon').closest('button')!;
      fireEvent.click(menuButton);
      
      expect(screen.getByText('Удалить')).toBeInTheDocument();
    });

    it('should not show delete option for other messages', () => {
      const otherUserMessage = { ...mockUserMessage, sender_id: 2 };
      render(<MessageBubble {...defaultProps} message={otherUserMessage} />);
      
      const menuButton = screen.getByTestId('more-vertical-icon').closest('button')!;
      fireEvent.click(menuButton);
      
      expect(screen.queryByText('Удалить')).not.toBeInTheDocument();
    });

    it('should call onCopy when copy clicked', () => {
      render(<MessageBubble {...defaultProps} />);
      
      const menuButton = screen.getByTestId('more-vertical-icon').closest('button')!;
      fireEvent.click(menuButton);
      fireEvent.click(screen.getByText('Копировать'));
      
      expect(defaultProps.onCopy).toHaveBeenCalledWith(mockUserMessage);
    });

    it('should call onForward when forward clicked', () => {
      render(<MessageBubble {...defaultProps} />);
      
      const menuButton = screen.getByTestId('more-vertical-icon').closest('button')!;
      fireEvent.click(menuButton);
      fireEvent.click(screen.getByText('Переслать'));
      
      expect(defaultProps.onForward).toHaveBeenCalledWith(mockUserMessage);
    });

    it('should call onDelete when delete clicked', () => {
      render(<MessageBubble {...defaultProps} />);
      
      const menuButton = screen.getByTestId('more-vertical-icon').closest('button')!;
      fireEvent.click(menuButton);
      fireEvent.click(screen.getByText('Удалить'));
      
      expect(defaultProps.onDelete).toHaveBeenCalledWith(1);
    });
  });

  describe('Deleted Messages', () => {
    it('should show deleted message placeholder', () => {
      render(<MessageBubble {...defaultProps} message={mockDeletedMessage} />);
      
      expect(screen.getByText('Сообщение удалено')).toBeInTheDocument();
      expect(screen.getByTestId('ban-icon')).toBeInTheDocument();
    });

    it('should not show message content for deleted messages', () => {
      render(<MessageBubble {...defaultProps} message={mockDeletedMessage} />);
      
      expect(screen.queryByText('Hello from user')).not.toBeInTheDocument();
    });
  });

  describe('Message Content', () => {
    it('should render plain text content', () => {
      render(<MessageBubble {...defaultProps} />);
      
      expect(screen.getByText('Hello from user')).toBeInTheDocument();
    });

    it('should render markdown for AI messages when enabled', () => {
      render(<MessageBubble {...defaultProps} message={mockAIMessage} markdownEnabled={true} />);
      
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    });

    it('should render plain text for AI messages when markdown disabled', () => {
      render(<MessageBubble {...defaultProps} message={mockAIMessage} markdownEnabled={false} />);
      
      expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument();
      expect(screen.getByText('Hello from AI')).toBeInTheDocument();
    });

    it('should show API key error for specific content', () => {
      const apiKeyMessage = { ...mockAIMessage, content: 'No API key configured for this provider' };
      render(<MessageBubble {...defaultProps} message={apiKeyMessage} />);
      
      expect(screen.getByText('API ключ не настроен')).toBeInTheDocument();
      expect(screen.getByText('Открыть таблицу API Keys')).toBeInTheDocument();
      expect(screen.getByTestId('key-icon')).toBeInTheDocument();
    });

    it('should show typing indicator for streaming messages', () => {
      const { container } = render(<MessageBubble {...defaultProps} message={mockStreamingMessage} />);
      
      const dots = container.querySelectorAll('.animate-bounce');
      expect(dots).toHaveLength(3);
    });

    it('should show typing indicator for empty AI messages', () => {
      const emptyAIMessage = { ...mockAIMessage, content: '' };
      const { container } = render(<MessageBubble {...defaultProps} message={emptyAIMessage} />);
      
      const dots = container.querySelectorAll('.animate-bounce');
      expect(dots).toHaveLength(3);
    });
  });

  describe('Attachments', () => {
    it('should display message attachments', () => {
      render(<MessageBubble {...defaultProps} message={mockMessageWithAttachments} />);

      // PDF renders as text with file name
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      // Image renders as <img> with alt text (not plain text)
      expect(screen.getByAltText('image.jpg')).toBeInTheDocument();
    });

    it('should not show attachments section when none present', () => {
      render(<MessageBubble {...defaultProps} />);

      expect(screen.queryByText('document.pdf')).not.toBeInTheDocument();
    });
  });

  describe('Tool Results', () => {
    it('should display tool results section', () => {
      render(<MessageBubble {...defaultProps} message={mockMessageWithTools} />);
      
      expect(screen.getByText('Использовано 2 инструментов')).toBeInTheDocument();
      expect(screen.getByText('(2 итераций)')).toBeInTheDocument();
      expect(screen.getByTestId('wrench-icon')).toBeInTheDocument();
    });

    it('should show individual tool details', () => {
      render(<MessageBubble {...defaultProps} message={mockMessageWithTools} />);
      
      expect(screen.getByText('search')).toBeInTheDocument();
      expect(screen.getByText('calculate')).toBeInTheDocument();
    });

    it('should expand tool details when clicked', () => {
      render(<MessageBubble {...defaultProps} message={mockMessageWithTools} />);
      
      const searchTool = screen.getByText('search');
      fireEvent.click(searchTool);
      
      // Tool result should be visible in expanded state
      expect(screen.getByText(/"found": 5/)).toBeInTheDocument();
    });
  });

  describe('Reactions', () => {
    it('should display existing reactions', () => {
      render(<MessageBubble {...defaultProps} reactions={mockReactions} />);
      
      expect(screen.getByText('❤️')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument(); // Heart reaction count
      expect(screen.getByText('👍')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument(); // Thumbs up count
    });

    it('should show heart as filled when user has reacted', () => {
      render(<MessageBubble {...defaultProps} reactions={mockReactions} currentUserId={1} />);
      
      expect(screen.getByText('❤️')).toBeInTheDocument();
    });

    it('should show heart as empty when user has not reacted', () => {
      render(<MessageBubble {...defaultProps} reactions={{}} currentUserId={5} />);
      
      expect(screen.getByText('🤍')).toBeInTheDocument();
    });

    it('should call onReact when heart clicked', () => {
      render(<MessageBubble {...defaultProps} />);
      
      const heartButton = screen.getByText('🤍').closest('button')!;
      fireEvent.click(heartButton);
      
      expect(defaultProps.onReact).toHaveBeenCalledWith(1, '❤️');
    });

    it('should show reaction picker on hover', async () => {
      render(<MessageBubble {...defaultProps} />);
      
      const reactionArea = screen.getByText('🤍').closest('div')!;
      fireEvent.mouseEnter(reactionArea);
      
      await waitFor(() => {
        expect(screen.getByText('👍')).toBeInTheDocument();
        expect(screen.getByText('😂')).toBeInTheDocument();
      });
    });

    it('should call onReact when emoji from picker clicked', async () => {
      render(<MessageBubble {...defaultProps} />);
      
      const reactionArea = screen.getByText('🤍').closest('div')!;
      fireEvent.mouseEnter(reactionArea);
      
      await waitFor(() => {
        const thumbsUp = screen.getByText('👍');
        fireEvent.click(thumbsUp);
      });
      
      expect(defaultProps.onReact).toHaveBeenCalledWith(1, '👍');
    });

    it('should show plus button for mobile', () => {
      render(<MessageBubble {...defaultProps} />);
      
      expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
    });
  });

  describe('Timestamp', () => {
    it('should format timestamp correctly for today', () => {
      const today = new Date();
      const todayMessage = {
        ...mockUserMessage,
        timestamp: today
      };
      
      render(<MessageBubble {...defaultProps} message={todayMessage} />);
      
      const timeString = today.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      expect(screen.getByText(timeString)).toBeInTheDocument();
    });

    it('should format timestamp with date for older messages', () => {
      render(<MessageBubble {...defaultProps} />);
      
      // Should show date and time for messages not from today
      expect(screen.getByText(/20 янв/)).toBeInTheDocument();
    });

    it('should handle created_at timestamp', () => {
      const messageWithCreatedAt = { 
        ...mockUserMessage, 
        created_at: '2024-01-20T10:00:00Z' 
      } as ChatMessage & { created_at: string };
      
      render(<MessageBubble {...defaultProps} message={messageWithCreatedAt} />);
      
      expect(screen.getByText(/20 янв/)).toBeInTheDocument();
    });
  });

  describe('User Chat vs AI Chat', () => {
    it('should determine sender correctly for user chat', () => {
      render(<MessageBubble {...defaultProps} chatType="user" />);
      
      // Should use sender_id for user chats
      const { container } = render(<MessageBubble {...defaultProps} chatType="user" />);
      const messageContainer = container.querySelector('.group');
      expect(messageContainer).toHaveClass('justify-end'); // Own message
    });

    it('should determine sender correctly for AI chat', () => {
      render(<MessageBubble {...defaultProps} chatType="ai" />);
      
      // Should use role for AI chats
      const { container } = render(<MessageBubble {...defaultProps} chatType="ai" />);
      const messageContainer = container.querySelector('.group');
      expect(messageContainer).toHaveClass('justify-end'); // User role message
    });
  });
});