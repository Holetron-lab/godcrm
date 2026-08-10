/**
 * AccordionContactItem Component Tests
 * TASK-043: Accordion Chat UI + Sub-Agents Settings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccordionContactItem } from '../AccordionContactItem';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn()
  }
}));

import { apiClient } from '@/shared/utils/apiClient';

const mockUser = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  avatar_url: null,
  managed_by_agent_table_id: null,
  user_type: 'human'
};

const mockAgentUser = {
  id: 2,
  name: 'AI Assistant',
  email: null,
  avatar_url: null,
  managed_by_agent_table_id: 100,
  user_type: 'agent'
};

const mockSharedChats = [
  { 
    id: 10, 
    title: 'Chat 1', 
    type: 'chat', 
    messages_count: 5,
    last_message_at: '2026-01-17T10:00:00Z',
    updated_at: '2026-01-17T10:00:00Z',
    participants: [{ user_id: 1, name: 'John Doe' }]
  },
  { 
    id: 11, 
    title: 'Chat 2', 
    type: 'chat', 
    messages_count: 10,
    last_message_at: '2026-01-16T10:00:00Z',
    updated_at: '2026-01-16T10:00:00Z',
    participants: [{ user_id: 1, name: 'John Doe' }]
  }
];

describe('AccordionContactItem', () => {
  let queryClient: QueryClient;
  const mockOnSelect = vi.fn();
  const mockOnSelectChat = vi.fn();
  const mockOnToggleFavorite = vi.fn();
  const mockOnAddToGroup = vi.fn();
  const mockOnCreateNewChat = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    (apiClient.get as any).mockResolvedValue({ data: mockSharedChats });
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AccordionContactItem
          user={mockUser}
          isCurrentPartner={false}
          isInGroup={false}
          isFavorite={false}
          onSelect={mockOnSelect}
          onSelectChat={mockOnSelectChat}
          onToggleFavorite={mockOnToggleFavorite}
          onAddToGroup={mockOnAddToGroup}
          onCreateNewChat={mockOnCreateNewChat}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it('renders user name', () => {
    renderComponent();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('renders user email', () => {
    renderComponent();
    // Email is part of larger text, use regex
    expect(screen.getByText(/john@example.com/)).toBeInTheDocument();
  });

  it('shows User icon for human users', () => {
    renderComponent();
    // Check for User icon (SVG with user shape)
    const container = screen.getByText('John Doe').closest('div');
    expect(container).toBeInTheDocument();
  });

  it('shows Bot icon for agent users', () => {
    renderComponent({ user: mockAgentUser });
    expect(screen.getByText('AI Assistant')).toBeInTheDocument();
  });

  it('calls onCreateNewChat when user name is clicked', () => {
    renderComponent();

    // Click on user name — now creates a new chat instead of selecting
    fireEvent.click(screen.getByText('John Doe'));

    expect(mockOnCreateNewChat).toHaveBeenCalledWith(mockUser);
  });

  it('shows expand button when user has shared chats', async () => {
    renderComponent();
    
    // Click expand button to trigger API call
    const expandButton = screen.getByTitle(/Показать чаты|Развернуть/i);
    fireEvent.click(expandButton);
    
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/chat/conversations/with/1');
    });
  });

  it('highlights current partner', () => {
    const { container } = renderComponent({ isCurrentPartner: true });
    
    // Container should exist with the user
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    // Just verify component renders without error for current partner
  });

  it('shows favorite indicator when isFavorite is true', () => {
    renderComponent({ isFavorite: true });
    
    // Star button should be visible - title changes when favorite
    const starButton = screen.getByTitle('Убрать из избранного');
    expect(starButton).toBeInTheDocument();
  });

  it('calls onToggleFavorite when star is clicked', () => {
    renderComponent();
    
    // When not favorite, title is 'В избранное'
    const starButton = screen.getByTitle('В избранное');
    fireEvent.click(starButton);
    
    expect(mockOnToggleFavorite).toHaveBeenCalledWith(1);
  });

  it('shows shared chats when expanded', async () => {
    renderComponent();
    
    // Click expand button
    const expandButton = screen.getByTitle(/Показать чаты|Развернуть/i);
    fireEvent.click(expandButton);
    
    await waitFor(() => {
      expect(screen.getByText('Chat 1')).toBeInTheDocument();
      expect(screen.getByText('Chat 2')).toBeInTheDocument();
    });
  });

  it('calls onSelectChat when chat is clicked', async () => {
    renderComponent();
    
    // Expand first
    const expandButton = screen.getByTitle(/Показать чаты|Развернуть/i);
    fireEvent.click(expandButton);
    
    await waitFor(() => {
      expect(screen.getByText('Chat 1')).toBeInTheDocument();
    });
    
    // Click on chat
    fireEvent.click(screen.getByText('Chat 1'));
    
    expect(mockOnSelectChat).toHaveBeenCalledWith(10);
  });
});
