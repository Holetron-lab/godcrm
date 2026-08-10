/**
 * Types for SpaceAccessManager and its sub-components.
 */

import type { UserAccessLevel } from '@/shared/types/user-access.types';

export interface SpaceAccessManagerProps {
  spaceId: number;
  currentUserLevel: UserAccessLevel;
}

export interface SystemUser {
  id: number;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface SpaceUserRow {
  row_id: string;
  system_user_id: number | null;
  email: string | null;
  name: string;
  role: string | null;
  active: boolean;
  avatar: string | null;
  // Granular access arrays
  space_owner?: string[];
  space_admin?: string[];
  space_editor?: string[];
  space_viewer?: string[];
  space_denied?: string[];
  project_owner?: string[];
  project_admin?: string[];
  project_editor?: string[];
  project_viewer?: string[];
  project_denied?: string[];
  table_owner?: string[];
  table_admin?: string[];
  table_editor?: string[];
  table_viewer?: string[];
  table_denied?: string[];
  column_owner?: string[];
  column_admin?: string[];
  column_editor?: string[];
  column_viewer?: string[];
  column_denied?: string[];
}

export interface TableColumn {
  id: string;
  name?: string;
  column_name?: string;
  display_name: string;
  type: string;
  column_type?: string;
}

export interface AddUserPanelProps {
  systemUsers: SystemUser[];
  existingUserIds: number[];
  selectedUsers: Array<{ userId: number; level: UserAccessLevel }>;
  defaultLevel: UserAccessLevel;
  availableLevels: { value: UserAccessLevel; label: string }[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onToggleUser: (userId: number) => void;
  onUpdateLevel: (userId: number, level: UserAccessLevel) => void;
  onDefaultLevelChange: (level: UserAccessLevel) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}
