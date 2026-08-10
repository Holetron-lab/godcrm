import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TicketsPanel } from '../TicketsPanel';
import type { TicketsSource, TaskRow, Conversation, BoundRow } from '../../../types';

// Mock the TicketsSourceInlineSelector component
vi.mock('@/features/ai-chat/components/TicketsSourceInlineSelector', () => ({
  TicketsSourceInlineSelector: ({ onSelect, onCancel }: {
    onSelect?: (source: { tableId: string; tableName: string; tableIcon: string }) => void;
    onCancel?: () => void;
  }) => (
    <div data-testid="tickets-source-selector">
      <button onClick={() => onSelect?.({ tableId: 'table1', tableName: 'Test Table', tableIcon: '📋' })}>
        Select Table
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  )
}));

// Mock icons
vi.mock('lucide-react', () => ({
  ListTodo: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="list-todo-icon" {...props} />,
  Loader2: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="loader-icon" {...props} />,
  MessageSquare: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="message-square-icon" {...props} />,
  Plus: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="plus-icon" {...props} />,
  ChevronDown: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={className} data-testid="chevron-down-icon" {...props} />
}));

// Mock cn utility
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}));

describe('TicketsPanel', () => {
  const mockTicketsSource: TicketsSource = {
    tableId: 1,
    tableName: 'Test Tasks',
    tableIcon: '📋'
  };

  const mockTicketRows: TaskRow[] = [
    {
      id: 1,
      data: { name: 'Task 1', status: 'pending' }
    },
    {
      id: 2,
      data: { title: 'Task 2', status: 'completed' }
    },
    {
      id: 3,
      data: { Название: 'Task 3', status: 'in-progress' }
    }
  ];

  const mockConversations: Conversation[] = [
    {
      id: 1,
      title: 'Chat about Task 1',
      type: 'ai',
      updatedAt: '2024-01-20T10:00:00Z',
      metadata: {
        boundRow: { table_id: 1, row_id: 1, table_name: 'Test Tasks', table_icon: '📋', row_title: 'Task 1' }
      }
    },
    {
      id: 2,
      title: 'Another chat about Task 1',
      type: 'ai',
      updatedAt: '2024-01-21T10:00:00Z',
      metadata: {
        boundRow: { table_id: 1, row_id: 1, table_name: 'Test Tasks', table_icon: '📋', row_title: 'Task 1' }
      }
    }
  ];

  const defaultProps = {
    ticketsSource: mockTicketsSource,
    ticketRows: mockTicketRows,
    isLoadingTickets: false,
    conversations: mockConversations,
    expandedTicketChats: null,
    currentSpace: { id: 1, name: 'Test Space' },
    setTicketsSource: vi.fn(),
    setExpandedTicketChats: vi.fn(),
    createNewConversation: vi.fn(),
    setBoundRows: vi.fn(),
    setActivePanel: vi.fn(),
    selectConversation: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when ticketsSource is configured', () => {
    it('should render tickets source header with table info', () => {
      render(<TicketsPanel {...defaultProps} />);

      expect(screen.getByTestId('list-todo-icon')).toBeInTheDocument();
      expect(screen.getByText('📋 Test Tasks')).toBeInTheDocument();
      expect(screen.getByText('Изменить')).toBeInTheDocument();
    });

    it('should call setTicketsSource(undefined) when change button is clicked', () => {
      render(<TicketsPanel {...defaultProps} />);

      fireEvent.click(screen.getByText('Изменить'));
      expect(defaultProps.setTicketsSource).toHaveBeenCalledWith(undefined);
    });

    it('should show loading state when isLoadingTickets is true', () => {
      render(<TicketsPanel {...defaultProps} isLoadingTickets={true} />);

      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('should show empty state when no ticket rows', () => {
      render(<TicketsPanel {...defaultProps} ticketRows={[]} />);

      expect(screen.getByText('Нет записей')).toBeInTheDocument();
    });

    it('should render ticket rows with correct titles', () => {
      render(<TicketsPanel {...defaultProps} />);

      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
      expect(screen.getByText('Task 3')).toBeInTheDocument();
    });

    it('should show ticket IDs in badges', () => {
      render(<TicketsPanel {...defaultProps} />);

      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.getByText('#2')).toBeInTheDocument();
      expect(screen.getByText('#3')).toBeInTheDocument();
    });

    it('should show fallback title for ticket without name/title/Название', () => {
      const ticketWithoutTitle: TaskRow = {
        id: 4,
        data: { status: 'pending' }
      };

      render(<TicketsPanel {...defaultProps} ticketRows={[ticketWithoutTitle]} />);

      expect(screen.getByText('Запись #4')).toBeInTheDocument();
    });
  });

  describe('ticket chat interactions', () => {
    it('should create new conversation for ticket with no chats', () => {
      render(<TicketsPanel {...defaultProps} />);

      const chatButton = screen.getAllByTestId('message-square-icon')[1].closest('button')!;
      fireEvent.click(chatButton);

      expect(defaultProps.createNewConversation).toHaveBeenCalled();
      expect(defaultProps.setBoundRows).toHaveBeenCalledWith([{
        table_id: 1,
        table_name: 'Test Tasks',
        table_icon: '📋',
        row_id: 2,
        row_title: 'Task 2'
      }]);
      expect(defaultProps.setActivePanel).toHaveBeenCalledWith('none');
    });

    it('should select conversation for ticket with single chat', () => {
      // Create a ticket with only one conversation
      const singleChatConversations = [mockConversations[0]];

      render(<TicketsPanel {...defaultProps} conversations={singleChatConversations} />);

      const chatButton = screen.getAllByTestId('message-square-icon')[0].closest('button')!;
      fireEvent.click(chatButton);

      expect(defaultProps.selectConversation).toHaveBeenCalledWith(1);
      expect(defaultProps.setActivePanel).toHaveBeenCalledWith('none');
    });

    it('should toggle expanded state for ticket with multiple chats', () => {
      render(<TicketsPanel {...defaultProps} />);

      const chatButton = screen.getAllByTestId('message-square-icon')[0].closest('button')!;
      fireEvent.click(chatButton);

      expect(defaultProps.setExpandedTicketChats).toHaveBeenCalledWith(1);
    });

    it('should show chat count for tickets with multiple chats', () => {
      render(<TicketsPanel {...defaultProps} />);

      expect(screen.getByText('2')).toBeInTheDocument(); // Task 1 has 2 chats
    });

    it('should show plus icon for tickets with no chats', () => {
      render(<TicketsPanel {...defaultProps} />);

      const plusIcons = screen.getAllByTestId('plus-icon');
      expect(plusIcons.length).toBeGreaterThan(0);
    });

    it('should show chevron icon for tickets with multiple chats', () => {
      render(<TicketsPanel {...defaultProps} />);

      expect(screen.getByTestId('chevron-down-icon')).toBeInTheDocument();
    });
  });

  describe('expanded chat list', () => {
    it('should show expanded chat list when ticket is expanded', () => {
      render(<TicketsPanel {...defaultProps} expandedTicketChats={1} />);

      expect(screen.getByText('Chat about Task 1')).toBeInTheDocument();
      expect(screen.getByText('Another chat about Task 1')).toBeInTheDocument();
    });

    it('should select conversation when chat item is clicked', () => {
      render(<TicketsPanel {...defaultProps} expandedTicketChats={1} />);

      fireEvent.click(screen.getByText('Chat about Task 1'));

      expect(defaultProps.selectConversation).toHaveBeenCalledWith(1);
      expect(defaultProps.setActivePanel).toHaveBeenCalledWith('none');
      expect(defaultProps.setExpandedTicketChats).toHaveBeenCalledWith(null);
    });

    it('should show formatted dates for chat items', () => {
      render(<TicketsPanel {...defaultProps} expandedTicketChats={1} />);

      expect(screen.getByText('1/20/2024')).toBeInTheDocument();
      expect(screen.getByText('1/21/2024')).toBeInTheDocument();
    });

    it('should create new chat from expanded list', () => {
      render(<TicketsPanel {...defaultProps} expandedTicketChats={1} />);

      fireEvent.click(screen.getByText('Новый чат'));

      expect(defaultProps.createNewConversation).toHaveBeenCalled();
      expect(defaultProps.setBoundRows).toHaveBeenCalledWith([{
        table_id: 1,
        table_name: 'Test Tasks',
        table_icon: '📋',
        row_id: 1,
        row_title: 'Task 1'
      }]);
      expect(defaultProps.setActivePanel).toHaveBeenCalledWith('none');
      expect(defaultProps.setExpandedTicketChats).toHaveBeenCalledWith(null);
    });

    it('should rotate chevron icon when expanded', () => {
      render(<TicketsPanel {...defaultProps} expandedTicketChats={1} />);

      const chevron = screen.getByTestId('chevron-down-icon');
      expect(chevron).toHaveClass('rotate-180');
    });
  });

  describe('when ticketsSource is not configured', () => {
    it('should show empty state with icon and message', () => {
      render(<TicketsPanel {...defaultProps} ticketsSource={undefined} />);

      expect(screen.getByTestId('list-todo-icon')).toBeInTheDocument();
      expect(screen.getByText('Источник не настроен')).toBeInTheDocument();
      expect(screen.getByText('Выберите таблицу для тикетов')).toBeInTheDocument();
    });

    it('should render TicketsSourceInlineSelector', () => {
      render(<TicketsPanel {...defaultProps} ticketsSource={undefined} />);

      expect(screen.getByTestId('tickets-source-selector')).toBeInTheDocument();
    });

    it('should call setTicketsSource when table is selected', () => {
      render(<TicketsPanel {...defaultProps} ticketsSource={undefined} />);

      fireEvent.click(screen.getByText('Select Table'));

      expect(defaultProps.setTicketsSource).toHaveBeenCalledWith({
        tableId: 'table1',
        tableName: 'Test Table',
        tableIcon: '📋'
      });
    });
  });
});
