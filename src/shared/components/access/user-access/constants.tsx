/**
 * Constants and static lookup tables for UserAccessPanel subcomponents.
 * Extracted from UserAccessPanel.tsx.
 */

import React from 'react';
import {
  Settings,
  Users,
  Database,
  Table,
  Layers,
  GitBranch,
} from 'lucide-react';
import type { UserAccessLevel, PermissionEntityType } from '@/shared/types/user-access.types';
import { ACCESS_LEVEL_LABELS } from '@/shared/types/user-access.types';
import type { AccessPanelTab, RoleMapping } from './types';

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
  column: 'Column',
};

export const ENTITY_LEVEL_LABELS_RU: Record<PermissionEntityType, string> = {
  space: 'Пространство',
  project: 'Проект',
  table: 'Таблица',
  column: 'Колонка',
};

export const ENTITY_LEVEL_ICONS: Record<PermissionEntityType, React.ReactNode> = {
  space: <Layers className="w-3 h-3" />,
  project: <Database className="w-3 h-3" />,
  table: <Table className="w-3 h-3" />,
  column: <GitBranch className="w-3 h-3" />,
};

export const ENTITY_LEVEL_COLORS: Record<PermissionEntityType, string> = {
  space: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  project: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  table: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  column: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
};

export const ACCESS_PANEL_TABS: { id: AccessPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'access', label: 'Доступ', icon: <Settings className="w-4 h-4" /> },
  { id: 'users', label: 'Пользователи', icon: <Users className="w-4 h-4" /> },
];
