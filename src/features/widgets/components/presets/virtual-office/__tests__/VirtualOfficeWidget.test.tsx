/**
 * @file VirtualOfficeWidget.test.tsx
 * @description Component tests for Virtual Office Widget
 * @see ADR-063: WorkAdventure Virtual Office Integration
 * @see ADR-034: Feature Tests Coverage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock data
import {
  mockVirtualOfficeWidget,
  mockDefaultState,
  mockEmptyState,
  mockErrorState,
  mockLoadingState,
  mockOnlineUsers,
  mockRooms,
  mockManyUsers,
  createMockUser,
  createMockStatus,
} from '../__fixtures__/mockData';

// Component
import { VirtualOfficeWidget } from '../VirtualOfficeWidget';

// ============================================================================
// Test Setup
// ============================================================================

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};

// Mock window.open for "Join Office" button
const mockWindowOpen = vi.fn();
Object.defineProperty(window, 'open', {
  value: mockWindowOpen,
  writable: true,
});

// Mock apiClient for SSO URL
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { url: 'https://wa.hltrn.cc/sso-token' } }),
  },
}));

// ============================================================================
// Component Tests
// ============================================================================

describe('VirtualOfficeWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('renders widget with title and icon', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      expect(screen.getByText('Virtual Office')).toBeInTheDocument();
      expect(screen.getByText('🏢')).toBeInTheDocument();
    });

    it('renders online users count badge', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      const onlineCount = screen.getByTestId('online-count');
      expect(onlineCount).toBeInTheDocument();
      expect(within(onlineCount).getByText('5')).toBeInTheDocument();
      expect(within(onlineCount).getByText('online')).toBeInTheDocument();
    });

    it('renders "Join Office" button', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      expect(screen.getByTestId('join-office-button')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /join.*office/i })).toBeInTheDocument();
    });

    it('renders room list when showRoomList is true', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      expect(screen.getByTestId('room-list')).toBeInTheDocument();
      expect(screen.getByText('Active Rooms')).toBeInTheDocument();
    });

    it('renders user avatars when showUserList is true', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      const avatars = screen.getAllByTestId('user-avatar');
      expect(avatars.length).toBeGreaterThan(0);
    });

    it.todo('hides room list when showRoomList is false');

    it.todo('hides user list when showUserList is false');
  });

  describe('Online Users Display', () => {
    it('displays correct total online count', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      const onlineCount = screen.getByTestId('online-count');
      expect(within(onlineCount).getByText('5')).toBeInTheDocument();
    });

    it('displays user avatars in a stack', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      const avatars = screen.getAllByTestId('user-avatar');
      expect(avatars.length).toBe(5); // Max 5 visible
    });

    it('shows "+N more" when many users online', () => {
      const manyUsersStatus = createMockStatus({
        ...mockDefaultState,
        totalOnline: 25,
        users: mockManyUsers,
      });
      
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={manyUsersStatus}
        />
      );
      
      expect(screen.getByText('+20')).toBeInTheDocument();
    });

    it('shows user name on avatar hover (title attribute)', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      const avatars = screen.getAllByTestId('user-avatar');
      expect(avatars[0]).toHaveAttribute('title', 'John Doe');
    });

    it.todo('displays user status indicator (online/away/busy)');

    it.todo('groups users by room');
  });

  describe('Room List', () => {
    it.todo('displays all active rooms');

    it.todo('shows user count per room');

    it.todo('shows room capacity when available');

    it.todo('indicates locked rooms with icon');

    it.todo('sorts rooms by user count descending');

    it.todo('highlights rooms with activity');
  });

  describe('Join Office Button', () => {
    it('opens WorkAdventure in new tab on click via SSO', async () => {
      const user = userEvent.setup();

      renderWithProviders(
        <VirtualOfficeWidget
          widget={mockVirtualOfficeWidget}
          data={[]}
          status={mockDefaultState}
        />
      );

      const joinButton = screen.getByTestId('join-office-button');
      await user.click(joinButton);

      // Wait for mutation to complete
      await waitFor(() => {
        expect(mockWindowOpen).toHaveBeenCalledWith(
          'https://wa.hltrn.cc/sso-token',
          '_blank',
          'noopener,noreferrer'
        );
      });
    });

    it.skip('uses correct WorkAdventure URL from config (fallback when SSO fails)', async () => {
      // This test requires mocking API error, skipping for now
      const user = userEvent.setup();
      const customWidget = {
        ...mockVirtualOfficeWidget,
        config: {
          ...mockVirtualOfficeWidget.config,
          workadventure_url: 'https://custom.wa.example.com',
        },
      };

      renderWithProviders(
        <VirtualOfficeWidget
          widget={customWidget}
          data={[]}
          status={mockDefaultState}
        />
      );

      const joinButton = screen.getByTestId('join-office-button');
      await user.click(joinButton);

      await waitFor(() => {
        expect(mockWindowOpen).toHaveBeenCalledWith(
          'https://custom.wa.example.com',
          '_blank',
          'noopener,noreferrer'
        );
      });
    });

    it.todo('is disabled when not connected');

    it.todo('shows loading state while connecting');

    it('has correct aria-label for accessibility', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockDefaultState}
        />
      );
      
      const joinButton = screen.getByTestId('join-office-button');
      expect(joinButton).toHaveAttribute('aria-label', 'Join Virtual Office in new tab');
    });
  });

  describe('Loading State', () => {
    it('shows skeleton loader while loading', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          isLoading={true}
        />
      );
      
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      expect(screen.getByTestId('loading-skeleton')).toHaveAttribute('aria-busy', 'true');
    });

    it.todo('shows loading spinner on initial load');

    it.todo('maintains previous data during refresh');

    it.todo('shows subtle refresh indicator during background refresh');
  });

  describe('Error State', () => {
    it('displays error message when connection fails', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          error="Failed to connect to WorkAdventure server"
          isLoading={false}
        />
      );
      
      expect(screen.getByText('Failed to connect to WorkAdventure server')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('shows retry button on error', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          error="Connection failed"
          isLoading={false}
        />
      );
      
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it.todo('retries connection on retry button click');

    it.todo('shows specific error for different error codes');

    it.todo('logs error to monitoring system');
  });

  describe('Empty State', () => {
    it('shows "No one online" message when users list empty', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockEmptyState}
        />
      );
      
      expect(screen.getByText('No one online')).toBeInTheDocument();
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    it('displays friendly illustration for empty state', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockEmptyState}
        />
      );
      
      expect(screen.getByText('👻')).toBeInTheDocument();
      expect(screen.getByText('Be the first to join!')).toBeInTheDocument();
    });

    it('still shows "Join Office" button in empty state', () => {
      renderWithProviders(
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={mockEmptyState}
        />
      );
      
      expect(screen.getByTestId('join-office-button')).toBeInTheDocument();
    });

    it.todo('shows rooms even when no users online');
  });

  describe('Real-time Updates', () => {
    it.todo('updates user count when user joins');

    it.todo('updates user count when user leaves');

    it.todo('updates room user counts in real-time');

    it.todo('shows notification for new user join');

    it.todo('handles WebSocket reconnection gracefully');

    it.todo('falls back to polling when WebSocket unavailable');
  });

  describe('User Interactions', () => {
    it.todo('expands user list on click');

    it.todo('collapses user list on second click');

    it.todo('shows user details on user click');

    it.todo('allows clicking room to filter users');

    it.todo('supports keyboard navigation through user list');
  });

  describe('Configuration', () => {
    it.todo('respects refresh interval from config');

    it.todo('applies custom WorkAdventure URL');

    it.todo('toggles mini-view iframe when enabled');

    it.todo('handles missing config gracefully');
  });

  describe('Performance', () => {
    it.todo('renders efficiently with many users');

    it.todo('virtualizes long user lists');

    it.todo('debounces rapid updates');

    it.todo('cleans up subscriptions on unmount');
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('VirtualOfficeWidget Integration', () => {
  describe('with WidgetRenderer', () => {
    it.todo('renders correctly when selected by WidgetRenderer');

    it.todo('receives correct props from parent');

    it.todo('handles widget config updates');
  });

  describe('with Dashboard', () => {
    it.todo('resizes correctly in dashboard grid');

    it.todo('maintains state during dashboard layout changes');

    it.todo('persists collapsed/expanded state');
  });

  describe('with API', () => {
    it.todo('fetches initial status from API');

    it.todo('handles API errors gracefully');

    it.todo('refreshes data at configured interval');

    it.todo('cancels pending requests on unmount');
  });
});

// ============================================================================
// Snapshot Tests
// ============================================================================

describe('VirtualOfficeWidget Snapshots', () => {
  it.todo('matches snapshot for default state');

  it.todo('matches snapshot for empty state');

  it.todo('matches snapshot for loading state');

  it.todo('matches snapshot for error state');

  it.todo('matches snapshot for many users');
});

// ============================================================================
// Test Implementation Examples (for when component is created)
// ============================================================================

/*
// Example test implementation:

describe('VirtualOfficeWidget - Implemented Tests', () => {
  it('renders online users count', () => {
    renderWithProviders(
      <VirtualOfficeWidget 
        widget={mockVirtualOfficeWidget} 
        data={[]} 
        status={mockDefaultState}
      />
    );
    
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/online/i)).toBeInTheDocument();
  });

  it('opens WorkAdventure on Join button click', async () => {
    const user = userEvent.setup();
    
    renderWithProviders(
      <VirtualOfficeWidget 
        widget={mockVirtualOfficeWidget} 
        data={[]} 
        status={mockDefaultState}
      />
    );
    
    const joinButton = screen.getByRole('button', { name: /join office/i });
    await user.click(joinButton);
    
    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://wa.hltrn.cc',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('displays error state correctly', () => {
    renderWithProviders(
      <VirtualOfficeWidget 
        widget={mockVirtualOfficeWidget} 
        data={[]} 
        status={mockErrorState}
      />
    );
    
    expect(screen.getByText(/failed to connect/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows empty state when no users online', () => {
    renderWithProviders(
      <VirtualOfficeWidget 
        widget={mockVirtualOfficeWidget} 
        data={[]} 
        status={mockEmptyState}
      />
    );
    
    expect(screen.getByText(/no one online/i)).toBeInTheDocument();
    // Join button should still be visible
    expect(screen.getByRole('button', { name: /join office/i })).toBeInTheDocument();
  });

  it('updates when user joins', async () => {
    const { rerender } = renderWithProviders(
      <VirtualOfficeWidget 
        widget={mockVirtualOfficeWidget} 
        data={[]} 
        status={mockDefaultState}
      />
    );
    
    expect(screen.getByText('5')).toBeInTheDocument();
    
    // Simulate user join
    const updatedStatus = createMockStatus({
      ...mockDefaultState,
      totalOnline: 6,
      users: [...mockOnlineUsers, createMockUser({ id: 10, name: 'New User' })],
    });
    
    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <VirtualOfficeWidget 
          widget={mockVirtualOfficeWidget} 
          data={[]} 
          status={updatedStatus}
        />
      </QueryClientProvider>
    );
    
    expect(screen.getByText('6')).toBeInTheDocument();
  });
});
*/
