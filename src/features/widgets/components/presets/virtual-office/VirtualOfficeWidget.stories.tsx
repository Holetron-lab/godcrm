/**
 * @file VirtualOfficeWidget.stories.tsx
 * @description Storybook stories for Virtual Office Widget
 * @see ADR-063: WorkAdventure Virtual Office Integration
 * 
 * NOTE: This file is prepared for when the component is created.
 * Uncomment and adjust when VirtualOfficeWidget is implemented.
 */
import type { Meta, StoryObj } from '@storybook/react';
// import { within, userEvent, expect, fn } from '@storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock data
import {
  mockVirtualOfficeWidget,
  mockDefaultState,
  mockEmptyState,
  mockErrorState,
  mockLoadingState,
  mockManyUsers,
  mockRooms,
  mockOnlineUsers,
  type VirtualOfficeStatus,
} from './__fixtures__/mockData';

// Component will be imported when created
// import { VirtualOfficeWidget } from './VirtualOfficeWidget';

// ============================================================================
// Placeholder Component (remove when real component exists)
// ============================================================================

interface VirtualOfficeWidgetProps {
  widget: typeof mockVirtualOfficeWidget;
  data?: unknown[];
  status?: VirtualOfficeStatus;
  isLoading?: boolean;
  error?: string | null;
}

// Placeholder component for Storybook development
function VirtualOfficeWidgetPlaceholder({
  status = mockDefaultState,
  isLoading = false,
  error = null,
}: VirtualOfficeWidgetProps) {
  if (isLoading) {
    return (
      <div className="p-4 bg-white rounded-lg shadow border animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-10 bg-gray-200 rounded w-1/4 mb-4" />
        <div className="space-y-2">
          <div className="h-4 bg-gray-200 rounded w-full" />
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-white rounded-lg shadow border">
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <span>🏢</span> Virtual Office
        </h3>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center" role="alert">
          <p className="text-red-600 mb-2">{error}</p>
          <button className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status.totalOnline === 0) {
    return (
      <div className="p-4 bg-white rounded-lg shadow border">
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <span>🏢</span> Virtual Office
        </h3>
        <div className="text-center py-8 text-gray-400" data-testid="empty-state">
          <div className="text-4xl mb-2">👻</div>
          <p>No one online</p>
          <p className="text-sm">Be the first to join!</p>
        </div>
        <button
          className="w-full mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          data-testid="join-office-button"
        >
          Join Office
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow border" data-testid="virtual-office-widget">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span>🏢</span> Virtual Office
        </h3>
        <div
          className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-700 rounded-full"
          data-testid="online-count"
          aria-label={`${status.totalOnline} users online`}
        >
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="font-medium">{status.totalOnline}</span>
          <span className="text-sm">online</span>
        </div>
      </div>

      {/* User Avatars */}
      <div className="flex -space-x-2 mb-4">
        {status.users.slice(0, 5).map((user, idx) => (
          <div
            key={user.id}
            className="w-8 h-8 rounded-full bg-gray-300 border-2 border-white flex items-center justify-center text-xs font-medium"
            title={user.name}
            data-testid="user-avatar"
          >
            {String(user.name || '?').charAt(0)}
          </div>
        ))}
        {status.users.length > 5 && (
          <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs font-medium">
            +{status.users.length - 5}
          </div>
        )}
      </div>

      {/* Room List */}
      <div className="space-y-2 mb-4" data-testid="room-list">
        <h4 className="text-sm font-medium text-gray-500">Active Rooms</h4>
        {status.rooms
          .filter((room) => room.userCount > 0)
          .map((room) => (
            <div
              key={room.id}
              className="flex items-center justify-between p-2 bg-gray-50 rounded"
            >
              <span className="text-sm">{room.name}</span>
              <span className="text-xs text-gray-500">{room.userCount} users</span>
            </div>
          ))}
      </div>

      {/* Join Button */}
      <button
        className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        data-testid="join-office-button"
        aria-label="Join Virtual Office in new tab"
      >
        🚀 Join Office
      </button>
    </div>
  );
}

// ============================================================================
// Storybook Configuration
// ============================================================================

const meta: Meta<typeof VirtualOfficeWidgetPlaceholder> = {
  title: 'Widgets/VirtualOfficeWidget',
  component: VirtualOfficeWidgetPlaceholder,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## Virtual Office Widget

Displays WorkAdventure virtual office status in the GOD CRM dashboard.

### Features
- Online users count with live indicator
- User avatar stack
- Active rooms list with user counts
- "Join Office" button to open WorkAdventure
- Loading, error, and empty states

### ADR Reference
See [ADR-063: WorkAdventure Virtual Office Integration](../../../docs/architecture/ADR-063-WORKADVENTURE-INTEGRATION.md)
        `,
      },
    },
  },
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      });
      return (
        <QueryClientProvider client={queryClient}>
          <div className="w-80">
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
  argTypes: {
    status: {
      control: 'object',
      description: 'Virtual office status data',
    },
    isLoading: {
      control: 'boolean',
      description: 'Show loading state',
    },
    error: {
      control: 'text',
      description: 'Error message to display',
    },
  },
};

export default meta;
type Story = StoryObj<typeof VirtualOfficeWidgetPlaceholder>;

// ============================================================================
// Stories
// ============================================================================

/**
 * Default state with 5 users online
 */
export const Default: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: mockDefaultState,
  },
};

/**
 * Loading state with skeleton
 */
export const Loading: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    isLoading: true,
  },
};

/**
 * Empty state when no users are online
 */
export const Empty: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: mockEmptyState,
  },
};

/**
 * Error state with retry button
 */
export const Error: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    error: 'Failed to connect to WorkAdventure server',
  },
};

/**
 * Many users online (25+)
 */
export const ManyUsers: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: {
      ...mockDefaultState,
      totalOnline: 25,
      users: mockManyUsers,
    },
  },
};

/**
 * Single user online
 */
export const SingleUser: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: {
      ...mockDefaultState,
      totalOnline: 1,
      users: [mockOnlineUsers[0]],
      rooms: mockRooms.map((r) => ({
        ...r,
        userCount: r.id === 'main-hall' ? 1 : 0,
      })),
    },
  },
};

/**
 * Mobile viewport
 */
export const Mobile: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: mockDefaultState,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

/**
 * Dark theme
 */
export const Dark: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: mockDefaultState,
  },
  parameters: {
    backgrounds: {
      default: 'dark',
    },
  },
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
};

// ============================================================================
// Interaction Tests
// ============================================================================

/**
 * Interactive story with click test
 */
export const WithInteraction: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: mockDefaultState,
  },
  play: async ({ canvasElement }) => {
    // Uncomment when @storybook/test is available
    // const canvas = within(canvasElement);
    // 
    // // Verify widget is rendered
    // await expect(canvas.getByTestId('virtual-office-widget')).toBeInTheDocument();
    // 
    // // Verify online count
    // await expect(canvas.getByTestId('online-count')).toHaveTextContent('5');
    // 
    // // Click Join Office button
    // const joinButton = canvas.getByTestId('join-office-button');
    // await userEvent.click(joinButton);
    // 
    // // Verify button was clicked (in real test, would check window.open)
  },
};

/**
 * Keyboard navigation test
 */
export const KeyboardNavigation: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: mockDefaultState,
  },
  play: async ({ canvasElement }) => {
    // Uncomment when @storybook/test is available
    // const canvas = within(canvasElement);
    // 
    // // Tab to Join Office button
    // await userEvent.tab();
    // 
    // // Verify button is focused
    // const joinButton = canvas.getByTestId('join-office-button');
    // await expect(joinButton).toHaveFocus();
    // 
    // // Press Enter to activate
    // await userEvent.keyboard('{Enter}');
  },
};

// ============================================================================
// Accessibility Stories
// ============================================================================

/**
 * Accessibility-focused story
 */
export const Accessible: Story = {
  args: {
    widget: mockVirtualOfficeWidget,
    status: mockDefaultState,
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: true },
          { id: 'button-name', enabled: true },
          { id: 'image-alt', enabled: true },
        ],
      },
    },
  },
};
