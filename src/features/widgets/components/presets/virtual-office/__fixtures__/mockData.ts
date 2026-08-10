/**
 * @file mockData.ts
 * @description Mock data fixtures for Virtual Office Widget tests
 * @see ADR-063: WorkAdventure Virtual Office Integration
 */

// ============================================================================
// Types
// ============================================================================

export interface VirtualOfficeUser {
  id: number;
  name: string;
  email: string;
  avatar?: string;
  room: string;
  status: 'online' | 'away' | 'busy';
  joinedAt: string;
}

export interface VirtualOfficeRoom {
  id: string;
  name: string;
  userCount: number;
  maxCapacity?: number;
  type: 'main' | 'meeting' | 'quiet' | 'social';
  isLocked?: boolean;
}

export interface VirtualOfficeStatus {
  isConnected: boolean;
  totalOnline: number;
  users: VirtualOfficeUser[];
  rooms: VirtualOfficeRoom[];
  lastUpdated: string;
}

export interface VirtualOfficeConfig {
  workadventureUrl: string;
  refreshInterval: number;
  showUserList: boolean;
  showRoomList: boolean;
  enableMiniView: boolean;
}

// ============================================================================
// Mock Users
// ============================================================================

export const mockOnlineUsers: VirtualOfficeUser[] = [
  {
    id: 1,
    name: 'John Doe',
    email: 'john@example.com',
    avatar: '/avatars/john.png',
    room: 'Main Hall',
    status: 'online',
    joinedAt: '2026-01-28T09:00:00Z',
  },
  {
    id: 2,
    name: 'Jane Smith',
    email: 'jane@example.com',
    avatar: '/avatars/jane.png',
    room: 'Meeting Room 1',
    status: 'busy',
    joinedAt: '2026-01-28T09:15:00Z',
  },
  {
    id: 3,
    name: 'Bob Wilson',
    email: 'bob@example.com',
    avatar: '/avatars/bob.png',
    room: 'Quiet Zone',
    status: 'away',
    joinedAt: '2026-01-28T08:30:00Z',
  },
  {
    id: 4,
    name: 'Alice Brown',
    email: 'alice@example.com',
    room: 'Main Hall',
    status: 'online',
    joinedAt: '2026-01-28T10:00:00Z',
  },
  {
    id: 5,
    name: 'Charlie Davis',
    email: 'charlie@example.com',
    avatar: '/avatars/charlie.png',
    room: 'Social Lounge',
    status: 'online',
    joinedAt: '2026-01-28T09:45:00Z',
  },
];

export const mockManyUsers: VirtualOfficeUser[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  room: ['Main Hall', 'Meeting Room 1', 'Quiet Zone', 'Social Lounge'][i % 4],
  status: (['online', 'away', 'busy'] as const)[i % 3],
  joinedAt: new Date(Date.now() - i * 60000).toISOString(),
}));

// ============================================================================
// Mock Rooms
// ============================================================================

export const mockRooms: VirtualOfficeRoom[] = [
  {
    id: 'main-hall',
    name: 'Main Hall',
    userCount: 5,
    maxCapacity: 50,
    type: 'main',
  },
  {
    id: 'meeting-1',
    name: 'Meeting Room 1',
    userCount: 2,
    maxCapacity: 8,
    type: 'meeting',
  },
  {
    id: 'meeting-2',
    name: 'Meeting Room 2',
    userCount: 0,
    maxCapacity: 8,
    type: 'meeting',
  },
  {
    id: 'quiet-zone',
    name: 'Quiet Zone',
    userCount: 1,
    maxCapacity: 10,
    type: 'quiet',
  },
  {
    id: 'social-lounge',
    name: 'Social Lounge',
    userCount: 3,
    maxCapacity: 20,
    type: 'social',
  },
];

export const mockLockedRoom: VirtualOfficeRoom = {
  id: 'private-meeting',
  name: 'Private Meeting',
  userCount: 4,
  maxCapacity: 6,
  type: 'meeting',
  isLocked: true,
};

// ============================================================================
// Mock States
// ============================================================================

export const mockDefaultState: VirtualOfficeStatus = {
  isConnected: true,
  totalOnline: 5,
  users: mockOnlineUsers,
  rooms: mockRooms,
  lastUpdated: '2026-01-28T10:30:00Z',
};

export const mockEmptyState: VirtualOfficeStatus = {
  isConnected: true,
  totalOnline: 0,
  users: [],
  rooms: mockRooms.map((room) => ({ ...room, userCount: 0 })),
  lastUpdated: '2026-01-28T10:30:00Z',
};

export const mockLoadingState = {
  isLoading: true,
  isConnected: false,
  totalOnline: 0,
  users: [],
  rooms: [],
};

export const mockErrorState = {
  isConnected: false,
  error: 'Failed to connect to WorkAdventure server',
  errorCode: 'CONNECTION_FAILED',
  totalOnline: 0,
  users: [],
  rooms: [],
};

export const mockDisconnectedState = {
  isConnected: false,
  error: 'WebSocket connection lost. Reconnecting...',
  errorCode: 'DISCONNECTED',
  totalOnline: 0,
  users: [],
  rooms: [],
};

// ============================================================================
// Mock Widget Configuration
// ============================================================================

export const mockWidgetConfig: VirtualOfficeConfig = {
  workadventureUrl: 'https://wa.hltrn.cc',
  refreshInterval: 30000, // 30 seconds
  showUserList: true,
  showRoomList: true,
  enableMiniView: false,
};

export const mockMinimalConfig: VirtualOfficeConfig = {
  workadventureUrl: 'https://wa.hltrn.cc',
  refreshInterval: 60000,
  showUserList: false,
  showRoomList: false,
  enableMiniView: false,
};

export const mockIframeConfig: VirtualOfficeConfig = {
  workadventureUrl: 'https://wa.hltrn.cc',
  refreshInterval: 30000,
  showUserList: true,
  showRoomList: true,
  enableMiniView: true,
};

// ============================================================================
// Mock Widget Data (for WidgetRenderer)
// ============================================================================

import type { Widget, WidgetDataRow } from '../../../../types/widget.types';

export const mockVirtualOfficeWidget: Widget = {
  id: 200,
  dashboard_id: 1,
  source_widget_id: null,
  widget_type: 'preset',
  preset_name: 'virtual_office' as any, // Will be added to PresetWidgetName
  code: null,
  code_version: 1,
  title: 'Virtual Office',
  description: 'WorkAdventure virtual office status',
  icon: '🏢',
  config: {
    workadventure_url: 'https://wa.hltrn.cc',
    refresh_interval: 30000,
    show_user_list: true,
    show_room_list: true,
  },
  position: { x: 0, y: 0, w: 4, h: 6 },
  is_visible: true,
  order_index: 0,
  created_by: 1,
  created_at: '2026-01-28T10:00:00Z',
  updated_at: '2026-01-28T10:00:00Z',
};

export const mockWidgetData: WidgetDataRow[] = mockOnlineUsers.map((user) => ({
  id: user.id,
  data: {
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    room: user.room,
    status: user.status,
  },
}));

// ============================================================================
// Mock API Responses
// ============================================================================

export const mockApiSuccessResponse = {
  success: true,
  data: mockDefaultState,
  timestamp: '2026-01-28T10:30:00Z',
};

export const mockApiErrorResponse = {
  success: false,
  error: {
    code: 'WA_CONNECTION_ERROR',
    message: 'Failed to connect to WorkAdventure',
  },
  timestamp: '2026-01-28T10:30:00Z',
};

// ============================================================================
// Mock WebSocket Events
// ============================================================================

export const mockUserJoinEvent = {
  type: 'user_join',
  payload: {
    user: {
      id: 10,
      name: 'New User',
      email: 'newuser@example.com',
      room: 'Main Hall',
      status: 'online',
      joinedAt: new Date().toISOString(),
    },
  },
};

export const mockUserLeaveEvent = {
  type: 'user_leave',
  payload: {
    userId: 1,
    room: 'Main Hall',
  },
};

export const mockRoomUpdateEvent = {
  type: 'room_update',
  payload: {
    roomId: 'main-hall',
    userCount: 6,
  },
};

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock user with custom properties
 */
export function createMockUser(overrides: Partial<VirtualOfficeUser> = {}): VirtualOfficeUser {
  return {
    id: Math.floor(Math.random() * 1000),
    name: 'Test User',
    email: 'test@example.com',
    room: 'Main Hall',
    status: 'online',
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a mock room with custom properties
 */
export function createMockRoom(overrides: Partial<VirtualOfficeRoom> = {}): VirtualOfficeRoom {
  return {
    id: `room-${Math.floor(Math.random() * 1000)}`,
    name: 'Test Room',
    userCount: 0,
    maxCapacity: 10,
    type: 'meeting',
    ...overrides,
  };
}

/**
 * Creates a mock status with custom properties
 */
export function createMockStatus(overrides: Partial<VirtualOfficeStatus> = {}): VirtualOfficeStatus {
  return {
    isConnected: true,
    totalOnline: 0,
    users: [],
    rooms: [],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}
