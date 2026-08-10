/**
 * ParticipantSelector Component Tests
 * ADR-024: Chat & Message Architecture
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ParticipantSelector, Participant } from '../ParticipantSelector';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn()
  }
}));

import { apiClient } from '@/shared/utils/apiClient';

const mockUsers = [
  { id: 1, name: 'John Doe', email: 'john@test.com', status: 'online' },
  { id: 2, name: 'Jane Smith', email: 'jane@test.com', status: 'offline' }
];

const mockAgents = [
  { id: 10, name: 'AI Assistant', description: 'General purpose assistant' },
  { id: 11, name: 'Code Helper', description: 'Programming assistant' }
];

describe('ParticipantSelector', () => {
  let queryClient: QueryClient;
  const mockOnSelect = vi.fn();
  const mockOnMultiSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    // Setup API mocks
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/users') {
        return Promise.resolve({ success: true, data: mockUsers });
      }
      if (url === '/ai-agents') {
        return Promise.resolve({ success: true, data: mockAgents });
      }
      return Promise.resolve({ success: false, data: [] });
    });
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ParticipantSelector
          onSelect={mockOnSelect}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it('should render placeholder when no value', () => {
    renderComponent();
    expect(screen.getByText('Выберите участника...')).toBeInTheDocument();
  });

  it('should show custom placeholder', () => {
    renderComponent({ placeholder: 'Select user' });
    expect(screen.getByText('Select user')).toBeInTheDocument();
  });

  it('should display selected value', () => {
    const value: Participant = { type: 'user', id: 1, name: 'John Doe' };
    renderComponent({ value });
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('should open dropdown on click', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
    });
  });

  it('should show tabs for filtering', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByText('Все')).toBeInTheDocument();
      expect(screen.getByText('Пользователи')).toBeInTheDocument();
      expect(screen.getByText('AI Агенты')).toBeInTheDocument();
    });
  });

  it('should load and display users', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  it('should load and display agents', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      expect(screen.getByText('Code Helper')).toBeInTheDocument();
    });
  });

  it('should call onSelect when participant clicked', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('John Doe'));
    
    expect(mockOnSelect).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user',
      id: 1,
      name: 'John Doe'
    }));
  });

  it('should filter participants by search', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    
    const searchInput = screen.getByPlaceholderText('Поиск...');
    fireEvent.change(searchInput, { target: { value: 'Jane' } });
    
    await waitFor(() => {
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  it('should filter by tab - users only', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('Пользователи'));
    
    await waitFor(() => {
      expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
  });

  it('should filter by tab - agents only', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('AI Агенты'));
    
    await waitFor(() => {
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
      expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    });
  });

  it('should support multi-select mode', async () => {
    const participants: Participant[] = [];
    renderComponent({ 
      multiSelect: true, 
      participants,
      onMultiSelect: mockOnMultiSelect 
    });
    
    fireEvent.click(screen.getByRole('button'));
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByText('John Doe'));
    
    expect(mockOnMultiSelect).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, name: 'John Doe' })
      ])
    );
  });

  it('should show participant count in multi-select', () => {
    const participants: Participant[] = [
      { type: 'user', id: 1, name: 'John' },
      { type: 'user', id: 2, name: 'Jane' }
    ];
    renderComponent({ multiSelect: true, participants });
    
    expect(screen.getByText('2 участник(ов)')).toBeInTheDocument();
  });

  it('should exclude specified user ids', async () => {
    renderComponent({ excludeIds: { users: [1] } });
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  it('should exclude specified agent ids', async () => {
    renderComponent({ excludeIds: { agents: [10] } });
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument();
      expect(screen.getByText('Code Helper')).toBeInTheDocument();
    });
  });

  it('should show AI badge for agents', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    });
    
    // Multiple AI badges expected
    const aiBadges = screen.getAllByText('AI');
    expect(aiBadges.length).toBeGreaterThan(0);
  });

  it('should close dropdown on outside click', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Выберите участника...'));
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
    });
    
    // Click outside
    fireEvent.mouseDown(document.body);
    
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Поиск...')).not.toBeInTheDocument();
    });
  });
});
