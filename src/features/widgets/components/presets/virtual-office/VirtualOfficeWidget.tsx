/**
 * @file VirtualOfficeWidget.tsx
 * @description Virtual Office Widget - displays WorkAdventure status in GOD CRM dashboard
 * @see ADR-063: WorkAdventure Virtual Office Integration
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { RefreshCw, Users, DoorOpen, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import type { Widget, WidgetDataRow } from '../../../types/widget.types';
import type {
  VirtualOfficeUser,
  VirtualOfficeRoom,
  VirtualOfficeStatus,
  VirtualOfficeConfig,
} from './__fixtures__/mockData';

// ============================================================================
// Types
// ============================================================================

export interface VirtualOfficeWidgetProps {
  widget: Widget;
  data?: WidgetDataRow[];
  /** Override status for testing/storybook */
  status?: VirtualOfficeStatus;
  /** Override loading state for testing/storybook */
  isLoading?: boolean;
  /** Override error state for testing/storybook */
  error?: string | null;
}

interface PresenceApiResponse {
  success: boolean;
  data: {
    users: Array<{
      userId: number;
      email: string;
      name: string;
      avatar: string | null;
      role: string;
      roomId: string;
      status: 'online' | 'offline';
      position: { x: number; y: number } | null;
      joinedAt: string;
      lastActivityAt: string;
    }>;
  };
}

interface SsoUrlResponse {
  success: boolean;
  data: {
    url: string;
    expiresAt: string;
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Transform API response to VirtualOfficeStatus
 */
function transformApiResponse(response: PresenceApiResponse): VirtualOfficeStatus {
  const users: VirtualOfficeUser[] = response.data.users
    .filter((u) => u.status === 'online')
    .map((u) => ({
      id: u.userId,
      name: u.name,
      email: u.email,
      avatar: u.avatar ?? undefined,
      room: u.roomId,
      status: 'online' as const,
      joinedAt: u.joinedAt,
    }));

  // Group users by room to calculate room counts
  const roomCounts = users.reduce<Record<string, number>>((acc, user) => {
    acc[user.room] = (acc[user.room] || 0) + 1;
    return acc;
  }, {});

  // Create rooms from unique room IDs
  const rooms: VirtualOfficeRoom[] = Object.entries(roomCounts).map(([roomId, count]) => ({
    id: roomId,
    name: formatRoomName(roomId),
    userCount: count,
    type: 'main' as const,
  }));

  return {
    isConnected: true,
    totalOnline: users.length,
    users,
    rooms,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Format room ID to display name
 */
function formatRoomName(roomId: string): string {
  return roomId
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => (word.charAt(0)?.toUpperCase() ?? '') + word.slice(1))
    .join(' ');
}

/**
 * Get config from widget with defaults
 */
function getConfig(widget: Widget): VirtualOfficeConfig {
  const config = widget.config || {};
  return {
    workadventureUrl: (config.workadventure_url as string) || 'https://wa.hltrn.cc',
    refreshInterval: (config.refresh_interval as number) || 30000,
    showUserList: config.show_user_list !== false,
    showRoomList: config.show_room_list !== false,
    enableMiniView: (config.enable_mini_view as boolean) || false,
  };
}

// ============================================================================
// Sub-components
// ============================================================================

interface LoadingSkeletonProps {
  className?: string;
}

function LoadingSkeleton({ className = '' }: LoadingSkeletonProps) {
  return (
    <div
      className={`p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 animate-pulse ${className}`}
      data-testid="loading-skeleton"
      aria-busy="true"
      aria-label="Loading virtual office status"
    >
      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
      <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-4" />
      <div className="space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
      </div>
    </div>
  );
}

interface ErrorStateProps {
  error: string;
  onRetry: () => void;
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-gray-900 dark:text-gray-100">
        <span aria-hidden="true">🏢</span> Virtual Office
      </h3>
      <div
        className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center"
        role="alert"
        aria-live="assertive"
      >
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          leftIcon={<RefreshCw className="w-4 h-4" />}
        >
          Retry
        </Button>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  onJoin: () => void;
  isJoining?: boolean;
}

function EmptyState({ onJoin, isJoining }: EmptyStateProps) {
  return (
    <div
      className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700"
      data-testid="virtual-office-widget"
    >
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-gray-900 dark:text-gray-100">
        <span aria-hidden="true">🏢</span> Virtual Office
      </h3>
      <div className="text-center py-8 text-gray-400" data-testid="empty-state">
        <div className="text-4xl mb-2" aria-hidden="true">
          👻
        </div>
        <p>No one online</p>
        <p className="text-sm">Be the first to join!</p>
      </div>
      <Button
        className="w-full mt-4"
        onClick={onJoin}
        disabled={isJoining}
        data-testid="join-office-button"
        aria-label="Join Virtual Office in new tab"
        leftIcon={isJoining ? <Loader2 className="w-4 h-4 animate-spin" /> : <DoorOpen className="w-4 h-4" />}
      >
        {isJoining ? 'Connecting...' : 'Join Office'}
      </Button>
    </div>
  );
}

interface UserAvatarsProps {
  users: VirtualOfficeUser[];
  maxVisible?: number;
}

function UserAvatars({ users, maxVisible = 5 }: UserAvatarsProps) {
  const visibleUsers = users.slice(0, maxVisible);
  const remainingCount = users.length - maxVisible;

  return (
    <div className="flex -space-x-2 mb-4" role="list" aria-label="Online users">
      {visibleUsers.map((user) => (
        <div
          key={user.id}
          className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 border-2 border-white dark:border-gray-800 flex items-center justify-center text-xs font-medium text-gray-700 dark:text-gray-200"
          title={user.name}
          role="listitem"
          data-testid="user-avatar"
          aria-label={`${user.name} - ${user.status}`}
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            String(user.name || '?').charAt(0).toUpperCase()
          )}
        </div>
      ))}
      {remainingCount > 0 && (
        <div
          className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 border-2 border-white dark:border-gray-800 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-300"
          aria-label={`${remainingCount} more users`}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  );
}

interface RoomListProps {
  rooms: VirtualOfficeRoom[];
}

function RoomList({ rooms }: RoomListProps) {
  const activeRooms = rooms.filter((room) => room.userCount > 0);

  if (activeRooms.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mb-4" data-testid="room-list">
      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Rooms</h4>
      <ul aria-label="Active rooms">
        {activeRooms.map((room) => (
          <li
            key={room.id}
            className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded"
          >
            <span className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
              {room.isLocked && (
                <span aria-label="Locked room" title="Locked">
                  🔒
                </span>
              )}
              {room.name}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Users className="w-3 h-3" aria-hidden="true" />
              {room.userCount}
              {room.maxCapacity && (
                <span className="text-gray-400 dark:text-gray-500">/{room.maxCapacity}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Virtual Office Widget
 *
 * Displays WorkAdventure virtual office status including:
 * - Online users count with live indicator
 * - User avatar stack
 * - Active rooms list with user counts
 * - "Join Office" button to open WorkAdventure
 *
 * @example
 * <VirtualOfficeWidget widget={widget} data={[]} />
 */
export function VirtualOfficeWidget({
  widget,
  data: _data,
  status: statusOverride,
  isLoading: isLoadingOverride,
  error: errorOverride,
}: VirtualOfficeWidgetProps) {
  const config = getConfig(widget);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Fetch presence data from API
  const {
    data: apiData,
    isLoading: apiLoading,
    error: apiError,
    refetch,
  } = useQuery({
    queryKey: ['wa-presence'],
    queryFn: async () => {
      logger.debug('[VirtualOfficeWidget] Fetching presence data');
      const response = await apiClient.get<PresenceApiResponse>('/wa/presence');
      return transformApiResponse(response);
    },
    refetchInterval: config.refreshInterval,
    enabled: !statusOverride, // Disable API call if status is provided (testing)
    retry: 2,
  });

  // SSO mutation - get token and redirect
  const ssoMutation = useMutation({
    mutationFn: async () => {
      logger.debug('[VirtualOfficeWidget] Getting SSO URL');
      const response = await apiClient.get<SsoUrlResponse>('/wa/sso-url');
      return response.data;
    },
    onSuccess: (data) => {
      logger.info('[VirtualOfficeWidget] Opening WorkAdventure with SSO:', data.url);
      setJoinError(null);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    },
    onError: (err) => {
      logger.error('[VirtualOfficeWidget] SSO error:', err);
      setJoinError('Failed to connect. Trying direct link...');
      // Fallback to direct URL without SSO
      setTimeout(() => {
        window.open(config.workadventureUrl, '_blank', 'noopener,noreferrer');
        setJoinError(null);
      }, 1000);
    },
  });

  // Use overrides for testing, otherwise use API data
  const isLoading = isLoadingOverride ?? apiLoading;
  const error = errorOverride ?? (apiError ? (apiError as Error).message : null);
  const status = statusOverride ?? apiData;

  // Handle Join Office button click - use SSO
  const handleJoinOffice = () => {
    ssoMutation.mutate();
  };

  // Handle retry
  const handleRetry = () => {
    logger.debug('[VirtualOfficeWidget] Retrying connection');
    refetch();
  };

  // Loading state
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (error) {
    return <ErrorState error={error} onRetry={handleRetry} />;
  }

  // Empty state
  if (!status || status.totalOnline === 0) {
    return <EmptyState onJoin={handleJoinOffice} isJoining={ssoMutation.isPending} />;
  }

  // Default state with users online
  return (
    <section
      className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700"
      data-testid="virtual-office-widget"
      aria-labelledby="virtual-office-title"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3
          id="virtual-office-title"
          className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-gray-100"
        >
          <span aria-hidden="true">🏢</span> Virtual Office
        </h3>
        <div
          className="flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full"
          data-testid="online-count"
          role="status"
          aria-live="polite"
          aria-label={`${status.totalOnline} users online`}
        >
          <span
            className="w-2 h-2 bg-green-500 rounded-full animate-pulse motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="font-medium">{status.totalOnline}</span>
          <span className="text-sm">online</span>
        </div>
      </div>

      {/* User Avatars */}
      {config.showUserList && <UserAvatars users={status.users} />}

      {/* Room List */}
      {config.showRoomList && <RoomList rooms={status.rooms} />}

      {/* Join Error */}
      {joinError && (
        <div className="mb-2 text-sm text-amber-600 dark:text-amber-400 text-center">
          {joinError}
        </div>
      )}

      {/* Join Button */}
      <Button
        className="w-full"
        onClick={handleJoinOffice}
        disabled={ssoMutation.isPending}
        data-testid="join-office-button"
        aria-label="Join Virtual Office in new tab"
        leftIcon={ssoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <DoorOpen className="w-4 h-4" />}
      >
        {ssoMutation.isPending ? 'Connecting...' : 'Join Office'}
      </Button>
    </section>
  );
}

export default VirtualOfficeWidget;
