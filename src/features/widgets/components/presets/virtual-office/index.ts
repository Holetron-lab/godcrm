/**
 * @file index.ts
 * @description Virtual Office Widget module exports
 * @see ADR-063: WorkAdventure Virtual Office Integration
 */

// Component
export { VirtualOfficeWidget } from './VirtualOfficeWidget';

// Types
export type {
  VirtualOfficeUser,
  VirtualOfficeRoom,
  VirtualOfficeStatus,
  VirtualOfficeConfig,
} from './__fixtures__/mockData';

// Mock data (for testing)
export {
  mockOnlineUsers,
  mockRooms,
  mockDefaultState,
  mockEmptyState,
  mockErrorState,
  mockLoadingState,
  mockVirtualOfficeWidget,
  mockWidgetConfig,
  createMockUser,
  createMockRoom,
  createMockStatus,
} from './__fixtures__/mockData';
