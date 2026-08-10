/**
 * Space Manager Types
 * Based on ADR-004: Space Manager XL Modal
 */

export type ItemType = 'project' | 'folder' | 'table' | 'widget' | 'dashboard';

export interface TreeNode {
  id: string;           // Format: "type:id" e.g., "table:123"
  type: ItemType;
  name: string;
  icon: string;
  data: Record<string, unknown>;
  children: TreeNode[];
  parentId: string | null;
  orderIndex: number;
  depth: number;
}

export interface BatchItem {
  type: ItemType;
  id: number | string;
  order_index?: number;
}

export type BatchOperation = 'move' | 'duplicate' | 'delete' | 'reorder';

export interface BatchRequest {
  operation: BatchOperation;
  items: BatchItem[];
  target?: {
    project_id: number;
    folder_id?: number | null;
  };
  options?: {
    newName?: string;
    newTitle?: string;
    includeData?: boolean;
  };
}

export interface BatchResult {
  success: Array<{ type: string; id: number | string; action: string; newId?: number }>;
  failed: Array<{ item: BatchItem; error: string }>;
}

export interface Folder {
  id: number;
  project_id: number;
  parent_folder_id: number | null;
  name: string;
  icon: string;
  color: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export type SpaceManagerTab = 'settings' | 'structure' | 'files' | 'access';

export interface SpaceTreeData {
  projects: TreeNode[];
  loading: boolean;
  error: string | null;
}

export interface MoveTarget {
  projectId: number;
  folderId?: number | null;
}
