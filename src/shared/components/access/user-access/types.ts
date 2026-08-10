/**
 * Types shared across UserAccessPanel subcomponents.
 * Extracted from UserAccessPanel.tsx.
 */

import type { UserAccessLevel } from '@/shared/types/user-access.types';

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

// Tab types - 2 tabs: Access and Users
export type AccessPanelTab = 'access' | 'users';

export interface EffectiveRole {
  level: UserAccessLevel;
  source: import('@/shared/types/user-access.types').PermissionEntityType;
  isDirect: boolean;
}
