/**
 * Types and constants for UserAccessPanel and sub-components
 */

import React from 'react';
import type {
  UserAccessLevel,
  PermissionEntityType
} from '@/shared/types/user-access.types';
import {
  ACCESS_LEVEL_LABELS,
} from '@/shared/types/user-access.types';
import {
  Layers,
  Database,
  Table,
  GitBranch,
} from 'lucide-react';

export interface UserAccessPanelProps {
  entityType: PermissionEntityType;
  entityId: number;
  spaceId: number; // Required for loading users from System Data
  currentUserLevel: UserAccessLevel;
  ownerOwnerId?: number;
  onPermissionsChange?: (permissions: import('@/shared/types/user-access.types').UserAccessPermissionWithUser[]) => void;
  // Context info for display
  spaceName?: string;
  projectId?: number;
  projectName?: string;
  tableId?: number;
  tableName?: string;
  columnName?: string;
  // Navigation callbacks
  onNavigateToSpace?: () => void;
  onNavigateToProject?: () => void;
  onNavigateToTable?: () => void;
}

export interface User {
  id: number;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface SpaceTable {
  id: number;
  key: string;
  display_name: string;
  project_id: number;
  project_name: string;
  project_type: string;
  label: string;
}

export interface TableColumn {
  id: string;
  name?: string;
  column_name?: string; // API returns column_name from DB
  display_name: string;
  type: string;
  column_type?: string; // API may return column_type instead of type
}

export interface RoleMapping {
  columnValue: string;
  accessLevel: UserAccessLevel;
}

// Default role mappings (common values)
export const DEFAULT_ROLE_MAPPINGS: RoleMapping[] = [
  { columnValue: 'owner', accessLevel: 'owner' },
  { columnValue: 'admin', accessLevel: 'admin' },
  { columnValue: 'editor', accessLevel: 'editor' },
  { columnValue: 'writer', accessLevel: 'editor' },
  { columnValue: 'viewer', accessLevel: 'viewer' },
  { columnValue: 'reader', accessLevel: 'viewer' },
  { columnValue: 'denied', accessLevel: 'denied' },
  { columnValue: 'blocked', accessLevel: 'denied' },
];

// Access levels available for selection (excluding owner_owner which is set automatically)
export const SELECTABLE_ACCESS_LEVELS: { value: UserAccessLevel; label: string }[] = [
  { value: 'owner', label: ACCESS_LEVEL_LABELS.owner },
  { value: 'admin', label: ACCESS_LEVEL_LABELS.admin },
  { value: 'editor', label: ACCESS_LEVEL_LABELS.editor },
  { value: 'viewer', label: ACCESS_LEVEL_LABELS.viewer },
  { value: 'denied', label: ACCESS_LEVEL_LABELS.denied },
];

// Entity level labels for display
export const ENTITY_LEVEL_LABELS: Record<PermissionEntityType, string> = {
  space: 'Space',
  project: 'Project',
  table: 'Table',
  column: 'Column'
};

export const ENTITY_LEVEL_LABELS_RU: Record<PermissionEntityType, string> = {
  space: 'Пространство',
  project: 'Проект',
  table: 'Таблица',
  column: 'Колонка'
};

export const ENTITY_LEVEL_ICONS: Record<PermissionEntityType, React.ReactNode> = {
  space: React.createElement(Layers, { className: 'w-3 h-3' }),
  project: React.createElement(Database, { className: 'w-3 h-3' }),
  table: React.createElement(Table, { className: 'w-3 h-3' }),
  column: React.createElement(GitBranch, { className: 'w-3 h-3' })
};

export const ENTITY_LEVEL_COLORS: Record<PermissionEntityType, string> = {
  space: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  project: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  table: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  column: 'text-amber-400 bg-amber-500/10 border-amber-500/30'
};

// Tab types - 2 tabs: Access and Users
export type AccessPanelTab = 'access' | 'users';

export const ACCESS_PANEL_TABS: { id: AccessPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'access', label: 'Доступ', icon: React.createElement('span', null) },  // Icons set in component
  { id: 'users', label: 'Пользователи', icon: React.createElement('span', null) },
];

// User row from users table with granular access per level (owner/admin/editor/viewer/denied)
export interface UserTableRow {
  row_id: string;
  system_user_id: number | null;
  email: string | null;
  name: string;
  role: string | null;
  active: boolean;
  avatar: string | null;
  id: number | null;
  // Space level access arrays
  space_owner?: string[];
  space_admin?: string[];
  space_editor?: string[];
  space_viewer?: string[];
  space_denied?: string[];
  // Project level access arrays
  project_owner?: string[];
  project_admin?: string[];
  project_editor?: string[];
  project_viewer?: string[];
  project_denied?: string[];
  // Table level access arrays
  table_owner?: string[];
  table_admin?: string[];
  table_editor?: string[];
  table_viewer?: string[];
  table_denied?: string[];
  // Column level access arrays (format: "tableId:columnKey")
  column_owner?: string[];
  column_admin?: string[];
  column_editor?: string[];
  column_viewer?: string[];
  column_denied?: string[];
}

// All tables in space for granular access UI
export interface SpaceTableInfo {
  id: number;
  name: string;
  display_name: string;
  project_id: number;
  project_name: string;
  columns: Array<{
    id: number;
    name: string;
    display_name: string;
  }>;
}

/** Compute the effective role for a user at a given entity, considering hierarchy */
export interface EffectiveRole {
  level: UserAccessLevel;
  source: PermissionEntityType;
  isDirect: boolean;
}
