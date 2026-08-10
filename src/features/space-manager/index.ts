/**
 * Space Manager Feature - Index
 */

// Main component
export { SpaceManagerModal } from './components/SpaceManagerModal';
export { default as SpaceManagerModalDefault } from './components/SpaceManagerModal';

// Store
export { useSpaceManagerStore, parseItemId, selectionToBatchItems } from './store/spaceManagerStore';

// Hooks
export { useSpaceTree } from './hooks/useSpaceTree';
export { useBatchOperations } from './hooks/useBatchOperations';

// API
export { spaceManagerApi } from './api/spaceManagerApi';

// Types
export type {
  ItemType,
  TreeNode,
  BatchItem,
  BatchOperation,
  BatchRequest,
  BatchResult,
  Folder,
  SpaceManagerTab,
  SpaceTreeData,
  MoveTarget
} from './types/space-manager.types';
